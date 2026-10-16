package com.falconx.lite.market.admin;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 后台的品种、时段、休市日维护（market_* 表）。只有 market 模块使用。 */
@Mapper
interface MarketAdminMapper {

  class SymbolRow {
    String code;
    String nameZh;
    String nameEn;
    String category;
    int digits;
    BigDecimal contractSize;
    String unit;
    String baseCcy;
    String quoteCcy;
    int maxLeverage;
    BigDecimal minLots;
    BigDecimal maxLots;
    BigDecimal lotStep;
    BigDecimal feeRate;
    BigDecimal maintenanceMarginRate;
    BigDecimal markup;
    BigDecimal swapLong;
    BigDecimal swapShort;
    boolean hot;
    boolean openPaused;
    int sortOrder;
    boolean enabled;
    LocalDateTime updatedAt;
  }

  class HolidayRow {
    Long id;
    String symbol;
    LocalDate tradeDate;
    String reason;
  }

  class SessionRow {
    String symbol;
    int dayOfWeek;
    int openMinute;
    int closeMinute;
  }

  List<SymbolRow> symbols();

  SymbolRow symbol(@Param("code") String code);

  void updateSymbol(SymbolRow r);

  /** 代码是否已存在（含停用的），新增品种时检查（v2 E3） */
  long codeCount(@Param("code") String code);

  int maxSortOrder();

  void insertSymbol(SymbolRow r);

  void insertSession(@Param("symbol") String symbol, @Param("day") int day, @Param("open") int open, @Param("close") int close);

  void setEnabled(@Param("code") String code, @Param("enabled") boolean enabled);

  List<SessionRow> sessions();

  List<HolidayRow> holidays(@Param("from") LocalDate from);

  HolidayRow holiday(@Param("id") long id);

  HolidayRow holidayOf(@Param("symbol") String symbol, @Param("date") LocalDate date);

  void insertHoliday(HolidayRow r);

  void deleteHoliday(@Param("id") long id);
}
