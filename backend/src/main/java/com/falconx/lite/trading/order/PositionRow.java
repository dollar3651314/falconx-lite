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
  /** 部分平仓拆出来的已平仓行指向原持仓（内部 id，V32）；原持仓为空 */
  Long parentId;
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
  /** 拆分时原持仓最大的隔夜费记录号（V32，只有拆出来的行有；见 SwapService） */
  Long splitSwapSeq;
  BigDecimal maintenanceMarginRate;
  BigDecimal liquidationPrice;
  BigDecimal takeProfit;
  BigDecimal stopLoss;
  String status;
  LocalDateTime openedAt;
  LocalDateTime closedAt;
  BigDecimal closePrice;
  BigDecimal realizedPnl;
  String closeReason;
  /** 只在后台的已平仓查询里有：原持仓的对外编号（拆出来的行才有） */
  Long parentNo;
}
