package com.falconx.lite.trading.order;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 客户资金流水、交易量的只读合计（提现自动审批用），见 resources/mapper/trading/CustomerFlowMapper.xml。 */
@Mapper
interface CustomerFlowMapper {

  class DepositRow {
    BigDecimal net;
    LocalDateTime firstAt;
  }

  /** 账本原值（手续费、付出的隔夜费是负数） */
  class ProfitRow {
    BigDecimal realized;
    BigDecimal fee;
    BigDecimal swap;
  }

  /** since 为空表示全部时间 */
  DepositRow depositsSince(@Param("userId") long userId, @Param("since") LocalDateTime since);

  BigDecimal realizedPnl(@Param("userId") long userId, @Param("since") LocalDateTime since);

  ProfitRow netProfit(@Param("userId") long userId);

  BigDecimal openedNotionalSince(@Param("userId") long userId, @Param("since") LocalDateTime since);
}
