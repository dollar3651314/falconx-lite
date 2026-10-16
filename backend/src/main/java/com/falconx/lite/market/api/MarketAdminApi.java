package com.falconx.lite.market.api;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/** 后台的品种和行情配置（S16c）。改完立即重新加载内存里的品种、时段、休市日。 */
public interface MarketAdminApi {

  /** 一个品种（含停用的） */
  record Symbol(SymbolSpec spec, boolean enabled, LocalDateTime updatedAt) {}

  /** 品种可以改的字段；为空的不改 */
  record SymbolPatch(String nameZh, String nameEn, Integer maxLeverage, BigDecimal minLots, BigDecimal maxLots, BigDecimal lotStep, BigDecimal feeRate,
      BigDecimal maintenanceMarginRate, BigDecimal markup, BigDecimal swapLong, BigDecimal swapShort, Boolean hot, Integer sortOrder) {}

  /** 一个品种一周的交易时段（UTC）；dayOfWeek 1=周一 … 7=周日，分钟数从 0 点算 */
  record Session(String symbol, int dayOfWeek, int openMinute, int closeMinute) {}

  /** 休市日；symbol 为 * 表示全部品种 */
  record Holiday(long id, String symbol, LocalDate date, String reason) {}

  /**
   * 汇率：报价币种 → USD。source 是用来算的外汇品种（例如 USDJPY）或 fixed（固定汇率）；
   * stale 表示现在拿不到可成交的报价（这些币种的品种不能开仓）。
   */
  record FxRate(String currency, String source, BigDecimal rate, Instant updatedAt, boolean stale, List<String> symbols) {}

  List<Symbol> symbols();

  /** 返回改之前的品种 */
  Symbol updateSymbol(String code, SymbolPatch patch);

  /** 启用或停用；返回改之前的品种 */
  Symbol setEnabled(String code, boolean enabled);

  List<Session> sessions();

  List<Holiday> holidays(LocalDate from);

  Holiday addHoliday(String symbol, LocalDate date, String reason);

  /** 返回删掉的休市日 */
  Holiday deleteHoliday(long id);

  List<FxRate> fxRates();
}
