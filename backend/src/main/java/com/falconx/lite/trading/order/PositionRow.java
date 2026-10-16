package com.falconx.lite.trading.order;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/** trading_position 一行（MyBatis 直接读写字段）。 */
class PositionRow {
  Long id;
  /** 对外编号（雪花 ID；V22 之前的旧数据等于 id）。接口里的持仓号都是它 */
  Long publicNo;
  long userId;
  long orderId;
  String symbol;
  String side;
  BigDecimal lots;
  int leverage;
  BigDecimal openPrice;
  BigDecimal contractSize;
  String quoteCcy;
  BigDecimal openUsdRate;
  BigDecimal notionalUsd;
  BigDecimal margin;
  BigDecimal fee;
  BigDecimal swapTotal;
  BigDecimal maintenanceMarginRate;
  BigDecimal liquidationPrice;
  BigDecimal takeProfit;
  BigDecimal stopLoss;
  String status;
  LocalDateTime openedAt;
  LocalDateTime closedAt;
}
