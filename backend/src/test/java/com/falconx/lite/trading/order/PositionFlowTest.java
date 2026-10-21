package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.falconx.lite.common.error.ValidationException;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

/**
 * 持仓操作（S8）：平仓、止盈止损、追加保证金、改单、历史。公共设置见 {@link TradingTestSupport}。
 * 报价是原始价，客户价含加点（V24：买卖合计 20 点 = 每边 10 点，XAUUSD 每边 0.10）：原始 4126.35 / 4126.75 → 客户 4126.25 / 4126.85，多单按 4126.85 开仓。
 */
class PositionFlowTest extends TradingTestSupport {

  @Autowired PositionService positions;

  long openGold(long uid, String lots, int lev) {
    orders.place(uid, market("XAUUSD", "buy", lots, lev));
    return orders.positions(uid).getFirst().id;
  }

  record P(String status, BigDecimal margin, BigDecimal liquidationPrice, BigDecimal takeProfit, BigDecimal stopLoss, BigDecimal realizedPnl, String closeReason) {}

  P position(long id) {
    return jdbc.queryForObject("SELECT status, margin, liquidation_price, take_profit, stop_loss, realized_pnl, close_reason FROM trading_position WHERE id = ?",
        (rs, i) -> new P(rs.getString(1), rs.getBigDecimal(2), rs.getBigDecimal(3), rs.getBigDecimal(4), rs.getBigDecimal(5), rs.getBigDecimal(6), rs.getString(7)), id);
  }

  @Test
  void 平仓盈利_多单按bid平_盈亏入账_账本和余额一致() {
    long uid = newUser("1000");
    long id = openGold(uid, "0.10", 100);
    quote("XAUUSD", "4136.35", "4136.75");
    var c = positions.close(uid, id);
    // 客户卖价 4136.35 − 0.10 = 4136.25；(4136.25 − 4126.85) × 0.1 × 100 = 94
    assertThat(c.pnl()).isEqualByComparingTo("94");
    assertThat(c.price()).isEqualByComparingTo("4136.25");
    P p = position(id);
    assertThat(p.status()).isEqualTo("CLOSED");
    assertThat(p.realizedPnl()).isEqualByComparingTo("94");
    assertThat(p.closeReason()).isEqualTo("CLOSED");
    // 1000 − 手续费 2.063425 + 94
    assertThat(bucket(uid, "balance")).isEqualByComparingTo("1091.936575");
    assertThat(ledgerSum(uid, "BALANCE")).isEqualByComparingTo(bucket(uid, "balance"));
    assertThat(code(() -> positions.close(uid, id))).as("不能重复平仓").isEqualTo("NOT_FOUND");
    // 体验优化 1021 UX-9：手动平仓发站内信 POSITION_CLOSED（只发站内信，不推送、不发邮件），只发一次
    assertThat(notices(uid)).filteredOn(n -> n.startsWith("POSITION_CLOSED")).singleElement().asString()
        .contains("\"symbol\":\"XAUUSD\"").contains("\"side\":\"BUY\"").contains("\"lots\":\"0.10\"").contains("\"price\":\"4136.25\"").contains("\"pnl\":\"94\"");
    assertThat(jdbc.queryForList("SELECT channel FROM notify_record WHERE user_id = ? AND template_code IN ('POSITION_OPENED', 'POSITION_CLOSED')", String.class, uid))
        .isNotEmpty().containsOnly("INBOX");
  }

  @Test
  void 逐仓亏损最多亏掉保证金_余额不会变负() {
    long uid = newUser("300");
    long id = openGold(uid, "0.10", 200);
    quote("XAUUSD", "3999.60", "4000.00");
    var c = positions.close(uid, id);
    // 实际亏损 (3999.50 − 4126.85) × 10 = −1273.5，封顶为保证金 −206.3425
    assertThat(c.pnl()).isEqualByComparingTo("-206.3425");
    assertThat(bucket(uid, "balance")).isEqualByComparingTo(new BigDecimal("300").subtract(new BigDecimal("2.063425")).subtract(new BigDecimal("206.3425")));
    assertThat(bucket(uid, "balance").signum()).isPositive();
  }

