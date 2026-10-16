package com.falconx.lite.admin.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.falconx.lite.common.config.ConfigKey;
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
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** 后台接口（S16c）：仪表盘、交易监控（手动强平、强制撤单）、风控操作、品种与行情、交易参数。 */
class AdminMonitorTest extends AdminTestSupport {

  @Autowired LedgerApi ledger;
  @Autowired QuoteProcessor processor;
  @Autowired com.falconx.lite.market.config.SymbolCatalog catalog;
  final ObjectMapper json = new ObjectMapper();

  record Customer(long id, String name, Cookie cookie) {}

  JsonNode body(MockHttpServletResponse r) throws Exception {
    return json.readTree(r.getContentAsString());
  }

  @BeforeEach
  void quotes() {
    processor.process(new RawQuote("XAUUSD", new BigDecimal("4126.35"), new BigDecimal("4126.75"), FixedClockConfig.NOW));
  }

  /** 建一个有余额、能登录的客户（会话直接写库，令牌只在测试里） */
  Customer customer(String balance) throws Exception {
    String name = unique("Mon");
    String email = unique("m") + "@example.com";
    jdbc.update("INSERT INTO account_user (email, status) VALUES (?, 'ACTIVE')", email);
    long id = jdbc.queryForObject("SELECT id FROM account_user WHERE email = ?", Long.class, email);
    jdbc.update("INSERT INTO account_profile (user_id, first_name, middle_name, last_name, birth_date, nationality) VALUES (?, ?, '', 'T', '1990-01-02', 'SG')",
        id, name);
    ledger.openAccount(id);
    ledger.apply(new LedgerCommand(id, Bucket.BALANCE, new BigDecimal(balance), LedgerEntryType.DEPOSIT, "TEST", "dep-" + id, "测试入金"));
    String token = UUID.randomUUID().toString();
    String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
    jdbc.update("INSERT INTO account_session (user_id, token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), "
        + "UTC_TIMESTAMP(3) + INTERVAL 1 DAY)", id, hash);
    return new Customer(id, name, new Cookie("fx_session", token));
  }

  String order(Customer c, String type, String side, String limitPrice) throws Exception {
    String body = "{\"symbol\":\"XAUUSD\",\"type\":\"" + type + "\",\"side\":\"" + side + "\",\"lots\":\"0.10\",\"leverage\":100"
        + (limitPrice == null ? "" : ",\"limitPrice\":\"" + limitPrice + "\"") + ",\"clientOrderId\":\"" + UUID.randomUUID() + "\"}";
    MockHttpServletResponse r = call(post("/api/trading/orders"), c.cookie(), body);
    assertThat(r.getStatus()).as(r.getContentAsString()).isEqualTo(200);
    return body(r).get("id").asString();
  }

