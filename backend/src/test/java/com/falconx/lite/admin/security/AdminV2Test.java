package com.falconx.lite.admin.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.QuoteStatus;
import com.falconx.lite.market.config.SymbolCatalog;
import com.falconx.lite.market.quote.QuoteProcessor;
import com.falconx.lite.market.quote.RawQuote;
import com.falconx.lite.support.FixedClockConfig;
import com.falconx.lite.trading.api.Bucket;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerCommand;
import com.falconx.lite.trading.api.LedgerEntryType;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * v2 后台（需求说明书 v2.1 第 11.1 节）：E1 编辑客户资料（AC2-14）、E3 新增品种（AC2-16）、E6 最后报价时间和最近登录 IP。
 * E2 深色主题、E7 自动刷新只在前端（web/admin 的测试）。
 */
class AdminV2Test extends AdminTestSupport {

  @Autowired LedgerApi ledger;
  @Autowired QuoteProcessor processor;
  @Autowired MarketApi market;
  @Autowired SymbolCatalog catalog;
  final ObjectMapper json = new ObjectMapper();

  record Customer(long id, String email, Cookie cookie) {}

  JsonNode body(MockHttpServletResponse r) throws Exception {
    return json.readTree(r.getContentAsString());
  }

  /** 建一个有余额、能登录的客户；会话带 IP（直接写库，令牌只在测试里） */
  Customer customer(String balance, String ip) throws Exception {
    String email = unique("v2") + "@example.com";
    jdbc.update("INSERT INTO account_user (email, status) VALUES (?, 'ACTIVE')", email);
    long id = jdbc.queryForObject("SELECT id FROM account_user WHERE email = ?", Long.class, email);
    jdbc.update("INSERT INTO account_profile (user_id, first_name, middle_name, last_name, birth_date, nationality) VALUES (?, 'Lin', '', 'Wang', '1990-01-02', 'SG')",
        id);
    ledger.openAccount(id);
    ledger.apply(new LedgerCommand(id, Bucket.BALANCE, new BigDecimal(balance), LedgerEntryType.DEPOSIT, "TEST", "dep-" + id, "测试入金"));
    String token = UUID.randomUUID().toString();
    String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
    jdbc.update("INSERT INTO account_session (user_id, token_hash, ip, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), "
        + "UTC_TIMESTAMP(3) + INTERVAL 1 DAY)", id, hash, ip);
    return new Customer(id, email, new Cookie("fx_session", token));
  }

  String audit(String action, String target) {
    return jdbc.queryForObject("SELECT CONCAT(result, '|', high_risk, '|', COALESCE(reason, ''), '|', COALESCE(before_json, ''), '|', COALESCE(after_json, '')) "
        + "FROM admin_audit_log WHERE action = ? AND target = ? ORDER BY id DESC LIMIT 1", String.class, action, target);
  }

  // ---------------- E1 编辑客户资料（AC2-14） ----------------