  @Test
  void 浮动盈利不能用来开新仓或追加保证金() {
    long uid = newUser("500");
    long id = openGold(uid, "0.10", 100);
    // 时钟固定时所有报价在同一个 60 秒波动窗口里，各测试的价格合计波动要小于 5%，否则质量守卫判为异常
    quote("XAUUSD", "4186.35", "4186.75");
    // 浮盈 (4186.25 − 4126.85) × 10 = 594，但可用 = 500 − 2.063425 − 412.685 = 85.251575
    assertThat(code(() -> orders.place(uid, market("XAUUSD", "buy", "0.10", 100)))).isEqualTo("INSUFFICIENT_BALANCE");
    assertThat(code(() -> positions.addMargin(uid, id, "100"))).isEqualTo("MARGIN_INSUFFICIENT");
    assertThat(code(() -> positions.addMargin(uid, id, "85.26"))).as("比可用多 0.008425").isEqualTo("MARGIN_INSUFFICIENT");
    assertThat(code(() -> positions.addMargin(uid, id, "85.25"))).isEqualTo("OK");
    var c = positions.close(uid, id);
    assertThat(c.pnl()).isEqualByComparingTo("594");
    assertThat(bucket(uid, "balance")).isEqualByComparingTo("1091.936575");
  }

  @Test
  void 交易时段外不能平仓() {
    long uid = newUser("1000");
    long id = openGold(uid, "0.10", 100);
    jdbc.update("INSERT IGNORE INTO market_holiday (symbol, trade_date, reason) VALUES ('XAUUSD', '2026-10-14', '测试')");
    catalog.reload();
    try {
      assertThat(code(() -> positions.close(uid, id))).isEqualTo("TRADING_CLOSED");
    } finally {
      jdbc.update("DELETE FROM market_holiday WHERE symbol = 'XAUUSD'");
      catalog.reload();
    }
    assertThat(position(id).status()).isEqualTo("OPEN");
  }

  @Test
  void 修改止盈止损_方向以当前平仓价为基准_可以取消() {
    long uid = newUser("1000");
    long id = openGold(uid, "0.10", 100);
    positions.updateTpSl(uid, id, "4200.00", "4050.00");
    assertThat(position(id).takeProfit()).isEqualByComparingTo("4200");
    assertThat(position(id).stopLoss()).isEqualByComparingTo("4050");
    // 当前客户 bid 4126.25：止盈 4120 低于平仓价、止损 4130 高于平仓价，两个错误一次返回
    assertThatThrownBy(() -> positions.updateTpSl(uid, id, "4120.00", "4130.00"))
        .isInstanceOfSatisfying(ValidationException.class, e -> assertThat(e.fields())
            .containsExactlyInAnyOrder(new ValidationException.Field("takeProfit", "tpBuy"), new ValidationException.Field("stopLoss", "slBuy")));
    positions.updateTpSl(uid, id, null, "");
    assertThat(position(id).takeProfit()).isNull();
    assertThat(position(id).stopLoss()).isNull();
    long other = newUser("0");
    assertThat(code(() -> positions.updateTpSl(other, id, "4200.00", null))).as("不能改别人的持仓").isEqualTo("NOT_FOUND");
  }

