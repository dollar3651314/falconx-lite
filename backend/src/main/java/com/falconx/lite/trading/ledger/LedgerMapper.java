package com.falconx.lite.trading.ledger;

import java.math.BigDecimal;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 交易账户和账本的 SQL，见 resources/mapper/trading/LedgerMapper.xml。只有 trading 模块能用。 */
@Mapper
interface LedgerMapper {

  int insertAccountIfAbsent(@Param("userId") long userId);

  AccountRow lockAccount(@Param("userId") long userId);

  AccountRow findAccount(@Param("userId") long userId);

  int updateBucket(@Param("accountId") long accountId, @Param("column") String column, @Param("value") BigDecimal value);

  LedgerRow findEntry(@Param("bizType") String bizType, @Param("bizId") String bizId, @Param("entryType") String entryType, @Param("bucket") String bucket);

  int insertEntry(LedgerEntry entry);
}
