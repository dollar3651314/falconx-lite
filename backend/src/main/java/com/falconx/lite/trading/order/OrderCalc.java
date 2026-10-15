package com.falconx.lite.trading.order;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * 逐仓的计算公式，和原型 web/client/src/lib/trading.ts 同一口径（S7 完成标准）：
 * <ul>
 *   <li>买入按 ask、卖出按 bid（行情模块已加好点，这里不再加，修复 T1）</li>
 *   <li>名义价值 = 价格 × 手数 × 合约大小 × 报价币种对 USD 的汇率</li>
 *   <li>保证金 = 名义价值 ÷ 杠杆；手续费 = 名义价值 × 费率（开仓收，平仓不收）</li>
 *   <li>强平价：亏损达到（保证金 − 名义价值 × 维持保证金率）时的价格</li>
 * </ul>
 * 金额保留 8 位小数（四舍五入），强平价按品种小数位四舍五入。
 */
final class OrderCalc {

  static final int MONEY_SCALE = 8;

  private OrderCalc() {}

  static BigDecimal notionalUsd(BigDecimal price, BigDecimal lots, BigDecimal contractSize, BigDecimal usdRate) {
    return price.multiply(lots).multiply(contractSize).multiply(usdRate).setScale(MONEY_SCALE, RoundingMode.HALF_UP);
  }

  static BigDecimal margin(BigDecimal notionalUsd, int leverage) {
    return notionalUsd.divide(BigDecimal.valueOf(leverage), MONEY_SCALE, RoundingMode.HALF_UP);
  }

  static BigDecimal fee(BigDecimal notionalUsd, BigDecimal feeRate) {
    return notionalUsd.multiply(feeRate).setScale(MONEY_SCALE, RoundingMode.HALF_UP);
  }

  static BigDecimal liquidationPrice(Side side, BigDecimal entry, BigDecimal lots, BigDecimal contractSize, BigDecimal usdRate,
      BigDecimal margin, BigDecimal maintenanceMarginRate, int digits) {
    BigDecimal notional = entry.multiply(lots).multiply(contractSize).multiply(usdRate);
    BigDecimal buffer = margin.subtract(notional.multiply(maintenanceMarginRate));
    BigDecimal perPrice = lots.multiply(contractSize).multiply(usdRate);
    if (perPrice.signum() == 0) return BigDecimal.ZERO.setScale(digits);
    BigDecimal distance = buffer.divide(perPrice, 16, RoundingMode.HALF_UP);
    BigDecimal p = side == Side.BUY ? entry.subtract(distance) : entry.add(distance);
    if (p.signum() < 0) p = BigDecimal.ZERO;
    return p.setScale(digits, RoundingMode.HALF_UP);
  }

  /** 按 exit 价格平仓的盈亏（USD）：多单 (exit − entry)，空单 (entry − exit) */
  static BigDecimal pnl(Side side, BigDecimal entry, BigDecimal exit, BigDecimal lots, BigDecimal contractSize, BigDecimal usdRate) {
    BigDecimal diff = side == Side.BUY ? exit.subtract(entry) : entry.subtract(exit);
    return diff.multiply(lots).multiply(contractSize).multiply(usdRate).setScale(MONEY_SCALE, RoundingMode.HALF_UP);
  }
}
