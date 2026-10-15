package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;

import com.falconx.lite.trading.api.Bucket;
import com.falconx.lite.trading.api.LedgerCommand;
import com.falconx.lite.trading.api.LedgerEntryType;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 撮合引擎（S9）：挂单成交、止盈止损、强平。引擎在测试配置里默认关闭，这里每个测试打开。
 * 价格保持在 3999–4187 之间：时钟固定时所有报价在同一个 60 秒波动窗口里，超过 5% 会被质量守卫判为异常。
 */
class MatchingEngineTest extends TradingTestSupport {

  @Autowired MatchingEngine engine;

  @BeforeEach
  void on() {
    engine.setEnabled(true);
  }

  @AfterEach
  void off() {
    engine.setEnabled(false);
    quote("XAUUSD", "4126.35", "4126.75");
  }

  /** 等条件成立，返回等了多少毫秒；超过 3 秒失败 */
  static long await(BooleanSupplier ok) throws InterruptedException {
    long t0 = System.nanoTime();
    while (!ok.getAsBoolean()) {
      if (System.nanoTime() - t0 > 3_000_000_000L) throw new AssertionError("3 秒内没有完成");
      Thread.sleep(5);
    }
    return (System.nanoTime() - t0) / 1_000_000;
  }

  String orderStatus(long id) {
    return jdbc.queryForObject("SELECT status FROM trading_order WHERE id = ?", String.class, id);
  }

  record Pos(long id, String status, BigDecimal openPrice, BigDecimal closePrice, BigDecimal pnl, String reason, BigDecimal tp, BigDecimal sl) {}

  Pos positionOfOrder(long orderId) {
    List<Pos> l = jdbc.query("SELECT id, status, open_price, close_price, realized_pnl, close_reason, take_profit, stop_loss FROM trading_position WHERE order_id = ?",
        (rs, i) -> new Pos(rs.getLong(1), rs.getString(2), rs.getBigDecimal(3), rs.getBigDecimal(4), rs.getBigDecimal(5), rs.getString(6), rs.getBigDecimal(7), rs.getBigDecimal(8)),
        orderId);
    return l.isEmpty() ? null : l.getFirst();
  }

  long limit(long uid, String side, String price, String tp, String sl) {
    return Long.parseLong(orders.place(uid, new PlaceOrder("XAUUSD", "limit", side, "0.10", 100, price, tp, sl, UUID.randomUUID().toString())).id());
  }

  long marketWith(long uid, String side, int lev, String tp, String sl) {
    return Long.parseLong(orders.place(uid, new PlaceOrder("XAUUSD", "market", side, "0.10", lev, null, tp, sl, UUID.randomUUID().toString())).id());
  }

  @Test
  void 买入限价单_ask跌到限价时成交_按更优的市价_带上止盈止损_1秒内() throws Exception {
    long uid = newUser("1000");
    long id = limit(uid, "buy", "4120.00", "4200.00", "4050.00");
    quote("XAUUSD", "4118.00", "4118.40");
    long ms = await(() -> "FILLED".equals(orderStatus(id)));
    assertThat(ms).as("AC-13：从收到价格到写入成交").isLessThan(1000);
    Pos p = positionOfOrder(id);
    assertThat(p.openPrice()).as("ask 4118.40 比限价 4120 更好").isEqualByComparingTo("4118.40");
    assertThat(p.tp()).isEqualByComparingTo("4200");
    assertThat(p.sl()).isEqualByComparingTo("4050");
    assertThat(bucket(uid, "order_frozen")).isEqualByComparingTo("0");
    // 手续费按成交价：4118.40 × 10 × 0.005% = 2.0592
    assertThat(bucket(uid, "balance")).isEqualByComparingTo("997.9408");
    assertThat(ledgerSum(uid, "ORDER_FROZEN")).isEqualByComparingTo("0");
    assertThat(ledgerSum(uid, "BALANCE")).isEqualByComparingTo(bucket(uid, "balance"));
    // 挂单成交通知（X-04）
    assertThat(notices(uid)).singleElement().asString().startsWith("ORDER_FILLED").contains("\"symbol\":\"XAUUSD\"").contains("\"price\":\"4118.40\"");
  }

  @Test
  void 卖出限价单_bid涨到限价时成交_没到的不成交() throws Exception {
    long uid = newUser("2000");
    long sell = limit(uid, "sell", "4140.00", null, null);
    long far = limit(uid, "buy", "4050.00", null, null);
    quote("XAUUSD", "4141.00", "4141.40");
    await(() -> "FILLED".equals(orderStatus(sell)));
    assertThat(positionOfOrder(sell).openPrice()).isEqualByComparingTo("4141.00");
    Thread.sleep(200);
    assertThat(orderStatus(far)).isEqualTo("PENDING");
  }

