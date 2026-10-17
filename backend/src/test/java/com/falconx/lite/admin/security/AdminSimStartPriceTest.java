package com.falconx.lite.admin.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.config.SymbolCatalog;
import com.falconx.lite.market.quote.QuoteProcessor;
import com.falconx.lite.common.health.AlertCheck;
import com.falconx.lite.market.api.MarketAdminApi;
import com.falconx.lite.market.quote.SimulatedQuoteSource;
import com.falconx.lite.market.quote.feed.QuoteFeeds;
import com.falconx.lite.market.quote.feed.QuoteRouter;
import com.falconx.lite.trading.api.Bucket;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerCommand;
import com.falconx.lite.trading.api.LedgerEntryType;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.TestPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 模拟起始价（v2 后台补充，后台方案第 11 节）：报价源是模拟源时，新增品种填了起始价 → 立即有报价 → 打开暂停开仓后客户能成交；
 * 不填 → 没报价；已有品种在编辑里补填；重启后从库里读回（csv 里有的品种以 csv 为准）；校验错误和其他字段一起返回。
 * 非模拟源下忽略这一项见 {@link AdminV2Test}。
 *
 * <p>这个类单独起一个报价源是模拟源的 Spring 上下文：随机游走的间隔设成 1 小时（测试期间不跳价，报价都是起始价），
 * 测完关闭上下文（{@link DirtiesContext}），不在其他测试运行时继续推报价。
 */