  @Test
  void E1_编辑客户资料_权限点高危_原因必填_字段错误一次返回_不能改邮箱和状态_审计记前后() throws Exception {
    assertThat(Permission.CUSTOMER_EDIT.highRisk).isTrue();
    Customer c = customer("10", "198.51.100.9");
    String path = "/api/admin/customers/" + c.id() + "/profile";
    String ok = "{\"firstName\":\"Lina\",\"middleName\":\"\",\"lastName\":\"Wang\",\"birthDate\":\"1991-03-04\",\"nationality\":\"HK\"";

    Admin viewer = withRoles(role(Permission.CUSTOMER_VIEW));
    assertThat(call(put(path), viewer.cookie(), ok + ",\"reason\":\"客户来电\"}").getStatus()).as("没有 customer:edit").isEqualTo(403);

    Admin editor = withRoles(role(Permission.CUSTOMER_VIEW, Permission.CUSTOMER_EDIT));
    MockHttpServletResponse noReason = call(put(path), editor.cookie(), ok + "}");
    assertThat(noReason.getStatus()).isEqualTo(400);
    assertThat(noReason.getContentAsString()).contains("\"field\":\"reason\"");

    // 邮箱、状态不能在编辑里改
    MockHttpServletResponse email = call(put(path), editor.cookie(), ok + ",\"email\":\"x@example.com\",\"status\":\"frozen\",\"reason\":\"改邮箱\"}");
    assertThat(email.getStatus()).isEqualTo(400);
    assertThat(email.getContentAsString()).contains("{\"field\":\"email\",\"code\":\"notEditable\"}").contains("{\"field\":\"status\",\"code\":\"notEditable\"}");

    // 和客户端注册同样的规则，字段错误逐条一次返回
    MockHttpServletResponse bad = call(put(path), editor.cookie(),
        "{\"firstName\":\" \",\"middleName\":\"" + "a".repeat(51) + "\",\"lastName\":\"W4ng\",\"birthDate\":\"2010-01-01\",\"nationality\":\"sg\",\"reason\":\"测试\"}");
    assertThat(bad.getStatus()).isEqualTo(400);
    assertThat(bad.getContentAsString()).contains("{\"field\":\"firstName\",\"code\":\"required\"}").contains("{\"field\":\"middleName\",\"code\":\"nameTooLong\"}")
        .contains("{\"field\":\"lastName\",\"code\":\"nameChars\"}").contains("{\"field\":\"birthDate\",\"code\":\"ageUnder18\"}")
        .contains("{\"field\":\"nationality\",\"code\":\"nationalityInvalid\"}");
    assertThat(body(call(put(path), editor.cookie(), "{\"firstName\":\"A\",\"lastName\":\"B\",\"birthDate\":\"1990-02-30\",\"nationality\":\"SG\",\"reason\":\"x\"}"))
        .toString()).contains("\"code\":\"dateInvalid\"");
    assertThat(audit("customer.edit", String.valueOf(c.id()))).startsWith("FAILURE|1|x（失败：VALIDATION_FAILED）");

    // 成功：只记改了的字段；邮箱和状态不变
    JsonNode d = body(call(put(path), editor.cookie(), ok + ",\"reason\":\"客户提供了新证件\"}"));
    assertThat(d.get("firstName").asString()).isEqualTo("Lina");
    assertThat(d.get("birthDate").asString()).isEqualTo("1991-03-04");
    assertThat(d.get("nationality").asString()).isEqualTo("HK");
    assertThat(d.get("name").asString()).isEqualTo("Lina Wang");
    assertThat(d.get("email").asString()).isEqualTo(c.email());
    assertThat(d.get("status").asString()).isEqualTo("active");
    String a = audit("customer.edit", String.valueOf(c.id()));
    assertThat(a).startsWith("SUCCESS|1|客户提供了新证件|");
    assertThat(a.split("\\|")[3]).contains("\"firstName\":\"Lin\"").contains("\"birthDate\":\"1990-01-02\"").contains("\"nationality\":\"SG\"").doesNotContain("lastName");
    assertThat(a.split("\\|")[4]).contains("\"firstName\":\"Lina\"").contains("\"nationality\":\"HK\"").doesNotContain("kycApproved");

    // KYC 已通过：允许改，但审计里标出（和证件不一致）
    jdbc.update("INSERT INTO account_kyc_application (user_id, doc_type, doc_number, front_key, back_key, selfie_key, status, reviewed_at) "
        + "VALUES (?, 'PASSPORT', ?, 'f', 'b', 's', 'APPROVED', UTC_TIMESTAMP(3))", c.id(), unique("P"));
    assertThat(body(call(get("/api/admin/customers/" + c.id()), editor.cookie(), null)).get("kycStatus").asString()).isEqualTo("approved");
    JsonNode d2 = body(call(put(path), editor.cookie(), ok.replace("Lina", "Linda") + ",\"reason\":\"证件姓名更正\"}"));
    assertThat(d2.get("firstName").asString()).isEqualTo("Linda");
    assertThat(audit("customer.edit", String.valueOf(c.id())).split("\\|")[4]).contains("\"kycApproved\":true").contains("kycMismatch");
  }

