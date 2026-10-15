package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.math.MathContext;
import org.junit.jupiter.api.Test;

/** 计算公式和原型 lib/trading.ts 同一口径；数字是手算的（AC-10：误差 ≤ 0.01 USDT）。 */
class OrderCalcTest {

  static BigDecimal d(String s) {
    return new BigDecimal(s);
  }

  @Test
  void 黄金买入_USD报价() {
    // 4126.75 × 0.10 手 × 100 盎司 = 41,267.5；100 倍杠杆保证金 412.675；手续费 0.005% = 2.063375
    BigDecimal n = OrderCalc.notionalUsd(d("4126.75"), d("0.10"), d("100"), BigDecimal.ONE);
    assertThat(n).isEqualByComparingTo("41267.5");
    assertThat(OrderCalc.margin(n, 100)).isEqualByComparingTo("412.675");
    assertThat(OrderCalc.fee(n, d("0.00005"))).isEqualByComparingTo("2.063375");
    // 维持保证金 41,267.5 × 0.25% = 103.16875；可亏 309.50625；每 1 美元价格变动 10 USD → 强平价 4126.75 − 30.950625 = 4095.80
    assertThat(OrderCalc.liquidationPrice(Side.BUY, d("4126.75"), d("0.10"), d("100"), BigDecimal.ONE, d("412.675"), d("0.0025"), 2))
        .isEqualByComparingTo("4095.80");
    assertThat(OrderCalc.liquidationPrice(Side.SELL, d("4126.35"), d("0.10"), d("100"), BigDecimal.ONE, d("412.635"), d("0.0025"), 2))
        .as("空单强平价在上方").isEqualByComparingTo("4157.30");
  }

  @Test
  void 美元日元卖出_非USD报价按汇率折算() {
    BigDecimal rate = BigDecimal.ONE.divide(d("151.85"), 12, java.math.RoundingMode.HALF_UP);
    BigDecimal n = OrderCalc.notionalUsd(d("151.840"), d("1"), d("100000"), rate);
    // 手算：15,184,000 日元 ÷ 151.85 = 99,993.4146...
    BigDecimal exact = d("15184000").divide(d("151.85"), MathContext.DECIMAL64);
    assertThat(n.subtract(exact).abs()).isLessThanOrEqualTo(d("0.01"));
    assertThat(OrderCalc.margin(n, 500).subtract(exact.divide(d("500"), MathContext.DECIMAL64)).abs()).isLessThanOrEqualTo(d("0.01"));
  }

  @Test
  void 强平价不会小于0_盈亏方向() {
    assertThat(OrderCalc.liquidationPrice(Side.BUY, d("1.0"), d("1"), d("1"), BigDecimal.ONE, d("5"), d("0"), 2)).isEqualByComparingTo("0");
    assertThat(OrderCalc.pnl(Side.BUY, d("100"), d("101"), d("1"), d("10"), BigDecimal.ONE)).isEqualByComparingTo("10");
    assertThat(OrderCalc.pnl(Side.SELL, d("100"), d("101"), d("1"), d("10"), BigDecimal.ONE)).isEqualByComparingTo("-10");
  }
}