  @Test
  void 止盈_多单bid到止盈价按市价平仓() throws Exception {
    long uid = newUser("1000");
    long id = marketWith(uid, "buy", 100, "4135.00", null);
    quote("XAUUSD", "4135.50", "4135.90");
    await(() -> "CLOSED".equals(positionOfOrder(id).status()));
    Pos p = positionOfOrder(id);
    assertThat(p.reason()).isEqualTo("TP");
    assertThat(p.closePrice()).isEqualByComparingTo("4135.50");
    // (4135.50 − 4126.75) × 10 = 87.5
    assertThat(p.pnl()).isEqualByComparingTo("87.5");
    assertThat(ledgerSum(uid, "BALANCE")).isEqualByComparingTo(bucket(uid, "balance"));
    // 市价单是客户自己下的，不通知；止盈触发通知
    assertThat(notices(uid)).singleElement().asString().startsWith("TP_SL_TRIGGERED").contains("\"trigger\":\"TP\"").contains("\"price\":\"4135.50\"");
  }

  @Test
  void 止损_空单ask到止损价按市价平仓() throws Exception {
    long uid = newUser("1000");
    long id = marketWith(uid, "sell", 100, null, "4135.00");
    quote("XAUUSD", "4135.50", "4135.90");
    await(() -> "CLOSED".equals(positionOfOrder(id).status()));
    Pos p = positionOfOrder(id);
    assertThat(p.reason()).isEqualTo("SL");
    assertThat(p.closePrice()).isEqualByComparingTo("4135.90");
    // (4126.35 − 4135.90) × 10 = −95.5
    assertThat(p.pnl()).isEqualByComparingTo("-95.5");
    assertThat(notices(uid)).singleElement().asString().startsWith("TP_SL_TRIGGERED").contains("\"trigger\":\"SL\"");
  }

  @Test
  void 强平优先于止损_跳空越过强平价时亏损封顶_余额不为负_AC14() throws Exception {
    long uid = newUser("300");
    // 200 倍：保证金 206.3375，强平价 4116.43
    long id = marketWith(uid, "buy", 200, null, "4110.00");
    quote("XAUUSD", "4100.00", "4100.40");
    await(() -> "CLOSED".equals(positionOfOrder(id).status()));
    Pos p = positionOfOrder(id);
    assertThat(p.reason()).isEqualTo("LIQUIDATED");
    assertThat(p.closePrice()).isEqualByComparingTo("4100.00");
    // 实际亏损 (4100 − 4126.75) × 10 = −267.5，封顶为保证金
    assertThat(p.pnl()).isEqualByComparingTo("-206.3375");
    // 强平通知，不再另发止损通知
    assertThat(notices(uid)).singleElement().asString().startsWith("LIQUIDATED").contains("\"price\":\"4100.00\"");
    assertThat(bucket(uid, "balance")).isEqualByComparingTo(new BigDecimal("300").subtract(new BigDecimal("2.063375")).subtract(new BigDecimal("206.3375")));
  }

  @Test
  void 全局暂停时挂单不成交_恢复后成交() throws Exception {
    long uid = newUser("1000");
    long id = limit(uid, "buy", "4120.00", null, null);
    jdbc.update("UPDATE risk_switch SET global_open_paused = 1 WHERE id = 1");
    try {
      quote("XAUUSD", "4118.00", "4118.40");
      Thread.sleep(300);
      assertThat(orderStatus(id)).isEqualTo("PENDING");
    } finally {
      jdbc.update("UPDATE risk_switch SET global_open_paused = 0 WHERE id = 1");
    }
    quote("XAUUSD", "4118.10", "4118.50");
    await(() -> "FILLED".equals(orderStatus(id)));
    assertThat(positionOfOrder(id).openPrice()).isEqualByComparingTo("4118.50");
  }

  @Test
  void 成交时可用余额不足就撤销挂单_冻结全部释放() throws Exception {
    long uid = newUser("500");
    long id = limit(uid, "buy", "4120.00", null, null);
    // 挂单后余额被扣到 300（模拟别的扣款），不够成交需要的约 414
    ledger.apply(new LedgerCommand(uid, Bucket.BALANCE, new BigDecimal("-200"), LedgerEntryType.ADMIN_ADJUST, "TEST", "adj-" + uid, "测试扣款"));
    quote("XAUUSD", "4118.00", "4118.40");
    await(() -> "CANCELLED".equals(orderStatus(id)));
    assertThat(positionOfOrder(id)).isNull();
    assertThat(bucket(uid, "order_frozen")).isEqualByComparingTo("0");
    assertThat(bucket(uid, "balance")).isEqualByComparingTo("300");
  }

  @Test
  void 二十个持仓同时触及强平价_1秒内全部强平_AC13() throws Exception {
    List<Long> ids = new ArrayList<>();
    for (int i = 0; i < 20; i++) ids.add(marketWith(newUser("300"), "buy", 200, null, null));
    quote("XAUUSD", "4110.00", "4110.40");
    long ms = await(() -> ids.stream().allMatch(id -> "CLOSED".equals(positionOfOrder(id).status())));
    assertThat(ms).isLessThan(1000);
    assertThat(ids).allMatch(id -> "LIQUIDATED".equals(positionOfOrder(id).reason()));
  }
}