  @Test
  void E6_客户详情有最近登录IP() throws Exception {
    Customer c = customer("10", "203.0.113.77");
    Admin viewer = withRoles(role(Permission.CUSTOMER_VIEW));
    JsonNode d = body(call(get("/api/admin/customers/" + c.id()), viewer.cookie(), null));
    assertThat(d.get("lastLoginIp").asString()).isEqualTo("203.0.113.77");
    assertThat(d.get("lastLoginIpAt").asString()).endsWith("Z");
    String email = unique("nolog") + "@example.com";
    jdbc.update("INSERT INTO account_user (email, status) VALUES (?, 'ACTIVE')", email);
    long never = jdbc.queryForObject("SELECT id FROM account_user WHERE email = ?", Long.class, email);
    ledger.openAccount(never);
    assertThat(body(call(get("/api/admin/customers/" + never), viewer.cookie(), null)).get("lastLoginIp").isNull()).isTrue();
  }

  // ---------------- E3 新增品种（AC2-16）、E6 最后报价时间 ----------------

  String newCode() {
    String s = ("ZT" + Long.toString(System.nanoTime(), 36)).toUpperCase(Locale.ROOT);
    return s.length() > 12 ? s.substring(0, 12) : s;
  }

  String createBody(String code, String extra) {
    return "{\"code\":\"" + code + "\",\"nameZh\":\"测试币\",\"nameEn\":\"Test Coin\",\"category\":\"crypto\",\"digits\":2,\"contractSize\":\"1\","
        + "\"quoteCurrency\":\"USD\",\"maxLeverage\":50,\"maintenanceMarginRate\":\"0.005\",\"openFeeRate\":\"0.0005\",\"minLots\":\"0.01\",\"maxLots\":\"10\","
        + "\"lotStep\":\"0.01\",\"markup\":\"0.05\",\"hot\":false" + extra + "}";
  }

  void dropSymbol(String code) {
    jdbc.update("DELETE FROM market_session WHERE symbol = ?", code);
    jdbc.update("DELETE FROM market_kline WHERE symbol = ?", code);
    jdbc.update("DELETE FROM risk_symbol WHERE symbol = ?", code);
    jdbc.update("DELETE FROM market_symbol WHERE code = ?", code);
    catalog.reload();
  }

