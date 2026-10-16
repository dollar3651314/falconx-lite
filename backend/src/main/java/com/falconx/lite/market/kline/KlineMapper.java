package com.falconx.lite.market.kline;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** K 线的 SQL，见 resources/mapper/market/KlineMapper.xml。 */
@Mapper
interface KlineMapper {

  int upsert(Bar bar);

  /** 最近 limit 根已收盘的 K 线，按时间从新到旧 */
  List<Bar> recent(@Param("symbol") String symbol, @Param("tf") String tf, @Param("limit") int limit);

  /** 表里有 K 线的品种（包括已经停用的） */
  List<String> symbols();

  /** 从新到旧第 keep + 1 根的开始时间：比它早（含它）的都要删；不够 keep + 1 根时为 null */
  Long cutoff(@Param("symbol") String symbol, @Param("tf") String tf, @Param("keep") int keep);

  /** 删掉开始时间 ≤ cutoff 的，一次最多 limit 行（分批删，每批一个短事务，不长时间锁表） */
  int deleteUpTo(@Param("symbol") String symbol, @Param("tf") String tf, @Param("cutoff") long cutoff, @Param("limit") int limit);

  long count(@Param("symbol") String symbol, @Param("tf") String tf);
}
