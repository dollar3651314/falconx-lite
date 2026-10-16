package com.falconx.lite.trading.api;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Map;

/** 后台查看客户的交易账户、持仓、流水（S16b）。只读；调余额走 {@link LedgerApi}（{@code ADMIN_ADJUST}）。 */
public interface TradingAdminApi {

  /**
   * 账户的几项金额。floatingPnl 是各持仓按当前价的浮动盈亏合计（没有报价的持仓不计）；available 和提现口径一致（浮动盈利不算，DF-02）。
   */
  record Metrics(BigDecimal balance, BigDecimal usedMargin, BigDecimal available, BigDecimal floatingPnl, BigDecimal withdrawFrozen, BigDecimal orderFrozen) {}

  /** 一个持仓；currentPrice、pnl、marginLevel 没有报价时为空。marginLevel = (保证金 + 浮动盈亏) ÷ 保证金，小数 */
  record Position(long id, long userId, String symbol, String side, BigDecimal lots, BigDecimal openPrice, BigDecimal currentPrice, int leverage,
      BigDecimal margin, BigDecimal pnl, BigDecimal marginLevel, BigDecimal liquidationPrice, BigDecimal stopLoss, BigDecimal takeProfit,
      LocalDateTime openedAt) {}

  /** 余额的一条流水 */
  record LedgerLine(long id, LedgerEntryType type, BigDecimal amount, BigDecimal balanceAfter, String bizType, String bizId, LocalDateTime time) {}

  Metrics metrics(long userId);

  List<Position> openPositions(long userId);

  /** 余额的最近 limit 条流水，最新的在前 */
  List<LedgerLine> balanceLedger(long userId, int limit);

  /** 批量：用户 → 余额 */
  Map<Long, BigDecimal> balances(Collection<Long> userIds);

  /** 批量：用户 → 持仓数 */
  Map<Long, Integer> openPositionCounts(Collection<Long> userIds);
}