  @Test
  void E3_新增品种_权限点高危_原因必填_校验_默认暂停开仓_不重启就能报价下单_风控敞口和K线认得() throws Exception {
    assertThat(Permission.SYMBOL_CREATE.highRisk).isTrue();
    String code = newCode();
    String copy = newCode() + "C";
    Admin editOnly = withRoles(role(Permission.SYMBOL_VIEW, Permission.SYMBOL_EDIT));
    assertThat(call(post("/api/admin/symbols"), editOnly.cookie(), createBody(code, ",\"sessionTemplate\":\"crypto\",\"reason\":\"上新\"")).getStatus())
        .as("没有 symbol:create").isEqualTo(403);

    Admin m = withRoles(role(Permission.SYMBOL_VIEW, Permission.SYMBOL_EDIT, Permission.SYMBOL_CREATE, Permission.RISK_VIEW));
    Customer c = customer("1000", "198.51.100.20");
    try {
      assertThat(call(post("/api/admin/symbols"), m.cookie(), createBody(code, ",\"sessionTemplate\":\"crypto\"")).getContentAsString())
          .contains("\"field\":\"reason\"");
      // 字段错误一次全部返回
      String bad = call(post("/api/admin/symbols"), m.cookie(), "{\"code\":\"eu-r\",\"category\":\"bond\",\"digits\":9,\"contractSize\":\"abc\",\"quoteCurrency\":\"ZZZ\","
          + "\"maxLeverage\":0,\"maintenanceMarginRate\":\"0\",\"openFeeRate\":\"0.5\",\"minLots\":\"2\",\"maxLots\":\"1\",\"lotStep\":\"0.01\",\"reason\":\"测试\"}")
          .getContentAsString();
      assertThat(bad).contains("VALIDATION_FAILED").contains("{\"field\":\"code\",\"code\":\"invalid\"}").contains("{\"field\":\"nameZh\",\"code\":\"required\"}")
          .contains("{\"field\":\"category\",\"code\":\"invalid\"}").contains("{\"field\":\"digits\",\"code\":\"invalid\"}")
          .contains("{\"field\":\"contractSize\",\"code\":\"invalid\"}").contains("{\"field\":\"quoteCurrency\",\"code\":\"noFxRate\"}")
          .contains("{\"field\":\"maxLeverage\",\"code\":\"invalid\"}").contains("{\"field\":\"maintenanceMarginRate\",\"code\":\"invalid\"}")
          .contains("{\"field\":\"openFeeRate\",\"code\":\"invalid\"}").contains("{\"field\":\"maxLots\",\"code\":\"lessThanMin\"}")
          .contains("{\"field\":\"sessions\",\"code\":\"required\"}");
      assertThat(call(post("/api/admin/symbols"), m.cookie(), createBody("EURUSD", ",\"sessionTemplate\":\"fx\",\"reason\":\"重复\"")).getContentAsString())
          .contains("SYMBOL_EXISTS");
      assertThat(call(post("/api/admin/symbols"), m.cookie(), createBody(code, ",\"copySessionsFrom\":\"NOPE\",\"reason\":\"x\"")).getContentAsString())
          .contains("{\"field\":\"copySessionsFrom\",\"code\":\"invalid\"}");

      // 新增成功：默认暂停开仓、没有报价、写高危审计
      JsonNode s = body(call(post("/api/admin/symbols"), m.cookie(), createBody(code.toLowerCase(Locale.ROOT), ",\"sessionTemplate\":\"crypto\",\"reason\":\"上新测试币\"")));
      assertThat(s.get("code").asString()).as("代码统一大写").isEqualTo(code);
      assertThat(s.get("openPaused").asBoolean()).isTrue();
      assertThat(s.get("enabled").asBoolean()).isTrue();
      assertThat(s.get("lastQuoteAt").isNull()).as("模拟报价源没有起始价时不推报价：暂无报价").isTrue();
      assertThat(s.get("tradingOpen").asBoolean()).isTrue();
      assertThat(s.get("swapLong").asString()).isEqualTo("0");
      assertThat(audit("symbol.create", code)).startsWith("SUCCESS|1|上新测试币||").contains("\"openPaused\":true").contains("\"sessions\":\"template:crypto\"");
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM market_session WHERE symbol = ?", Long.class, code)).isEqualTo(7);
      assertThat(body(call(get("/api/admin/symbols?keyword=" + code), m.cookie(), null)).get("total").asLong()).isEqualTo(1);
      assertThat(market.symbol(code)).as("不重启：提交后行情模块已经认得").isPresent();
      assertThat(call(post("/api/admin/symbols"), m.cookie(), createBody(code, ",\"sessionTemplate\":\"crypto\",\"reason\":\"再来\"")).getContentAsString())
          .contains("SYMBOL_EXISTS");

      // 从已有品种复制时段
      body(call(post("/api/admin/symbols"), m.cookie(), createBody(copy, ",\"copySessionsFrom\":\"EURUSD\",\"reason\":\"复制时段\"")));
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM market_session WHERE symbol = ?", Long.class, copy))
          .isEqualTo(jdbc.queryForObject("SELECT COUNT(*) FROM market_session WHERE symbol = 'EURUSD'", Long.class));

      // 测试替身推一条报价：行情入口认得新品种，最后报价时间更新
      assertThat(processor.process(new RawQuote(code, new BigDecimal("100.00"), new BigDecimal("100.10"), FixedClockConfig.NOW))).isEqualTo(QuoteStatus.FRESH);
      JsonNode listed = body(call(get("/api/admin/symbols?keyword=" + code), m.cookie(), null)).get("items").get(0);
      assertThat(listed.get("lastQuoteAt").asString()).isEqualTo(FixedClockConfig.NOW.toString());

      // 暂停开仓时客户不能下单
      String order = "{\"symbol\":\"" + code + "\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.10\",\"leverage\":10,\"clientOrderId\":\"%s\"}";
      assertThat(call(post("/api/trading/orders"), c.cookie(), order.formatted(UUID.randomUUID())).getContentAsString()).contains("SYMBOL_PAUSED");
      // 运营确认报价正常后打开（改品种参数，高危审计里有 openPaused 前后）
      assertThat(call(put("/api/admin/symbols/" + code), m.cookie(), "{\"openPaused\":false}").getStatus()).isEqualTo(400);
      JsonNode opened = body(call(put("/api/admin/symbols/" + code), m.cookie(), "{\"openPaused\":false,\"reason\":\"报价正常，开放交易\"}"));
      assertThat(opened.get("openPaused").asBoolean()).isFalse();
      assertThat(audit("symbol.update", code)).contains("{\"openPaused\":true}|{\"openPaused\":false}");

      // 客户能下单（买价含加点 0.05）
      MockHttpServletResponse placed = call(post("/api/trading/orders"), c.cookie(), order.formatted(UUID.randomUUID()));
      assertThat(placed.getStatus()).as(placed.getContentAsString()).isEqualTo(200);
      long positionId = jdbc.queryForObject("SELECT id FROM trading_position WHERE user_id = ? AND symbol = ? AND status = 'OPEN'", Long.class, c.id(), code);
      assertThat(jdbc.queryForObject("SELECT open_price FROM trading_position WHERE id = ?", BigDecimal.class, positionId)).isEqualByComparingTo("100.15");
      // 风控看板的敞口、K 线都认得新品种
      assertThat(body(call(get("/api/admin/risk"), m.cookie(), null)).get("symbols").toString()).contains("\"symbol\":\"" + code + "\"");
      assertThat(body(call(get("/api/market/klines?symbol=" + code + "&tf=1m"), c.cookie(), null)).size()).isEqualTo(1);
      // 平仓（不留下没有品种的持仓）
      // 路径里是持仓的对外编号（雪花 ID，v2 第 11.4 节），不是内部 id
      long positionNo = jdbc.queryForObject("SELECT public_no FROM trading_position WHERE id = ?", Long.class, positionId);
      assertThat(call(post("/api/trading/positions/" + positionNo + "/close"), c.cookie(), null).getStatus()).isEqualTo(200);
    } finally {
      dropSymbol(code);
      dropSymbol(copy);
    }
  }

