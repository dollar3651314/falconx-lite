package com.falconx.lite.trading.order;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/** trading_position 一行（MyBatis 直接读写字段）。 */
class PositionRow {
  Long id;
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
  BigDecimal maintenanceMarginRate;
  BigDecimal liquidationPrice;
  BigDecimal takeProfit;
  BigDecimal stopLoss;
  String status;
  LocalDateTime openedAt;
}
