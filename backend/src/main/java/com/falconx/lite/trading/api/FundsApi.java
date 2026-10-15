package com.falconx.lite.trading.api;

import java.math.BigDecimal;

/** 账户里可以自由动用的钱，给钱包用（充值冲正 S12b、提现 S13）。 */
public interface FundsApi {

  /**
   * 可以拿走而不影响持仓和挂单的金额：余额 − 挂单冻结 − 持仓保证金 + 浮动亏损（浮动盈利不算，和开仓口径一致，DF-02）。
   * 调用方要先在同一个事务里 {@link LedgerApi#lock} 锁住账户，结果到提交前都不会变。
   */
  BigDecimal withdrawable(long userId);
}
