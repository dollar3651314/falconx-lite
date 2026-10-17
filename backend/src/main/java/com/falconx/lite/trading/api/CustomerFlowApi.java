package com.falconx.lite.trading.api;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 客户的资金流水和交易量合计（只读），给提现自动审批的 R8、R9、R10 用（技术方案/v2-提现自动审批.md 第 4 节）。金额都按账本（{@code trading_ledger}）的
 * BALANCE 一项算，不改任何金额。时间窗口只有下限（从 since 起），账本里不会有"将来"的记录。
 */
public interface CustomerFlowApi {

  /**
   * 一段时间里入账的充值。
   *
   * @param net 充值 − 冲正（账本 DEPOSIT + DEPOSIT_REVERSAL，冲正是负数）
   * @param firstAt 其中最早一笔充值的入账时间；没有充值时为空
   */
  record Deposits(BigDecimal net, LocalDateTime firstAt) {}

  /** 从 since 起（含）入账的充值 */
  Deposits depositsSince(long userId, LocalDateTime since);

  /** 累计充值 − 冲正（全部时间） */
  BigDecimal netDeposits(long userId);

  /** 交易已实现盈亏合计（账本 REALIZED_PNL，不扣手续费、隔夜费，不含后台调余额）；since 为空表示全部时间 */
  BigDecimal realizedPnl(long userId, LocalDateTime since);

  /** 从 since 起（含）成交的开仓订单名义价值合计（下单时按 USD 算的 {@code notional_usd}，USDT 按 1:1） */
  BigDecimal openedNotionalSince(long userId, LocalDateTime since);
}
