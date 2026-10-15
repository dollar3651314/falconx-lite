package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.falconx.lite.risk.api.RiskApi;
import jakarta.servlet.http.Cookie;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

/** 风控对交易的影响（S11）：暂停后拒单、客户看不到风控信息（T5）、自动强平开关。 */
class RiskOrderTest extends TradingTestSupport {

  @Autowired RiskApi risk;
  @Autowired MatchingEngine engine;

  @AfterEach
  void reset() {
    engine.setEnabled(false);
    jdbc.update("UPDATE risk_switch SET global_open_paused = 0, auto_global_paused = 0, auto_liquidation = 1, platform_net_threshold = NULL WHERE id = 1");
    jdbc.update("DELETE FROM risk_symbol");
    quote("XAUUSD", "4126.35", "4126.75");
  }

  @Test
  void 品种自动禁开和手动暂停_都按品种暂停拒单_恢复后可以下单() {
    long uid = newUser("5000");
    jdbc.update("INSERT INTO risk_symbol (symbol, auto_paused) VALUES ('XAUUSD', 1)");
    assertThat(code(() -> orders.place(uid, market("XAUUSD", "buy", "0.10", 100)))).isEqualTo("SYMBOL_PAUSED");
    assertThat(code(() -> orders.place(uid, market("EURJPY", "buy", "0.10", 100)))).as("别的品种不受影响").isEqualTo("OK");
    risk.resumeSymbol("XAUUSD", 1L);
    assertThat(code(() -> orders.place(uid, market("XAUUSD", "buy", "0.10", 100)))).isEqualTo("OK");
    risk.pauseSymbol("XAUUSD", 1L);
    assertThat(code(() -> orders.place(uid, market("XAUUSD", "buy", "0.10", 100)))).isEqualTo("SYMBOL_PAUSED");
  }

  @Test
  void 平台自动禁开时全部拒单_平仓不受影响() {
    long uid = newUser("5000");
    orders.place(uid, market("XAUUSD", "buy", "0.10", 100));
    long pid = orders.positions(uid).getFirst().id;
    jdbc.update("UPDATE risk_switch SET auto_global_paused = 1 WHERE id = 1");
    assertThat(code(() -> orders.place(uid, market("EURJPY", "buy", "0.10", 100)))).isEqualTo("GLOBAL_PAUSED");
    assertThat(code(() -> orders.place(uid, new PlaceOrder("XAUUSD", "limit", "buy", "0.10", 100, "4000.00", null, null, UUID.randomUUID().toString()))))
        .as("挂单也不行").isEqualTo("GLOBAL_PAUSED");
    assertThat(code(() -> positionsService().close(uid, pid))).as("只能平仓").isEqualTo("OK");
  }

  @Autowired PositionService positionService;

  PositionService positionsService() {
    return positionService;
  }

  @Test
  void 客户看到的拒单原因不含风控信息_T5() throws Exception {
    Cookie c = login();
    jdbc.update("INSERT INTO risk_symbol (symbol, net_threshold, auto_paused) VALUES ('XAUUSD', 1000, 1)");
    String body = mvc.perform(post("/api/trading/orders").cookie(c).contentType(MediaType.APPLICATION_JSON)
        .content("{\"symbol\":\"XAUUSD\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.10\",\"leverage\":100,\"clientOrderId\":\"t5-1\"}"))
        .andReturn().getResponse().getContentAsString();
    assertThat(body).contains("\"code\":\"SYMBOL_PAUSED\"").doesNotContain("敞口").doesNotContain("1000").doesNotContainIgnoringCase("exposure")
        .doesNotContainIgnoringCase("threshold");
  }

  @Test
  void 关闭自动强平后触及强平价不平_止盈照常() throws Exception {
    long uid = newUser("1000");
    long liqOrder = Long.parseLong(orders.place(uid, market("XAUUSD", "buy", "0.10", 200)).id());
    long tpOrder = Long.parseLong(orders.place(uid, new PlaceOrder("XAUUSD", "market", "sell", "0.10", 200, null, "4115.00", null, UUID.randomUUID().toString())).id());
    risk.setAutoLiquidation(false, 1L);
    engine.setEnabled(true);
    // 多单强平价 4116.43；空单止盈 4115（看 ask）
    quote("XAUUSD", "4110.00", "4110.40");
    long t0 = System.nanoTime();
    while (!"CLOSED".equals(status(tpOrder)) && System.nanoTime() - t0 < 3_000_000_000L) Thread.sleep(10);
    assertThat(status(tpOrder)).isEqualTo("CLOSED");
    Thread.sleep(200);
    assertThat(status(liqOrder)).as("自动强平关闭").isEqualTo("OPEN");
    risk.setAutoLiquidation(true, 1L);
    quote("XAUUSD", "4110.10", "4110.50");
    t0 = System.nanoTime();
    while (!"CLOSED".equals(status(liqOrder)) && System.nanoTime() - t0 < 3_000_000_000L) Thread.sleep(10);
    assertThat(status(liqOrder)).as("重新打开后强平").isEqualTo("CLOSED");
  }

  String status(long orderId) {
    return jdbc.queryForObject("SELECT status FROM trading_position WHERE order_id = ?", String.class, orderId);
  }
}
