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

  /**
   * 一个持仓；currentPrice、pnl、marginLevel 没有报价时为空。marginLevel = (保证金 + 浮动盈亏) ÷ 保证金，小数。
   * no 是对外编号（雪花 ID，旧数据等于 id）：后台显示、搜索、接口路径都用它。
   */
  record Position(long id, long no, long userId, String symbol, String side, BigDecimal lots, BigDecimal openPrice, BigDecimal currentPrice, int leverage,
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

  /** 一笔订单；price 是成交价（成交了）或限价；fee 只有成交了才有。status：PENDING / FILLED / CANCELLED。no 是对外编号 */
  record Order(long id, long no, long userId, String symbol, String side, String type, BigDecimal lots, BigDecimal price, int leverage, BigDecimal fee,
      String status, LocalDateTime createdAt) {}

  /** 一笔挂单；currentPrice 是成交方向的当前价（买看 ask、卖看 bid），没有报价时为空。no 是对外编号 */
  record Pending(long id, long no, long userId, String symbol, String side, BigDecimal lots, BigDecimal limitPrice, BigDecimal currentPrice, int leverage,
      BigDecimal frozen, BigDecimal stopLoss, BigDecimal takeProfit, LocalDateTime createdAt) {}

  /**
   * 一笔已平仓记录（V32 起后台可查）。reason：CLOSED（客户平仓）/ TP / SL / LIQUIDATED。
   * parentNo：部分平仓拆出来的记录指向原持仓的对外编号（不为空 = 部分平仓），整笔平仓为空。
   */
  record ClosedPosition(long id, long no, Long parentNo, long userId, String symbol, String side, BigDecimal lots, BigDecimal openPrice, BigDecimal closePrice,
      int leverage, BigDecimal margin, BigDecimal fee, BigDecimal swap, BigDecimal pnl, String reason, LocalDateTime openedAt, LocalDateTime closedAt) {}

  /** 后台强平的结果 */
  record Liquidated(long positionId, long userId, String symbol, BigDecimal price, BigDecimal pnl) {}

  /**
   * symbol、side 为空表示不筛选；side 是 BUY / SELL；userIds 不为空时只查这些客户；no 不为空时也匹配这个对外编号（和 userIds 是"或"：
   * 后台搜索框输入数字时，既可能是客户号也可能是编号）。userIds 是空列表并且 no 为空时返回空页。
   */
  Page<Order> orders(String symbol, String side, String status, Collection<Long> userIds, Long no, int offset, int limit);

  Page<Position> positions(String symbol, String side, Collection<Long> userIds, Long no, int offset, int limit);

  /** 已平仓记录，按平仓时间倒序；筛选同 {@link #positions}，no 也匹配原持仓的编号（能查到一笔持仓拆出来的全部部分平仓记录） */
  Page<ClosedPosition> closedPositions(String symbol, String side, Collection<Long> userIds, Long no, int offset, int limit);

  Page<Pending> pendingOrders(String symbol, String side, Collection<Long> userIds, Long no, int offset, int limit);

  /** 持仓的对外编号 → 内部 id（后台接口路径里是对外编号） */
  java.util.Optional<Long> positionIdByNo(long no);

  /** 订单的对外编号 → 内部 id */
  java.util.Optional<Long> orderIdByNo(long no);

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
