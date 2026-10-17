package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.falconx.lite.market.api.MarketAdminApi;
import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.risk.api.RiskApi;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

/**
 * 两家报价源价格偏差过大时<b>只暂停开仓</b>（技术方案/v2-报价源接入.md 第 4 节，Amos 2026-10-17 选 B）：
 * <ul>
 *   <li>市价开仓、限价挂单、已有挂单成交都按"开仓"处理：拒单 / 不成交，客户看到的错误码是 {@code SYMBOL_PAUSED}（"品种暂停开仓"），不是"报价不可用"；</li>
 *   <li>客户平仓、止盈、止损、强平照常，按当前报价（偏差期间报价只来自主源，见 {@code QuoteRouterTest}）成交；</li>
 *   <li>偏差回落后自动恢复开仓；和品种自己的"暂停开仓"、风控的暂停互不覆盖。</li>
 * </ul>
 * 报价直接喂给行情主链路（{@code quote(...)} 是原始价）；XAUUSD 2 位小数，加点每边 10 点 = 0.10（V24，买卖合计 20 点），客户价 = 原始 bid − 0.10 / 原始 ask + 0.10。
 */
class QuoteDeviationOrderTest extends TradingTestSupport {

  @Autowired MatchingEngine engine;
  @Autowired PositionService positionService;
  @Autowired MarketApi market;
  @Autowired MarketAdminApi admin;
  @Autowired RiskApi risk;

  @AfterEach
  void reset() {
    engine.setEnabled(false);
    processor.setDeviationPaused("XAUUSD", false);
    jdbc.update("DELETE FROM risk_symbol");
    if (catalog.get("XAUUSD").orElseThrow().openPaused()) admin.updateSymbol("XAUUSD", patchOpenPaused(false));
    quote("XAUUSD", "4126.35", "4126.75");
  }

  static MarketAdminApi.SymbolPatch patchOpenPaused(boolean paused) {
    return new MarketAdminApi.SymbolPatch(null, null, null, null, null, null, null, null, null, null, null, null, null, paused, null);
  }

  static void await(BooleanSupplier ok) throws InterruptedException {
    long t0 = System.nanoTime();
    while (!ok.getAsBoolean()) {
      if (System.nanoTime() - t0 > 3_000_000_000L) throw new AssertionError("3 秒内没有完成");
      Thread.sleep(5);
    }
  }

  String positionStatus(long orderId) {
    return jdbc.queryForObject("SELECT status FROM trading_position WHERE order_id = ?", String.class, orderId);
  }

  BigDecimal closePrice(long orderId) {
    return jdbc.queryForObject("SELECT close_price FROM trading_position WHERE order_id = ?", BigDecimal.class, orderId);
  }

  String closeReason(long orderId) {
    return jdbc.queryForObject("SELECT close_reason FROM trading_position WHERE order_id = ?", String.class, orderId);
  }

  String orderStatus(long id) {
    return jdbc.queryForObject("SELECT status FROM trading_order WHERE id = ?", String.class, id);
  }

  PlaceOrder limit(String side, String price) {
    return new PlaceOrder("XAUUSD", "limit", side, "0.10", 100, price, null, null, UUID.randomUUID().toString());
  }

  @Test
  void 偏差时开仓被拒_报价照常可成交_客户平仓照常_恢复后能开仓() {
    long uid = newUser("5000");
    long open = orderId(orders.place(uid, market("XAUUSD", "buy", "0.10", 100)).id());
    long pid = orders.positions(uid).getFirst().id;

    processor.setDeviationPaused("XAUUSD", true);
    assertThat(market.quoteDeviationPaused("XAUUSD")).isTrue();
    assertThat(code(() -> orders.place(uid, market("XAUUSD", "buy", "0.10", 100)))).as("市价开仓").isEqualTo("SYMBOL_PAUSED");
    assertThat(code(() -> orders.place(uid, market("XAUUSD", "sell", "0.10", 100)))).as("反向开仓也是开仓").isEqualTo("SYMBOL_PAUSED");
    assertThat(code(() -> orders.place(uid, limit("buy", "4000.00")))).as("限价挂单").isEqualTo("SYMBOL_PAUSED");
    assertThat(code(() -> orders.place(uid, market("EURJPY", "buy", "0.10", 100)))).as("别的品种不受影响").isEqualTo("OK");

    MarketQuote q = market.quote("XAUUSD").orElseThrow();
    assertThat(q.executable()).as("报价没有被判为不可成交").isTrue();
    assertThat(q.bid()).as("原始 4126.35 − 加点 0.10").isEqualByComparingTo("4126.25");
    assertThat(q.ask()).as("原始 4126.75 + 加点 0.10").isEqualByComparingTo("4126.85");

    assertThat(code(() -> positionService.close(uid, pid))).as("客户自己平仓照常").isEqualTo("OK");
    assertThat(closePrice(open)).as("多单按 bid 平仓").isEqualByComparingTo("4126.25");

    processor.setDeviationPaused("XAUUSD", false);
    assertThat(code(() -> orders.place(uid, market("XAUUSD", "buy", "0.10", 100)))).as("偏差回落后自动恢复开仓").isEqualTo("OK");
  }

