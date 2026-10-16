package com.falconx.lite.trading.order;

import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 订单和持仓的 SQL，见 resources/mapper/trading/OrderMapper.xml。 */
@Mapper
interface OrderMapper {

  OrderRow findByClientId(@Param("userId") long userId, @Param("clientOrderId") String clientOrderId);

  OrderRow lockPending(@Param("userId") long userId, @Param("id") long id);

  List<OrderRow> pendingOrders(@Param("userId") long userId);

  List<PositionRow> openPositions(@Param("userId") long userId);

  int insertOrder(OrderRow row);

  int markFilled(@Param("id") long id, @Param("fillPrice") java.math.BigDecimal fillPrice, @Param("positionId") long positionId);

  int markCancelled(@Param("id") long id);

  int insertPosition(PositionRow row);

  int updatePending(@Param("id") long id, @Param("limitPrice") java.math.BigDecimal limitPrice, @Param("lots") java.math.BigDecimal lots,
      @Param("takeProfit") java.math.BigDecimal takeProfit, @Param("stopLoss") java.math.BigDecimal stopLoss,
      @Param("frozenAmount") java.math.BigDecimal frozenAmount, @Param("notionalUsd") java.math.BigDecimal notionalUsd, @Param("revision") int revision);

  PositionRow lockOpenPosition(@Param("userId") long userId, @Param("id") long id);

  int closePosition(@Param("id") long id, @Param("closePrice") java.math.BigDecimal closePrice, @Param("pnl") java.math.BigDecimal pnl,
      @Param("reason") String reason);

  int updateTpSl(@Param("id") long id, @Param("takeProfit") java.math.BigDecimal takeProfit, @Param("stopLoss") java.math.BigDecimal stopLoss);

  int updateMargin(@Param("id") long id, @Param("margin") java.math.BigDecimal margin, @Param("liquidationPrice") java.math.BigDecimal liquidationPrice);

  /** 已平仓的持仓和已撤销的挂单，按时间倒序 */
  List<HistoryRow> history(@Param("userId") long userId, @Param("offset") int offset, @Param("limit") int limit);

  long countHistory(@Param("userId") long userId);

  /** 结算日 date（时点 at）还没结算隔夜费的持仓：at 之前开仓，at 时还持有（现在仍持有或 at 之后才平仓），品种在 symbols 里 */
  List<PositionRow> swapDue(@Param("date") java.time.LocalDate date, @Param("at") java.time.LocalDateTime at, @Param("symbols") List<String> symbols);

  /** 锁住持仓（不管是否已平仓），结算隔夜费用 */
  PositionRow lockPosition(@Param("id") long id);

  /** 写结算记录；同一持仓同一结算日已经有了就不写，返回 0 */
  int insertSwap(@Param("positionId") long positionId, @Param("userId") long userId, @Param("symbol") String symbol, @Param("date") java.time.LocalDate date,
      @Param("at") java.time.LocalDateTime at, @Param("rate") java.math.BigDecimal rate, @Param("price") java.math.BigDecimal price,
      @Param("usdRate") java.math.BigDecimal usdRate, @Param("amount") java.math.BigDecimal amount);

  /** 隔夜费入账后更新持仓：保证金、强平价（扣费时）和累计隔夜费 */
  int applySwap(@Param("id") long id, @Param("margin") java.math.BigDecimal margin, @Param("liquidationPrice") java.math.BigDecimal liquidationPrice,
      @Param("amount") java.math.BigDecimal amount);

  /** 按品种汇总持仓（风控算敞口） */
  List<com.falconx.lite.trading.api.ExposureApi.SymbolLots> openLots();

  /** 这个价格下会成交的挂单：买单 限价 ≥ ask，卖单 限价 ≤ bid */
  List<OrderRow> triggeredOrders(@Param("symbol") String symbol, @Param("bid") java.math.BigDecimal bid, @Param("ask") java.math.BigDecimal ask);

  /** 这个价格下触及强平价、止损或止盈的持仓：多单看 bid，空单看 ask */
  List<PositionRow> triggeredPositions(@Param("symbol") String symbol, @Param("bid") java.math.BigDecimal bid, @Param("ask") java.math.BigDecimal ask);

  /** 有持仓的客户（追保检查用） */
  List<Long> usersWithOpenPositions();

  MarginCallMonitor.State marginCallState(@Param("userId") long userId);

  void saveMarginCallState(@Param("userId") long userId, @Param("below") boolean below, @Param("notified") boolean notified,
      @Param("lastNotifiedAt") LocalDateTime lastNotifiedAt, @Param("now") LocalDateTime now);

  /** 没有持仓的客户恢复为"在线上" */
  int clearMarginCallWithoutPositions(@Param("now") LocalDateTime now);

  /** 后台：余额流水（trading_ledger） */
  class LedgerRow {
    long id;
    String entryType;
    java.math.BigDecimal amount;
    java.math.BigDecimal valueAfter;
    String bizType;
    String bizId;
    LocalDateTime createdAt;
  }

  /** 后台：按用户的金额或个数 */
  class UserAmount {
    long userId;
    java.math.BigDecimal amount;
  }

  List<LedgerRow> balanceLedger(@Param("userId") long userId, @Param("limit") int limit);

  List<UserAmount> balances(@Param("ids") java.util.Collection<Long> ids);

  List<UserAmount> openPositionCounts(@Param("ids") java.util.Collection<Long> ids);

  /** 后台（S16c）：订单和它的手续费（成交了才有） */
  class AdminOrderRow {
    long id;
    long userId;
    String symbol;
    String orderType;
    String side;
    java.math.BigDecimal lots;
    int leverage;
    java.math.BigDecimal limitPrice;
    java.math.BigDecimal fillPrice;
    java.math.BigDecimal takeProfit;
    java.math.BigDecimal stopLoss;
    java.math.BigDecimal frozenAmount;
    java.math.BigDecimal fee;
    String status;
    LocalDateTime createdAt;
  }

  List<AdminOrderRow> adminOrders(@Param("symbol") String symbol, @Param("side") String side, @Param("status") String status,
      @Param("userIds") java.util.Collection<Long> userIds, @Param("offset") int offset, @Param("limit") int limit);

  long countAdminOrders(@Param("symbol") String symbol, @Param("side") String side, @Param("status") String status,
      @Param("userIds") java.util.Collection<Long> userIds);

  List<PositionRow> adminPositions(@Param("symbol") String symbol, @Param("side") String side, @Param("userIds") java.util.Collection<Long> userIds,
      @Param("offset") int offset, @Param("limit") int limit);

  long countAdminPositions(@Param("symbol") String symbol, @Param("side") String side, @Param("userIds") java.util.Collection<Long> userIds);

  PositionRow positionById(@Param("id") long id);

  OrderRow orderById(@Param("id") long id);

  /** 某个品种还在用的：持仓数 + 挂单数 */
  long openUsage(@Param("symbol") String symbol);

  long openPositionTotal();

  /** 从 since 起某种账本类型在余额上的合计（所有客户） */
  java.math.BigDecimal ledgerTotalSince(@Param("type") String type, @Param("since") LocalDateTime since);
}
