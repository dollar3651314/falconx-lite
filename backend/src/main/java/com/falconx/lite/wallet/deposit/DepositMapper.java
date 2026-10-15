package com.falconx.lite.wallet.deposit;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 扫块进度和充值记录的 SQL，见 resources/mapper/wallet/DepositMapper.xml。 */
@Mapper
interface DepositMapper {

  record DepositRow(long id, String chain, String txHash, int logIndex, long blockNumber, String blockHash, long userId, BigDecimal amount, String status,
      int confirmations, LocalDateTime createdAt) {}

  Long cursor(@Param("chain") String chain);

  int saveCursor(@Param("chain") String chain, @Param("block") long block);

  int insertIgnore(@Param("chain") String chain, @Param("txHash") String txHash, @Param("logIndex") int logIndex, @Param("blockNumber") long blockNumber,
      @Param("blockHash") String blockHash, @Param("from") String from, @Param("to") String to, @Param("userId") long userId,
      @Param("amount") BigDecimal amount, @Param("status") String status);

  List<DepositRow> pending(@Param("chain") String chain);

  int updateConfirmations(@Param("id") long id, @Param("confirmations") int confirmations);

  /** 只有待确认的能改，返回 1 表示这次改成功（防止重复入账） */
  int finish(@Param("id") long id, @Param("status") String status, @Param("confirmations") int confirmations);

  List<DepositRow> byUser(@Param("userId") long userId, @Param("limit") int limit);
}
