package com.falconx.lite.trading.order;

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
}
