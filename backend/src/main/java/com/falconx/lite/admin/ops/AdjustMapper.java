package com.falconx.lite.admin.ops;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 调余额记录（admin_balance_adjust）。只有 admin 模块使用。 */
@Mapper
interface AdjustMapper {

  class Row {
    Long id;
    long adminId;
    long userId;
    BigDecimal amount;
    String reason;
    LocalDateTime createdAt;
  }

  void insert(Row r);

  /** 这个管理员从 since 起调整金额的绝对值合计 */
  BigDecimal usedSince(@Param("adminId") long adminId, @Param("since") LocalDateTime since);
}
