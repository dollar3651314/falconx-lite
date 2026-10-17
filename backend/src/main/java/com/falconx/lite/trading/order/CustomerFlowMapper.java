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

  /** since 为空表示全部时间 */
  DepositRow depositsSince(@Param("userId") long userId, @Param("since") LocalDateTime since);

  BigDecimal realizedPnl(@Param("userId") long userId, @Param("since") LocalDateTime since);

  BigDecimal openedNotionalSince(@Param("userId") long userId, @Param("since") LocalDateTime since);
}
