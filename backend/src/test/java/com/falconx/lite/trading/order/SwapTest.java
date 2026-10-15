package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 隔夜费（S10，AC-16）。直接调用 settleDue 并指定时间（定时任务在测试配置里关闭）。
 * 2026-10-14 是周三（交易日），结算时点 22:00 UTC；2026-10-17 是周六（外汇、贵金属没有交易时段）。
 */
class SwapTest extends TradingTestSupport {

  @Autowired SwapService swaps;
  @Autowired PositionService positions;

  void rates(String symbol, String longRate, String shortRate) {
    jdbc.update("UPDATE market_symbol SET swap_long = ?, swap_short = ? WHERE code = ?", new BigDecimal(longRate), new BigDecimal(shortRate), symbol);
    catalog.reload();
  }

  @AfterEach
  void reset() {
    jdbc.update("UPDATE market_symbol SET swap_long = 0, swap_short = 0 WHERE code IN ('XAUUSD', 'USDJPY')");
    jdbc.update("DELETE FROM market_holiday WHERE symbol = 'XAUUSD'");
    catalog.reload();
  }

  long open(long uid, String symbol, String side, String lots, int lev, String openedAt) {
    orders.place(uid, market(symbol, side, lots, lev));
    long id = orders.positions(uid).getFirst().id;
    jdbc.update("UPDATE trading_position SET opened_at = ? WHERE id = ?", openedAt, id);
    return id;
  }

  List<BigDecimal> swapRows(long positionId) {
    return jdbc.queryForList("SELECT amount FROM trading_swap WHERE position_id = ? ORDER BY rollover_date", BigDecimal.class, positionId);
  }

  BigDecimal col(long positionId, String col) {
    return jdbc.queryForObject("SELECT " + col + " FROM trading_position WHERE id = ?", BigDecimal.class, positionId);
  }

  int swapLedgerCount(long uid) {
    return jdbc.queryForObject("SELECT COUNT(*) FROM trading_ledger l JOIN trading_account a ON a.id = l.account_id WHERE a.user_id = ? AND l.entry_type = 'SWAP'",
        Integer.class, uid);
  }

  @Test
  void 多单负费率_从保证金扣_强平价重算_记账_只结算一次() {
    rates("XAUUSD", "-0.0001", "0");
    long uid = newUser("1000");
    long id = open(uid, "XAUUSD", "buy", "0.10", 100, "2026-10-14 09:00:00");
    swaps.settleDue(Instant.parse("2026-10-14T22:01:00Z"));
    // 0.1 × 100 × 4126.35（bid）× 0.0001 = 4.12635
    assertThat(swapRows(id)).singleElement().satisfies(a -> assertThat(a).isEqualByComparingTo("-4.12635"));
    assertThat(col(id, "margin")).isEqualByComparingTo("408.54865");
    // 可亏 408.54865 − 103.16875 = 305.3799，强平价 4126.75 − 30.53799 = 4096.21
    assertThat(col(id, "liquidation_price")).isEqualByComparingTo("4096.21");
    assertThat(col(id, "swap_total")).isEqualByComparingTo("-4.12635");
    assertThat(bucket(uid, "balance")).isEqualByComparingTo("993.810275");
    assertThat(ledgerSum(uid, "BALANCE")).isEqualByComparingTo(bucket(uid, "balance"));
    swaps.settleDue(Instant.parse("2026-10-14T23:30:00Z"));
    assertThat(swapRows(id)).hasSize(1);
    assertThat(bucket(uid, "balance")).isEqualByComparingTo("993.810275");
  }

  @Test
  void 空单正费率_返还进余额_保证金不变() {
    rates("XAUUSD", "0", "0.00005");
    long uid = newUser("1000");
    long id = open(uid, "XAUUSD", "sell", "0.10", 100, "2026-10-14 09:00:00");
    BigDecimal before = bucket(uid, "balance");
    swaps.settleDue(Instant.parse("2026-10-14T22:01:00Z"));
    // 0.1 × 100 × 4126.75（ask）× 0.00005 = 2.063375
    assertThat(swapRows(id)).singleElement().satisfies(a -> assertThat(a).isEqualByComparingTo("2.063375"));
    assertThat(bucket(uid, "balance")).isEqualByComparingTo(before.add(new BigDecimal("2.063375")));
    assertThat(col(id, "margin")).isEqualByComparingTo("412.635");
  }

