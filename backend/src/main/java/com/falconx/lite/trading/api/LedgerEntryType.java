package com.falconx.lite.trading.api;

/** 账本记录的业务类型。新增业务时在这里加，不复用已有含义。 */
public enum LedgerEntryType {
  DEPOSIT,
  WITHDRAW_FREEZE,
  WITHDRAW_UNFREEZE,
  WITHDRAW_PAYOUT,
  ORDER_FREEZE,
  ORDER_UNFREEZE,
  TRADE_FEE,
  REALIZED_PNL,
  SWAP,
  ADMIN_ADJUST
}
