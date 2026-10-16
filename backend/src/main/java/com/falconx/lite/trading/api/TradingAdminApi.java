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

  // ---------- S16c：交易监控 ----------

  record Page<T>(List<T> items, long total) {}

  /** 一笔订单；price 是成交价（成交了）或限价；fee 只有成交了才有。status：PENDING / FILLED / CANCELLED */
  record Order(long id, long userId, String symbol, String side, String type, BigDecimal lots, BigDecimal price, int leverage, BigDecimal fee,
      String status, LocalDateTime createdAt) {}

  /** 一笔挂单；currentPrice 是成交方向的当前价（买看 ask、卖看 bid），没有报价时为空 */
  record Pending(long id, long userId, String symbol, String side, BigDecimal lots, BigDecimal limitPrice, BigDecimal currentPrice, int leverage,
      BigDecimal frozen, BigDecimal stopLoss, BigDecimal takeProfit, LocalDateTime createdAt) {}

  /** 后台强平的结果 */
  record Liquidated(long positionId, long userId, String symbol, BigDecimal price, BigDecimal pnl) {}

  /** symbol、side 为空表示不筛选；side 是 BUY / SELL；userIds 不为空时只查这些客户 */
  Page<Order> orders(String symbol, String side, String status, Collection<Long> userIds, int offset, int limit);

  Page<Position> positions(String symbol, String side, Collection<Long> userIds, int offset, int limit);

  Page<Pending> pendingOrders(String symbol, String side, Collection<Long> userIds, int offset, int limit);

  /**
   * 后台手动强平：按当前市价平掉（多单 bid、空单 ask），需要在交易时段内、报价可成交；亏损最多等于保证金（AC-14）；通知客户（强平模板）。
   */
  Liquidated liquidate(long positionId);

  /** 后台强制撤销挂单：释放冻结；返回客户号 */
  long forceCancel(long orderId);

  /** 某个品种的持仓数 + 挂单数（停用品种前检查） */
  long openUsage(String symbol);

  // ---------- S16c：仪表盘 ----------

  long openPositionTotal();

  /**
   * 平台从 since 起已实现的盈亏（对赌模式下客户亏就是平台赚）：手续费 + 隔夜费收入 − 客户已实现盈亏。不含浮动盈亏。
   */
  BigDecimal platformRealizedSince(LocalDateTime since);
}
