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
}
