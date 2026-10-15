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
}