@TestPropertySource(properties = {"falconx.market.source=simulated", "falconx.market.simulated-interval=1h"})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class AdminSimStartPriceTest extends AdminTestSupport {

  @Autowired LedgerApi ledger;
  @Autowired QuoteProcessor processor;
  @Autowired SymbolCatalog catalog;
  @Autowired SimulatedQuoteSource source;
  @Autowired QuoteFeeds feeds;
  @Autowired QuoteRouter router;
  @Autowired MarketAdminApi marketAdmin;
  @Autowired List<AlertCheck> alerts;
  final ObjectMapper json = new ObjectMapper();

  JsonNode body(MockHttpServletResponse r) throws Exception {
    return json.readTree(r.getContentAsString());
  }

  String newCode() {
    String s = ("ZS" + Long.toString(System.nanoTime(), 36)).toUpperCase(Locale.ROOT);
    return s.length() > 12 ? s.substring(0, 12) : s;
  }

  String createBody(String code, String extra) {
    return "{\"code\":\"" + code + "\",\"nameZh\":\"模拟币\",\"nameEn\":\"Sim Coin\",\"category\":\"crypto\",\"digits\":2,\"contractSize\":\"1\","
        + "\"quoteCurrency\":\"USD\",\"maxLeverage\":50,\"maintenanceMarginRate\":\"0.005\",\"openFeeRate\":\"0.0005\",\"minLots\":\"0.01\",\"maxLots\":\"10\","
        + "\"lotStep\":\"0.01\",\"markup\":\"0.05\",\"hot\":false,\"sessionTemplate\":\"crypto\"" + extra + "}";
  }

  void dropSymbol(String code) {
    jdbc.update("DELETE FROM market_session WHERE symbol = ?", code);
    jdbc.update("DELETE FROM market_kline WHERE symbol = ?", code);
    jdbc.update("DELETE FROM risk_symbol WHERE symbol = ?", code);
    jdbc.update("DELETE FROM market_symbol WHERE code = ?", code);
    catalog.reload();
  }

  String audit(String action, String target) {
    return jdbc.queryForObject("SELECT CONCAT(result, '|', COALESCE(before_json, ''), '|', COALESCE(after_json, '')) "
        + "FROM admin_audit_log WHERE action = ? AND target = ? ORDER BY id DESC LIMIT 1", String.class, action, target);
  }

  /** 报价源把报价交给处理线程（异步），最多等 5 秒 */
  Optional<MarketQuote> awaitQuote(String code) throws InterruptedException {
    for (int i = 0; i < 100; i++) {
      Optional<MarketQuote> q = processor.latest(code);
      if (q.isPresent()) return q;
      Thread.sleep(50);
    }
    return Optional.empty();
  }

  record Customer(long id, Cookie cookie) {}

  Customer customer(String balance) throws Exception {
    String email = unique("sim") + "@example.com";
    jdbc.update("INSERT INTO account_user (email, status) VALUES (?, 'ACTIVE')", email);
    long id = jdbc.queryForObject("SELECT id FROM account_user WHERE email = ?", Long.class, email);
    ledger.openAccount(id);
    ledger.apply(new LedgerCommand(id, Bucket.BALANCE, new BigDecimal(balance), LedgerEntryType.DEPOSIT, "TEST", "dep-" + id, "测试入金"));
    String token = UUID.randomUUID().toString();
    String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
    jdbc.update("INSERT INTO account_session (user_id, token_hash, ip, created_at, last_seen_at, expires_at) VALUES (?, ?, '198.51.100.30', UTC_TIMESTAMP(3), "
        + "UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 1 DAY)", id, hash);
    return new Customer(id, new Cookie("fx_session", token));
  }

  Admin manager() throws Exception {
    return withRoles(role(Permission.SYMBOL_VIEW, Permission.SYMBOL_EDIT, Permission.SYMBOL_CREATE));
  }

  @Test
  void 品种列表告诉前端报价源是模拟的() throws Exception {
    Admin m = withRoles(role(Permission.SYMBOL_VIEW));
    assertThat(body(call(get("/api/admin/symbols?pageSize=1"), m.cookie(), null)).get("simulatedQuotes").asBoolean()).isTrue();
  }

  @Test
  void 新增时填了起始价_立即有报价_打开暂停开仓后客户能成交_审计记下起始价() throws Exception {
    Admin m = manager();
    String code = newCode();
    Customer c = customer("1000");
    try {
      JsonNode s = body(call(post("/api/admin/symbols"), m.cookie(), createBody(code, ",\"simStartPrice\":\"123.45\",\"reason\":\"上新模拟币\"")));
      assertThat(s.get("code").asString()).isEqualTo(code);
      assertThat(s.get("simStartPrice").asString()).isEqualTo("123.45");
      assertThat(s.get("openPaused").asBoolean()).isTrue();
      assertThat(jdbc.queryForObject("SELECT sim_start_price FROM market_symbol WHERE code = ?", BigDecimal.class, code)).isEqualByComparingTo("123.45");
      assertThat(audit("symbol.create", code)).startsWith("SUCCESS||").contains("\"simStartPrice\":\"123.45\"");

      // 报价源立即从起始价开始报价：原始卖价 123.45、点差是起始价的万分之一（按 2 位小数，至少 0.01），再加统一加点 0.05
      assertThat(source.has(code)).isTrue();
      MarketQuote q = awaitQuote(code).orElseThrow(() -> new AssertionError("没有收到报价"));
      assertThat(q.bid()).isEqualByComparingTo("123.40");
      assertThat(q.ask()).isEqualByComparingTo("123.51");
      assertThat(q.executable()).isTrue();
      JsonNode listed = body(call(get("/api/admin/symbols?keyword=" + code), m.cookie(), null)).get("items").get(0);
      assertThat(listed.get("lastQuoteAt").isNull()).as("后台不再显示暂无报价").isFalse();

      // 暂停开仓时不能下单；打开后能成交（按含加点的买价）
      String order = "{\"symbol\":\"" + code + "\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.10\",\"leverage\":10,\"clientOrderId\":\"%s\"}";
      assertThat(call(post("/api/trading/orders"), c.cookie(), order.formatted(UUID.randomUUID())).getContentAsString()).contains("SYMBOL_PAUSED");
      assertThat(call(put("/api/admin/symbols/" + code), m.cookie(), "{\"openPaused\":false,\"reason\":\"报价正常\"}").getStatus()).isEqualTo(200);
      MockHttpServletResponse placed = call(post("/api/trading/orders"), c.cookie(), order.formatted(UUID.randomUUID()));
      assertThat(placed.getStatus()).as(placed.getContentAsString()).isEqualTo(200);
      long positionId = jdbc.queryForObject("SELECT id FROM trading_position WHERE user_id = ? AND symbol = ? AND status = 'OPEN'", Long.class, c.id(), code);
      assertThat(jdbc.queryForObject("SELECT open_price FROM trading_position WHERE id = ?", BigDecimal.class, positionId)).isEqualByComparingTo("123.51");
      // 客户接口按对外编号（public_no）找持仓
      long positionNo = jdbc.queryForObject("SELECT public_no FROM trading_position WHERE id = ?", Long.class, positionId);
      assertThat(call(post("/api/trading/positions/" + positionNo + "/close"), c.cookie(), null).getStatus()).isEqualTo(200);
    } finally {
      dropSymbol(code);
    }
  }

  @Test
  void 新增时不填起始价_没有报价_之后在编辑里补填就开始报价() throws Exception {
    Admin m = manager();
    String code = newCode();
    try {
      JsonNode s = body(call(post("/api/admin/symbols"), m.cookie(), createBody(code, ",\"reason\":\"上新\"")));
      assertThat(s.get("simStartPrice").isNull()).isTrue();
      assertThat(source.has(code)).isFalse();
      Thread.sleep(300);
      assertThat(processor.latest(code)).as("没有起始价：不报价").isEmpty();

      // 编辑里补填：校验（小数位不超过 2 位）
      MockHttpServletResponse bad = call(put("/api/admin/symbols/" + code), m.cookie(), "{\"simStartPrice\":\"8.123\",\"maxLeverage\":0,\"reason\":\"补价\"}");
      assertThat(bad.getStatus()).isEqualTo(400);
      assertThat(bad.getContentAsString()).contains("{\"field\":\"simStartPrice\",\"code\":\"tooManyDecimals\"}")
          .contains("{\"field\":\"maxLeverage\",\"code\":\"invalid\"}");
      assertThat(source.has(code)).isFalse();

      JsonNode after = body(call(put("/api/admin/symbols/" + code), m.cookie(), "{\"simStartPrice\":\"8.5\",\"reason\":\"补模拟起始价\"}"));
      assertThat(after.get("simStartPrice").asString()).isEqualTo("8.5");
      assertThat(audit("symbol.update", code)).isEqualTo("SUCCESS|{\"simStartPrice\":null}|{\"simStartPrice\":\"8.5\"}");
      MarketQuote q = awaitQuote(code).orElseThrow(() -> new AssertionError("补填后没有收到报价"));
      assertThat(q.bid()).isEqualByComparingTo("8.45"); // 原始 8.50 减加点 0.05

      // 已经在报价的品种再改起始价：只保存，不跳价
      body(call(put("/api/admin/symbols/" + code), m.cookie(), "{\"simStartPrice\":\"20\",\"reason\":\"改起始价\"}"));
      assertThat(jdbc.queryForObject("SELECT sim_start_price FROM market_symbol WHERE code = ?", BigDecimal.class, code)).isEqualByComparingTo("20");
      Thread.sleep(300);
      assertThat(processor.latest(code).orElseThrow().bid()).isEqualByComparingTo("8.45");
    } finally {
      dropSymbol(code);
    }
  }

  @Test
  void 起始价的校验错误和其他字段一起返回() throws Exception {
    Admin m = manager();
    String code = newCode();
    String bad = call(post("/api/admin/symbols"), m.cookie(),
        createBody(code, ",\"simStartPrice\":\"1.234\",\"reason\":\"测试\"").replace("\"nameZh\":\"模拟币\"", "\"nameZh\":\"\"")).getContentAsString();
    assertThat(bad).contains("VALIDATION_FAILED").contains("{\"field\":\"simStartPrice\",\"code\":\"tooManyDecimals\"}")
        .contains("{\"field\":\"nameZh\",\"code\":\"required\"}");
    for (String v : new String[] {"0", "-1", "abc", "12345678901234567"}) {
      assertThat(call(post("/api/admin/symbols"), m.cookie(), createBody(code, ",\"simStartPrice\":\"" + v + "\",\"reason\":\"测试\"")).getContentAsString())
          .as(v).contains("{\"field\":\"simStartPrice\",\"code\":\"invalid\"}");
    }
    // 小数位等于 digits、末尾的 0 不算
    assertThat(call(post("/api/admin/symbols"), m.cookie(), createBody(code, ",\"simStartPrice\":\"1.2300\",\"reason\":\"测试\"")).getStatus()).isEqualTo(200);
    try {
      assertThat(jdbc.queryForObject("SELECT sim_start_price FROM market_symbol WHERE code = ?", BigDecimal.class, code)).isEqualByComparingTo("1.23");
    } finally {
      dropSymbol(code);
    }
  }

  @Test
  void 重启后从库里读回起始价_csv里有的品种以csv为准() throws Exception {
    String code = newCode();
    // 模拟"上次运行时建的品种"：直接写库，报价源还不知道它
    jdbc.update("INSERT INTO market_symbol (code, name_zh, name_en, category, digits, contract_size, unit, base_ccy, quote_ccy, max_leverage, min_lots, max_lots, "
        + "lot_step, fee_rate, maintenance_margin_rate, markup, sim_start_price, open_paused, sort_order) "
        + "VALUES (?, '重启币', 'Restart Coin', 'crypto', 3, 1, 'unit', 'RST', 'USD', 10, 0.01, 10, 0.01, 0, 0.01, 0, 42.125, 1, 9999)", code);
    for (int d = 1; d <= 7; d++) jdbc.update("INSERT INTO market_session (symbol, day_of_week, open_minute, close_minute) VALUES (?, ?, 0, 1440)", code, d);
    jdbc.update("UPDATE market_symbol SET sim_start_price = 9.99999 WHERE code = 'EURUSD'");
    try {
      catalog.reload();
      assertThat(source.has(code)).isFalse();
      assertThat(source.seedFromDatabase()).as("EURUSD 在 csv 里，不用库里的起始价").contains(code).doesNotContain("EURUSD");
      MarketQuote q = awaitQuote(code).orElseThrow(() -> new AssertionError("重启后没有收到报价"));
      assertThat(q.bid()).isEqualByComparingTo("42.125");
      assertThat(q.ask()).isEqualByComparingTo("42.129"); // 点差 42.125 × 0.0001 ≈ 0.004（3 位小数）
      assertThat(source.seedFromDatabase()).as("已经在报价的不重复加入").doesNotContain(code);
    } finally {
      jdbc.update("UPDATE market_symbol SET sim_start_price = NULL WHERE code = 'EURUSD'");
      dropSymbol(code);
    }
  }

  /** 报价源接入（技术方案/v2-报价源接入.md 第 5.1 节）：测试环境现在的样子——模拟模式、两家都没有 token */
  @Test
  void 没有配置报价源token时和接入以前一样_全部模拟_没有任何真实连接和告警项() throws Exception {
    assertThat(feeds.feeds()).isEmpty();
    assertThat(router.subscriptions()).isEmpty();
    assertThat(router.liveTrading("EURUSD")).isFalse();
    MarketAdminApi.Symbol eur = marketAdmin.symbols().stream().filter(x -> x.spec().code().equals("EURUSD")).findFirst().orElseThrow();
    assertThat(eur.quoteSource()).isEqualTo(new MarketAdminApi.QuoteSource("simulated", null));
    for (AlertCheck a : alerts) for (AlertCheck.Item i : a.evaluate()) assertThat(i.name()).doesNotStartWith("quote.");
    JsonNode pub = body(mvc.perform(get("/api/public/quotes")).andReturn().getResponse());
    assertThat(pub.get("sample").asBoolean()).as("官网仍标示例行情").isTrue();
  }
}