  @Test
  void 偏差时止盈止损强平照常按当前报价成交_已有挂单不成交_恢复后挂单成交() throws Exception {
    long uid = newUser("2000");
    long tp = orderId(orders.place(uid, new PlaceOrder("XAUUSD", "market", "buy", "0.10", 100, null, "4135.00", null, UUID.randomUUID().toString())).id());
    long sl = orderId(orders.place(uid, new PlaceOrder("XAUUSD", "market", "sell", "0.10", 100, null, null, "4135.00", UUID.randomUUID().toString())).id());
    long pending = orderId(orders.place(uid, limit("buy", "4120.00")).id());
    long poor = newUser("300");
    // 200 倍多单，开仓价 ask 4126.85，强平价约 4116.53
    long liq = orderId(orders.place(poor, market("XAUUSD", "buy", "0.10", 200)).id());

    processor.setDeviationPaused("XAUUSD", true);
    engine.setEnabled(true);

    // 客户价 4135.50 / 4136.10：多单 bid 到止盈，空单 ask 到止损
    quote("XAUUSD", "4135.60", "4136.00");
    await(() -> "CLOSED".equals(positionStatus(tp)) && "CLOSED".equals(positionStatus(sl)));
    assertThat(closeReason(tp)).isEqualTo("TP");
    assertThat(closePrice(tp)).isEqualByComparingTo("4135.50");
    assertThat(closeReason(sl)).isEqualTo("SL");
    assertThat(closePrice(sl)).isEqualByComparingTo("4136.10");

    // 客户价 4100.00 / 4100.60：越过强平价 → 强平；买入挂单 ask 4100.60 ≤ 4120 触及限价，但挂单成交算开仓，不成交
    quote("XAUUSD", "4100.10", "4100.50");
    await(() -> "CLOSED".equals(positionStatus(liq)));
    assertThat(closeReason(liq)).isEqualTo("LIQUIDATED");
    assertThat(closePrice(liq)).isEqualByComparingTo("4100.00");
    Thread.sleep(300);
    assertThat(orderStatus(pending)).as("偏差期间挂单继续挂着").isEqualTo("PENDING");

    processor.setDeviationPaused("XAUUSD", false);
    quote("XAUUSD", "4118.00", "4118.40");
    await(() -> "FILLED".equals(orderStatus(pending)));
    BigDecimal openPrice = jdbc.queryForObject("SELECT open_price FROM trading_position WHERE order_id = ?", BigDecimal.class, pending);
    assertThat(openPrice).as("恢复后按当时的客户 ask 4118.50 成交").isEqualByComparingTo("4118.50");
  }

  @Test
  void 运营手动暂停和风控暂停不被偏差恢复覆盖_偏差暂停也不被运营打开覆盖() {
    long uid = newUser("5000");
    // 运营在后台设了品种暂停开仓，之后出现偏差、又恢复
    admin.updateSymbol("XAUUSD", patchOpenPaused(true));
    processor.setDeviationPaused("XAUUSD", true);
    processor.setDeviationPaused("XAUUSD", false);
    assertThat(catalog.get("XAUUSD").orElseThrow().openPaused()).as("品种自己的开关还是暂停").isTrue();
    assertThat(code(() -> orders.place(uid, market("XAUUSD", "buy", "0.10", 100)))).isEqualTo("SYMBOL_PAUSED");
    admin.updateSymbol("XAUUSD", patchOpenPaused(false));
    assertThat(code(() -> orders.place(uid, market("XAUUSD", "buy", "0.10", 100)))).isEqualTo("OK");

    // 风控暂停同理
    risk.pauseSymbol("XAUUSD", 1L);
    processor.setDeviationPaused("XAUUSD", true);
    processor.setDeviationPaused("XAUUSD", false);
    assertThat(risk.symbolOpenPaused("XAUUSD")).isTrue();
    assertThat(code(() -> orders.place(uid, market("XAUUSD", "buy", "0.10", 100)))).isEqualTo("SYMBOL_PAUSED");
    risk.resumeSymbol("XAUUSD", 1L);

    // 反过来：偏差期间运营打开品种开关，仍然暂停，直到偏差回落
    processor.setDeviationPaused("XAUUSD", true);
    admin.updateSymbol("XAUUSD", patchOpenPaused(false));
    assertThat(code(() -> orders.place(uid, market("XAUUSD", "buy", "0.10", 100)))).isEqualTo("SYMBOL_PAUSED");
    processor.setDeviationPaused("XAUUSD", false);
    assertThat(code(() -> orders.place(uid, market("XAUUSD", "buy", "0.10", 100)))).isEqualTo("OK");
  }

  @Test
  void 客户看到的是品种暂停开仓_不是报价不可用_品种列表显示暂停() throws Exception {
    Cookie c = login();
    processor.setDeviationPaused("XAUUSD", true);
    String body = mvc.perform(post("/api/trading/orders").cookie(c).contentType(MediaType.APPLICATION_JSON)
        .content("{\"symbol\":\"XAUUSD\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.10\",\"leverage\":100,\"clientOrderId\":\"dev-1\"}"))
        .andReturn().getResponse().getContentAsString();
    assertThat(body).contains("\"code\":\"SYMBOL_PAUSED\"").doesNotContain("QUOTE_UNAVAILABLE").doesNotContainIgnoringCase("alltick")
        .doesNotContainIgnoringCase("itick").doesNotContain("偏差");
    String symbols = mvc.perform(get("/api/market/symbols").cookie(c)).andReturn().getResponse().getContentAsString();
    assertThat(symbols).contains("\"code\":\"XAUUSD\"");
    String xau = symbols.substring(symbols.indexOf("\"code\":\"XAUUSD\""));
    xau = xau.substring(0, xau.indexOf('}'));
    assertThat(xau).as("客户端品种列表显示暂停开仓").contains("\"openPaused\":true");
    processor.setDeviationPaused("XAUUSD", false);
    symbols = mvc.perform(get("/api/market/symbols").cookie(c)).andReturn().getResponse().getContentAsString();
    xau = symbols.substring(symbols.indexOf("\"code\":\"XAUUSD\""));
    assertThat(xau.substring(0, xau.indexOf('}'))).contains("\"openPaused\":false");
  }
}
