package com.falconx.lite.trading.api;

/** 交易账户里会变动的三项。 */
public enum Bucket {
  /** 余额（含已占用的保证金） */
  BALANCE,
  /** 提现冻结 */
  WITHDRAW_FROZEN,
  /** 挂单冻结 */
  ORDER_FROZEN
}