  @Test
  void 模拟起始价_不是模拟报价源时忽略_不校验不保存_列表告诉前端不是模拟源() throws Exception {
    Admin m = withRoles(role(Permission.SYMBOL_VIEW, Permission.SYMBOL_EDIT, Permission.SYMBOL_CREATE));
    assertThat(body(call(get("/api/admin/symbols?pageSize=1"), m.cookie(), null)).get("simulatedQuotes").asBoolean()).as("测试配置的报价源是 none").isFalse();
    String code = newCode();
    try {
      // 格式不对也不报错：这一项整个被忽略
      JsonNode s = body(call(post("/api/admin/symbols"), m.cookie(), createBody(code, ",\"sessionTemplate\":\"crypto\",\"simStartPrice\":\"abc\",\"reason\":\"上新\"")));
      assertThat(s.get("code").asString()).isEqualTo(code);
      assertThat(s.get("simStartPrice").isNull()).isTrue();
      assertThat(s.get("lastQuoteAt").isNull()).isTrue();
      JsonNode e = body(call(put("/api/admin/symbols/" + code), m.cookie(), "{\"simStartPrice\":\"100\",\"reason\":\"补价\"}"));
      assertThat(e.get("simStartPrice").isNull()).isTrue();
      assertThat(jdbc.queryForObject("SELECT sim_start_price FROM market_symbol WHERE code = ?", BigDecimal.class, code)).isNull();
      assertThat(processor.latest(code)).isEmpty();
    } finally {
      dropSymbol(code);
    }
  }

  @Test
  void E6_品种列表有最后报价时间_休市品种标出不在交易时段() throws Exception {
    Admin m = withRoles(role(Permission.SYMBOL_VIEW));
    processor.process(new RawQuote("EURUSD", new BigDecimal("1.16342"), new BigDecimal("1.16352"), FixedClockConfig.NOW));
    JsonNode items = body(call(get("/api/admin/symbols?pageSize=100"), m.cookie(), null)).get("items");
    JsonNode eur = null;
    JsonNode aapl = null;
    for (JsonNode n : items) {
      if ("EURUSD".equals(n.get("code").asString())) eur = n;
      if ("AAPL".equals(n.get("code").asString())) aapl = n;
    }
    assertThat(eur).isNotNull();
    assertThat(eur.get("lastQuoteAt").asString()).isEqualTo(FixedClockConfig.NOW.toString());
    assertThat(eur.get("tradingOpen").asBoolean()).isTrue();
    assertThat(aapl).isNotNull();
    assertThat(aapl.get("tradingOpen").asBoolean()).as("固定时钟是周三 10:00 UTC，美股休市").isFalse();
  }
}