  @Test
  void 追加保证金_按开仓时的维持保证金率重算强平价_T11() {
    long uid = newUser("1000");
    long id = openGold(uid, "0.10", 100);
    // 开仓后把品种的维持保证金率改成 1%，已有持仓仍按开仓时的 0.25% 计算
    jdbc.update("UPDATE market_symbol SET maintenance_margin_rate = 0.01 WHERE code = 'XAUUSD'");
    catalog.reload();
    try {
      PositionRow p = positions.addMargin(uid, id, "100");
      // 保证金 412.685 + 100 = 512.685；可亏 512.685 − 41,268.5 × 0.25% = 512.685 − 103.17125 = 409.51375；强平价 4126.85 − 40.951375 = 4085.898625 → 4085.90
      assertThat(p.margin).isEqualByComparingTo("512.685");
      assertThat(p.liquidationPrice).isEqualByComparingTo("4085.90");
      assertThat(position(id).liquidationPrice()).isEqualByComparingTo("4085.90");
    } finally {
      jdbc.update("UPDATE market_symbol SET maintenance_margin_rate = 0.0025 WHERE code = 'XAUUSD'");
      catalog.reload();
    }
    assertThat(bucket(uid, "balance")).as("追加保证金不改变余额").isEqualByComparingTo("997.936575");
    assertThatThrownBy(() -> positions.addMargin(uid, id, "1.234"))
        .isInstanceOfSatisfying(ValidationException.class, e -> assertThat(e.fields()).containsExactly(new ValidationException.Field("amount", "amountDigits")));
    // 可用 = 1000 − 2.063425 − 512.685 − 浮亏 6 = 479.251575
    assertThat(code(() -> positions.addMargin(uid, id, "500"))).isEqualTo("MARGIN_INSUFFICIENT");
  }

  @Test
  void 改单_冻结多退少补_账本和冻结一致_AC11() {
    long uid = newUser("2000");
    long id = orderId(orders.place(uid, new PlaceOrder("XAUUSD", "limit", "buy", "0.10", 100, "4100.00", null, null, UUID.randomUUID().toString())).id());
    assertThat(bucket(uid, "order_frozen")).isEqualByComparingTo("412.05");
    // 4000 × 0.2 × 100 = 80,000：保证金 800 + 手续费 4
    orders.modify(uid, id, new OrderService.ModifyOrder("4000.00", "0.20", "4100.00", "3900.00"));
    assertThat(bucket(uid, "order_frozen")).isEqualByComparingTo("804");
    orders.modify(uid, id, new OrderService.ModifyOrder("4100.00", "0.10", null, null));
    assertThat(bucket(uid, "order_frozen")).isEqualByComparingTo("412.05");
    assertThat(ledgerSum(uid, "ORDER_FROZEN")).isEqualByComparingTo(bucket(uid, "order_frozen"));
    assertThatThrownBy(() -> orders.modify(uid, id, new OrderService.ModifyOrder("4100.00", "0.10", "4000.00", null)))
        .isInstanceOfSatisfying(ValidationException.class, e -> assertThat(e.fields()).containsExactly(new ValidationException.Field("takeProfit", "tpBuy")));
    assertThat(code(() -> orders.modify(uid, id, new OrderService.ModifyOrder("4100.00", "1.00", null, null)))).isEqualTo("INSUFFICIENT_BALANCE");
    assertThat(bucket(uid, "order_frozen")).as("失败的改单不改变冻结").isEqualByComparingTo("412.05");
    orders.cancel(uid, id);
    assertThat(bucket(uid, "order_frozen")).isEqualByComparingTo("0");
    assertThat(ledgerSum(uid, "ORDER_FROZEN")).isEqualByComparingTo("0");
    assertThat(code(() -> orders.modify(uid, id, new OrderService.ModifyOrder("4100.00", "0.10", null, null)))).isEqualTo("NOT_FOUND");
  }

  @Test
  void 同一持仓并发平仓只平一次() throws Exception {
    long uid = newUser("1000");
    long id = openGold(uid, "0.10", 100);
    quote("XAUUSD", "4136.35", "4136.75");
    ExecutorService pool = Executors.newFixedThreadPool(5);
    CountDownLatch go = new CountDownLatch(1);
    List<Future<String>> fs = new ArrayList<>();
    for (int i = 0; i < 5; i++) fs.add(pool.submit(() -> {
      go.await();
      return code(() -> positions.close(uid, id));
    }));
    go.countDown();
    List<String> codes = new ArrayList<>();
    for (Future<String> f : fs) codes.add(f.get());
    pool.shutdown();
    assertThat(codes).containsOnlyOnce("OK");
    assertThat(codes.stream().filter("NOT_FOUND"::equals).count()).isEqualTo(4);
    assertThat(bucket(uid, "balance")).isEqualByComparingTo("1091.936575");
  }

