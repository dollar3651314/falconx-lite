package com.falconx.lite.market.config;

import com.falconx.lite.market.api.SymbolSpec;
import java.time.LocalDate;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;

/** 品种配置的 SQL，见 resources/mapper/market/SymbolMapper.xml。 */
@Mapper
interface SymbolMapper {

  List<SymbolSpec> enabledSymbols();

  List<SessionRow> sessions();

  List<HolidayRow> holidays();

  record SessionRow(String symbol, int dayOfWeek, int openMinute, int closeMinute) {}

  record HolidayRow(String symbol, LocalDate tradeDate) {}
}