  @Test
  void 结算时点之后开仓的_非交易日_休市日都不收() {
    rates("XAUUSD", "-0.0001", "0");
    long uid = newUser("2000");
    long late = open(uid, "XAUUSD", "buy", "0.10", 100, "2026-10-14 22:30:00");
    swaps.settleDue(Instant.parse("2026-10-14T23:00:00Z"));
    assertThat(swapRows(late)).isEmpty();
    long sat = open(newUser("2000"), "XAUUSD", "buy", "0.10", 100, "2026-10-17 10:00:00");
    swaps.settleDue(Instant.parse("2026-10-17T22:30:00Z"));
    assertThat(swapRows(sat)).as("周六").isEmpty();
    jdbc.update("INSERT IGNORE INTO market_holiday (symbol, trade_date, reason) VALUES ('XAUUSD', '2026-10-15', '测试')");
    catalog.reload();
    long hol = open(newUser("2000"), "XAUUSD", "buy", "0.10", 100, "2026-10-15 09:00:00");
    swaps.settleDue(Instant.parse("2026-10-15T22:30:00Z"));
    assertThat(swapRows(hol)).as("休市日").isEmpty();
  }

  @Test
  void 停机后补结算漏掉的天数() {
    rates("XAUUSD", "-0.0001", "0");
    long uid = newUser("1000");
    long id = open(uid, "XAUUSD", "buy", "0.10", 100, "2026-10-14 09:00:00");
    swaps.settleDue(Instant.parse("2026-10-16T23:00:00Z"));
    assertThat(swapRows(id)).as("10-14、10-15、10-16 各一次").hasSize(3);
    assertThat(swapLedgerCount(uid)).isEqualTo(3);
  }

  @Test
  void 结算时点持有_之后才平仓的也要收_从余额扣() {
    rates("XAUUSD", "-0.0001", "0");
    long uid = newUser("1000");
    long id = open(uid, "XAUUSD", "buy", "0.10", 100, "2026-10-14 09:00:00");
    // 平仓时间是数据库的真实时间（晚于 2026-10-14 22:00）
    positions.close(uid, id);
    BigDecimal before = bucket(uid, "balance");
    swaps.settleDue(Instant.parse("2026-10-14T22:01:00Z"));
    assertThat(swapRows(id)).singleElement().satisfies(a -> assertThat(a).isEqualByComparingTo("-4.12635"));
    assertThat(bucket(uid, "balance")).isEqualByComparingTo(before.subtract(new BigDecimal("4.12635")));
  }

  @Test
  void 费率为0只记录不记账() {
    long uid = newUser("1000");
    long id = open(uid, "XAUUSD", "buy", "0.10", 100, "2026-10-14 09:00:00");
    swaps.settleDue(Instant.parse("2026-10-14T22:01:00Z"));
    assertThat(swapRows(id)).singleElement().satisfies(a -> assertThat(a).isEqualByComparingTo("0"));
    assertThat(swapLedgerCount(uid)).isZero();
  }

  @Test
  void 日元报价品种按汇率折算成USD() {
    rates("USDJPY", "-0.0001", "0");
    long uid = newUser("1000");
    long id = open(uid, "USDJPY", "buy", "1.00", 500, "2026-10-14 09:00:00");
    swaps.settleDue(Instant.parse("2026-10-14T22:01:00Z"));
    // 1 × 100000 × 151.840 × 0.0001 = 1518.4 日元，÷ 151.85 ≈ 9.99934 USD
    BigDecimal a = swapRows(id).getFirst();
    assertThat(a.negate().subtract(new BigDecimal("1518.4").divide(new BigDecimal("151.85"), java.math.MathContext.DECIMAL64)).abs()).isLessThanOrEqualTo(new BigDecimal("0.01"));
  }
}
