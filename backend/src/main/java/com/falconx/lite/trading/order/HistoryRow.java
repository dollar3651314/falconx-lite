package com.falconx.lite.trading.order;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/** 历史记录一行：平仓的持仓（id 前缀 P）或撤销的挂单（id 前缀 O）。 */
class HistoryRow {
  String id;
  String symbol;
  String side;
  BigDecimal lots;
  BigDecimal openPrice;
  BigDecimal closePrice;
  BigDecimal pnl;
  BigDecimal fee;
  String kind;
  LocalDateTime at;
}
