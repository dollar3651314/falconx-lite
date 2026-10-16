package com.falconx.lite.trading.order;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/** 历史记录一行：平仓的持仓（id 是 P + 持仓的对外编号）或撤销的挂单（O + 订单的对外编号）。前缀保证两种记录的 id 不重复（旧数据的对外编号等于各自的自增号，可能相同）。 */
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