  @Test
  void 接口_平仓_止盈止损_追加保证金_改单_历史() throws Exception {
    Cookie c = login();
    mvc.perform(post("/api/trading/orders").cookie(c).contentType(MediaType.APPLICATION_JSON)
        .content("{\"symbol\":\"XAUUSD\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.10\",\"leverage\":100,\"clientOrderId\":\"h-1\"}"));
    String pos = mvc.perform(get("/api/trading/positions").cookie(c)).andReturn().getResponse().getContentAsString();
    String pid = pos.replaceAll("(?s).*?\"id\":\"(\\d+)\".*", "$1");
    assertThat(mvc.perform(put("/api/trading/positions/" + pid + "/tpsl").cookie(c).contentType(MediaType.APPLICATION_JSON)
        .content("{\"takeProfit\":\"4200.00\"}")).andReturn().getResponse().getStatus()).isEqualTo(200);
    String m = mvc.perform(post("/api/trading/positions/" + pid + "/margin").cookie(c).contentType(MediaType.APPLICATION_JSON)
        .content("{\"amount\":\"100\"}")).andReturn().getResponse().getContentAsString();
    assertThat(m).contains("\"margin\":\"512.685\"").contains("\"liquidationPrice\":\"4085.90\"").contains("\"takeProfit\":\"4200.00\"");
    String pending = mvc.perform(post("/api/trading/orders").cookie(c).contentType(MediaType.APPLICATION_JSON)
        .content("{\"symbol\":\"XAUUSD\",\"type\":\"limit\",\"side\":\"buy\",\"lots\":\"0.10\",\"leverage\":100,\"limitPrice\":\"4100.00\",\"clientOrderId\":\"h-2\"}"))
        .andReturn().getResponse().getContentAsString();
    String oid = pending.replaceAll(".*\"id\":\"(\\d+)\".*", "$1");
    assertThat(mvc.perform(put("/api/trading/orders/" + oid).cookie(c).contentType(MediaType.APPLICATION_JSON)
        .content("{\"limitPrice\":\"4050.00\",\"lots\":\"0.10\"}")).andReturn().getResponse().getStatus()).isEqualTo(200);
    assertThat(mvc.perform(get("/api/trading/orders").cookie(c)).andReturn().getResponse().getContentAsString()).contains("\"limitPrice\":\"4050.00\"");
    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/trading/orders/" + oid).cookie(c));
    quote("XAUUSD", "4136.35", "4136.75");
    String closed = mvc.perform(post("/api/trading/positions/" + pid + "/close").cookie(c)).andReturn().getResponse().getContentAsString();
    assertThat(closed).contains("\"pnl\":\"94\"").contains("\"price\":\"4136.25\"");
    String h = mvc.perform(get("/api/trading/history").param("page", "1").param("pageSize", "10").cookie(c)).andReturn().getResponse().getContentAsString();
    assertThat(h).contains("\"total\":2").contains("\"kind\":\"closed\"").contains("\"kind\":\"cancelled\"").contains("\"pnl\":\"94\"")
        .contains("\"closePrice\":\"4136.25\"").contains("\"fee\":\"2.063425\"").contains("\"id\":\"P" + pid + "\"").contains("\"id\":\"O" + oid + "\"");
    assertThat(h.indexOf("\"kind\":\"closed\"")).as("最近的在前").isLessThan(h.indexOf("\"kind\":\"cancelled\""));
    assertThat(mvc.perform(post("/api/trading/positions/" + pid + "/close").cookie(c)).andReturn().getResponse().getStatus()).isEqualTo(404);
  }
}
