package com.falconx.lite.trading.order;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/** trading_order 一行（MyBatis 直接读写字段）。 */
class OrderRow {
  Long id;
  /** 对外编号（雪花 ID；V22 之前的旧数据等于 id）。接口里的订单号都是它 */
  Long publicNo;
  long userId;
  String clientOrderId;
  String symbol;
  String orderType;
  String side;
  BigDecimal lots;
  int leverage;
  BigDecimal limitPrice;
  BigDecimal takeProfit;
  BigDecimal stopLoss;
  BigDecimal frozenAmount;
  BigDecimal notionalUsd;
  String status;
  BigDecimal fillPrice;
  Long positionId;
  int revision;
  LocalDateTime createdAt;
}