  @Test
  void 交易监控_订单持仓挂单列表_强制撤单释放冻结_手动强平通知客户_都要原因和高危审计() throws Exception {
    Admin view = withRoles(role(Permission.ORDER_VIEW, Permission.POSITION_VIEW, Permission.PENDING_VIEW));
    Admin ops = withRoles(role(Permission.POSITION_VIEW, Permission.POSITION_LIQUIDATE, Permission.PENDING_VIEW, Permission.PENDING_FORCE_CANCEL));
    Customer c = customer("2000");
    order(c, "market", "buy", null);
    String pendingId = order(c, "limit", "buy", "4000.00");
    JsonNode orders = body(call(get("/api/admin/orders?keyword=" + c.id()), view.cookie(), null));
    assertThat(orders.get("total").asLong()).isEqualTo(2);
    JsonNode filled = orders.get("items").get(1);
    assertThat(filled.get("status").asString()).isEqualTo("filled");
    assertThat(filled.get("price").asString()).isEqualTo("4126.75");
    assertThat(filled.get("customerName").asString()).isEqualTo(c.name() + " T");
    assertThat(filled.get("fee").asString()).isNotNull();
    assertThat(body(call(get("/api/admin/orders?keyword=" + c.id() + "&status=pending&side=buy"), view.cookie(), null)).get("total").asLong()).isEqualTo(1);
    JsonNode pend = body(call(get("/api/admin/pending?keyword=" + c.id()), view.cookie(), null)).get("items").get(0);
    assertThat(pend.get("limitPrice").asString()).isEqualTo("4000");
    assertThat(pend.get("currentPrice").asString()).as("买单看 ask").isEqualTo("4126.75");
    JsonNode pos = body(call(get("/api/admin/positions?keyword=" + c.id()), view.cookie(), null)).get("items").get(0);
    assertThat(pos.get("side").asString()).isEqualTo("buy");
    assertThat(pos.get("currentPrice").asString()).as("多单平仓看 bid").isEqualTo("4126.35");
    assertThat(call(post("/api/admin/positions/" + pos.get("id").asString() + "/liquidate"), view.cookie(), "{\"reason\":\"x\"}").getStatus()).isEqualTo(403);

    BigDecimal frozenBefore = jdbc.queryForObject("SELECT order_frozen FROM trading_account WHERE user_id = ?", BigDecimal.class, c.id());
    assertThat(frozenBefore.signum()).isPositive();
    assertThat(call(post("/api/admin/pending/" + pendingId + "/cancel"), ops.cookie(), "{}").getStatus()).isEqualTo(400);
    assertThat(call(post("/api/admin/pending/" + pendingId + "/cancel"), ops.cookie(), "{\"reason\":\"客户要求\"}").getStatus()).isEqualTo(200);
    assertThat(jdbc.queryForObject("SELECT order_frozen FROM trading_account WHERE user_id = ?", BigDecimal.class, c.id())).isEqualByComparingTo("0");
    assertThat(call(post("/api/admin/pending/" + pendingId + "/cancel"), ops.cookie(), "{\"reason\":\"再撤\"}").getContentAsString()).contains("NOT_FOUND");

    JsonNode liq = body(call(post("/api/admin/positions/" + pos.get("id").asString() + "/liquidate"), ops.cookie(), "{\"reason\":\"风险过高\"}"));
    assertThat(liq.get("price").asString()).isEqualTo("4126.35");
    assertThat(jdbc.queryForObject("SELECT CONCAT(status, ' ', close_reason) FROM trading_position WHERE public_no = ?", String.class,
        Long.parseLong(pos.get("id").asString()))).isEqualTo("CLOSED LIQUIDATED");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notify_message WHERE user_id = ? AND template_code = 'LIQUIDATED'", Long.class, c.id())).isEqualTo(1);
    assertThat(call(post("/api/admin/positions/" + pos.get("id").asString() + "/liquidate"), ops.cookie(), "{\"reason\":\"再来\"}").getContentAsString())
        .contains("POSITION_NOT_OPEN");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM admin_audit_log WHERE action = 'position.liquidate' AND high_risk = 1 AND result = 'SUCCESS' AND target = ?",
        Long.class, pos.get("id").asString())).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COALESCE(SUM(l.amount), 0) FROM trading_ledger l JOIN trading_account a ON a.id = l.account_id "
        + "WHERE a.user_id = ? AND l.bucket = 'BALANCE'", BigDecimal.class, c.id()))
        .isEqualByComparingTo(jdbc.queryForObject("SELECT balance FROM trading_account WHERE user_id = ?", BigDecimal.class, c.id()));
  }

  @Test
  void 风控看板和操作_暂停恢复_阈值_自动强平开关_单客户持仓上限立即生效() throws Exception {
    Admin r = withRoles(role(Permission.RISK_VIEW, Permission.RISK_GLOBAL_PAUSE, Permission.RISK_AUTO_LIQUIDATION, Permission.RISK_SYMBOL_PAUSE,
        Permission.RISK_THRESHOLD, Permission.RISK_USER_LIMIT));
    Customer c = customer("100000");
    order(c, "market", "buy", null);
    try {
      JsonNode o = body(call(get("/api/admin/risk"), r.cookie(), null));
      assertThat(o.get("settings").get("perUserLimitUsd").asString()).isEqualTo("3000000");
      assertThat(o.get("symbols").toString()).contains("\"symbol\":\"XAUUSD\"");
      assertThat(call(post("/api/admin/risk/symbols/XAUUSD/pause"), r.cookie(), "{\"value\":true}").getStatus()).isEqualTo(400);
      JsonNode paused = body(call(post("/api/admin/risk/symbols/XAUUSD/pause"), r.cookie(), "{\"value\":true,\"reason\":\"行情异常\"}"));
      assertThat(paused.get("symbols").toString()).contains("\"symbol\":\"XAUUSD\"").contains("manual_paused");
      assertThat(paused.get("events").get(0).get("type").asString()).isEqualTo("manual_pause");
      assertThat(paused.get("events").get(0).get("actorName").asString()).isEqualTo(r.username());
      assertThat(call(post("/api/trading/orders"), c.cookie(), "{\"symbol\":\"XAUUSD\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.10\",\"leverage\":100,"
          + "\"clientOrderId\":\"" + UUID.randomUUID() + "\"}").getContentAsString()).contains("SYMBOL_PAUSED");
      body(call(post("/api/admin/risk/symbols/XAUUSD/pause"), r.cookie(), "{\"value\":false,\"reason\":\"恢复\"}"));

      JsonNode th = body(call(put("/api/admin/risk/symbols/XAUUSD/threshold"), r.cookie(), "{\"value\":\"500000\",\"reason\":\"设阈值\"}"));
      assertThat(th.get("symbols").toString()).contains("\"thresholdUsd\":\"500000\"");
      assertThat(call(put("/api/admin/risk/symbols/XAUUSD/threshold"), r.cookie(), "{\"value\":\"-1\",\"reason\":\"x\"}").getStatus()).isEqualTo(400);
      assertThat(call(put("/api/admin/risk/symbols/NOPE/threshold"), r.cookie(), "{\"value\":\"1\",\"reason\":\"x\"}").getStatus()).isEqualTo(404);

      assertThat(body(call(post("/api/admin/risk/auto-liquidation"), r.cookie(), "{\"value\":false,\"reason\":\"演练\"}")).get("settings").get("autoLiquidation")
          .asBoolean()).isFalse();
      assertThat(body(call(post("/api/admin/risk/global-pause"), r.cookie(), "{\"value\":true,\"reason\":\"演练\"}")).get("settings").get("globalPause")
          .asBoolean()).isTrue();
      body(call(post("/api/admin/risk/global-pause"), r.cookie(), "{\"value\":false,\"reason\":\"演练结束\"}"));

      // 单客户持仓上限：已有 0.1 手黄金约 4.1 万 USD，上限改成 50,000 后再开 0.1 手被拒
      body(call(put("/api/admin/risk/per-user-limit"), r.cookie(), "{\"value\":\"50000\",\"reason\":\"收紧\"}"));
      assertThat(call(post("/api/trading/orders"), c.cookie(), "{\"symbol\":\"XAUUSD\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.10\",\"leverage\":100,"
          + "\"clientOrderId\":\"" + UUID.randomUUID() + "\"}").getContentAsString()).contains("POSITION_LIMIT");
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM admin_audit_log WHERE action LIKE 'risk.%' AND admin_name = ? AND high_risk = 1", Long.class,
          r.username())).isGreaterThanOrEqualTo(7);
    } finally {
      jdbc.update("UPDATE common_config SET value = ? WHERE config_key = ?", "3000000", ConfigKey.RISK_PER_USER_LIMIT.key);
      config.refresh();
      jdbc.update("UPDATE risk_switch SET global_open_paused = 0, auto_global_paused = 0, auto_liquidation = 1");
      jdbc.update("DELETE FROM risk_symbol WHERE symbol = 'XAUUSD'");
    }
  }

  /** AC2-22：后台显示和搜索用对外编号（雪花 ID，字符串）；搜索框输入数字时既按客户号也按编号找 */
  @Test
  void 后台按对外编号搜索订单持仓挂单_显示的是编号_AC2_22() throws Exception {
    Admin view = withRoles(role(Permission.ORDER_VIEW, Permission.POSITION_VIEW, Permission.PENDING_VIEW));
    Customer c = customer("10000");
    String orderNo = order(c, "market", "buy", null);
    String pendingNo = order(c, "limit", "buy", "4000.00");
    assertThat(Long.parseLong(orderNo)).isGreaterThan((1L << 53) - 1);
    JsonNode byNo = body(call(get("/api/admin/orders?keyword=" + orderNo), view.cookie(), null));
    assertThat(byNo.get("total").asLong()).isEqualTo(1);
    assertThat(byNo.get("items").get(0).get("id").asString()).isEqualTo(orderNo);
    assertThat(byNo.get("items").get(0).get("customerId").asLong()).isEqualTo(c.id());
    JsonNode byCustomer = body(call(get("/api/admin/orders?keyword=" + c.id()), view.cookie(), null));
    assertThat(byCustomer.get("total").asLong()).as("客户号照常能搜").isEqualTo(2);
    assertThat(body(call(get("/api/admin/pending?keyword=" + pendingNo), view.cookie(), null)).get("items").get(0).get("id").asString()).isEqualTo(pendingNo);
    String posNo = jdbc.queryForObject("SELECT p.public_no FROM trading_position p JOIN trading_order o ON o.position_id = p.id WHERE o.public_no = ?", String.class,
        Long.parseLong(orderNo));
    JsonNode pos = body(call(get("/api/admin/positions?keyword=" + posNo), view.cookie(), null));
    assertThat(pos.get("total").asLong()).isEqualTo(1);
    assertThat(pos.get("items").get(0).get("id").asString()).isEqualTo(posNo);
    assertThat(body(call(get("/api/admin/orders?keyword=999999999999999999"), view.cookie(), null)).get("total").asLong()).as("没有这个编号").isEqualTo(0);
  }

  /** M-19（修复 fxsystem T2"改了不同步"）：后台改加点后，下一条报价立即按新加点算买卖价，只加一次；改回 0 后也立即生效 */
  @Test
  void 后台改加点后下一条报价立即按新加点_M19() throws Exception {
    Admin m = withRoles(role(Permission.SYMBOL_VIEW, Permission.SYMBOL_EDIT));
    String before = jdbc.queryForObject("SELECT markup FROM market_symbol WHERE code = 'GBPUSD'", String.class);
    try {
      processor.process(new RawQuote("GBPUSD", new BigDecimal("1.27000"), new BigDecimal("1.27010"), FixedClockConfig.NOW));
      var q0 = processor.book().get("GBPUSD").orElseThrow().quote();
      assertThat(q0.bid()).isEqualByComparingTo(new BigDecimal("1.27000").subtract(new BigDecimal(before)));

      JsonNode u = body(call(put("/api/admin/symbols/GBPUSD"), m.cookie(), "{\"markup\":\"0.00020\",\"reason\":\"调整加点\"}"));
      assertThat(u.get("markup").asString()).isEqualTo("0.0002");
      processor.process(new RawQuote("GBPUSD", new BigDecimal("1.27002"), new BigDecimal("1.27012"), FixedClockConfig.NOW.plusSeconds(1)));
      var q1 = processor.book().get("GBPUSD").orElseThrow().quote();
      assertThat(q1.bid()).as("卖价减新加点").isEqualByComparingTo("1.26982");
      assertThat(q1.ask()).as("买价加新加点").isEqualByComparingTo("1.27032");
      assertThat(q1.mid()).as("中间价不含加点（K 线用）").isEqualByComparingTo("1.27007");

      body(call(put("/api/admin/symbols/GBPUSD"), m.cookie(), "{\"markup\":\"0\",\"reason\":\"取消加点\"}"));
      processor.process(new RawQuote("GBPUSD", new BigDecimal("1.27004"), new BigDecimal("1.27014"), FixedClockConfig.NOW.plusSeconds(2)));
      var q2 = processor.book().get("GBPUSD").orElseThrow().quote();
      assertThat(q2.bid()).isEqualByComparingTo("1.27004");
      assertThat(q2.ask()).isEqualByComparingTo("1.27014");
    } finally {
      jdbc.update("UPDATE market_symbol SET markup = ? WHERE code = 'GBPUSD'", before);
      catalog.reload();
    }
  }

  @Test
  void 品种_改参数有前后审计_有持仓不能停用_休市日增删_时段和汇率() throws Exception {
    Admin m = withRoles(role(Permission.SYMBOL_VIEW, Permission.SYMBOL_EDIT, Permission.SESSION_VIEW, Permission.SESSION_EDIT, Permission.FX_VIEW));
    String swap = jdbc.queryForObject("SELECT swap_long FROM market_symbol WHERE code = 'EURUSD'", String.class);
    try {
      JsonNode list = body(call(get("/api/admin/symbols?keyword=eur&pageSize=100"), m.cookie(), null));
      assertThat(list.toString()).contains("\"code\":\"EURUSD\"");
      assertThat(call(put("/api/admin/symbols/EURUSD"), m.cookie(), "{\"swapLong\":\"-0.0001\"}").getStatus()).isEqualTo(400);
      assertThat(call(put("/api/admin/symbols/EURUSD"), m.cookie(), "{\"swapLong\":\"-0.5\",\"reason\":\"x\"}").getContentAsString()).contains("\"field\":\"swapLong\"");
      JsonNode u = body(call(put("/api/admin/symbols/EURUSD"), m.cookie(), "{\"swapLong\":\"-0.0001\",\"reason\":\"LP 给的费率\"}"));
      assertThat(u.get("swapLong").asString()).isEqualTo("-0.0001");
      assertThat(jdbc.queryForObject("SELECT CONCAT(before_json, '|', after_json) FROM admin_audit_log WHERE action = 'symbol.update' AND reason = 'LP 给的费率' "
          + "ORDER BY id DESC LIMIT 1", String.class)).contains("\"swapLong\":\"-0.0001\"").doesNotContain("nameZh");
      assertThat(body(call(get("/api/admin/symbols?missingSwap=true&pageSize=100"), m.cookie(), null)).toString()).doesNotContain("\"code\":\"EURUSD\"");
    } finally {
      jdbc.update("UPDATE market_symbol SET swap_long = ? WHERE code = 'EURUSD'", swap);
    }
    Customer c = customer("2000");
    order(c, "market", "buy", null);
    assertThat(call(post("/api/admin/symbols/XAUUSD/enabled"), m.cookie(), "{\"value\":false,\"reason\":\"下架\"}").getContentAsString()).contains("SYMBOL_IN_USE");

    assertThat(body(call(get("/api/admin/sessions"), m.cookie(), null)).toString()).contains("\"symbol\":\"XAUUSD\"").contains("\"day\":1");
    JsonNode h = body(call(post("/api/admin/holidays"), m.cookie(), "{\"symbol\":\"AUS200\",\"date\":\"2026-12-25\",\"reason\":\"圣诞\"}"));
    assertThat(call(post("/api/admin/holidays"), m.cookie(), "{\"symbol\":\"AUS200\",\"date\":\"2026-12-25\"}").getContentAsString()).contains("HOLIDAY_EXISTS");
    assertThat(call(post("/api/admin/holidays"), m.cookie(), "{\"symbol\":\"AUS200\",\"date\":\"2026-01-01\"}").getContentAsString()).contains("\"code\":\"past\"");
    assertThat(call(post("/api/admin/holidays"), m.cookie(), "{\"symbol\":\"NOPE\",\"date\":\"2026-12-26\"}").getContentAsString()).contains("\"field\":\"symbol\"");
    assertThat(body(call(get("/api/admin/holidays"), m.cookie(), null)).toString()).contains("\"date\":\"2026-12-25\",\"symbol\":\"AUS200\"");
    assertThat(call(delete("/api/admin/holidays/" + h.get("id").asString()), m.cookie(), null).getStatus()).isEqualTo(200);
    assertThat(body(call(get("/api/admin/holidays"), m.cookie(), null)).toString()).doesNotContain("2026-12-25");

    JsonNode fx = body(call(get("/api/admin/fx-rates"), m.cookie(), null));
    assertThat(fx.toString()).contains("\"currency\":\"JPY\"").contains("\"currency\":\"HKD\",\"pair\":\"HKDUSD\",\"rate\":\"0.1285347\",\"source\":\"fixed\"");
  }

  @Test
  void 交易参数_追保线和通知间隔_立即生效_不在系统配置页() throws Exception {
    Admin p = withRoles(role(Permission.PARAMS_VIEW, Permission.PARAMS_EDIT, Permission.CONFIG_VIEW, Permission.CONFIG_EDIT));
    try {
      JsonNode before = body(call(get("/api/admin/params"), p.cookie(), null));
      assertThat(before.get("marginCallLevel").asString()).isEqualTo("100");
      assertThat(before.get("marginCallThrottleMinutes").asInt()).isEqualTo(5);
      assertThat(before.get("liquidationLevel").isNull()).as("逐仓，没有账户级强平线（G6）").isTrue();
      assertThat(call(put("/api/admin/params"), p.cookie(), "{\"marginCallLevel\":\"120\"}").getStatus()).isEqualTo(400);
      assertThat(call(put("/api/admin/params"), p.cookie(), "{\"marginCallLevel\":\"0\",\"reason\":\"x\"}").getContentAsString()).contains("marginCallLevel");
      JsonNode after = body(call(put("/api/admin/params"), p.cookie(), "{\"marginCallLevel\":\"120\",\"marginCallThrottleMinutes\":30,\"reason\":\"收紧\"}"));
      assertThat(after.get("marginCallLevel").asString()).isEqualTo("120");
      assertThat(after.get("marginCallThrottleMinutes").asInt()).isEqualTo(30);
      assertThat(after.get("updatedBy").asString()).isEqualTo(p.username());
      assertThat(config.decimal(ConfigKey.TRADING_MARGIN_CALL_LEVEL, null)).isEqualByComparingTo("120");
      // 有 config:edit 也不能从系统配置页改这两项（防止绕过 params:edit、risk:user_limit）
      assertThat(body(call(get("/api/admin/configs"), p.cookie(), null)).toString()).doesNotContain("trading.marginCallLevel").doesNotContain("risk.perUserLimitUsd");
      assertThat(call(put("/api/admin/configs/trading.marginCallLevel"), p.cookie(), "{\"value\":\"10\",\"reason\":\"x\"}").getStatus()).isEqualTo(404);
    } finally {
      jdbc.update("UPDATE common_config SET value = ? WHERE config_key = ?", "100", ConfigKey.TRADING_MARGIN_CALL_LEVEL.key);
      jdbc.update("UPDATE common_config SET value = ? WHERE config_key = ?", "5", ConfigKey.NOTIFY_MARGIN_CALL_THROTTLE_MINUTES.key);
      config.refresh();
    }
  }

  @Test
  void 仪表盘_今天的数字() throws Exception {
    Admin d = withRoles(role(Permission.DASHBOARD_VIEW));
    customer("10");
    JsonNode s = body(call(get("/api/admin/dashboard"), d.cookie(), null));
    assertThat(s.get("todayRegistrations").asLong()).isGreaterThanOrEqualTo(1);
    assertThat(s.get("onlineCustomers").asLong()).isGreaterThanOrEqualTo(1);
    assertThat(s.has("platformPnl")).isTrue();
    assertThat(s.has("openReconciliations")).isTrue();
    assertThat(call(get("/api/admin/risk"), d.cookie(), null).getStatus()).isEqualTo(403);
    assertThat(body(call(get("/api/admin/trade-symbols"), d.cookie(), null)).toString()).contains("XAUUSD");
  }
}
