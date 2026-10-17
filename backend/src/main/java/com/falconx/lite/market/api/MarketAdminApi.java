package com.falconx.lite.market.api;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 后台的品种和行情配置（S16c；v2 E3 新增品种、E6 最后报价时间）。改完在事务提交后立即重新加载内存里的品种、时段、休市日，
 * 行情、撮合、风控敞口、K 线都从这份内存数据取品种，不需要重启。
 */
public interface MarketAdminApi {

  /**
   * 一个品种（含停用的）。
   *
   * @param lastQuoteAt 最后一条正常报价的时间（v2 E6）；从没收到过为空
   * @param tradingOpen 现在是否在交易时段内（休市时没有报价是正常的）
   * @param simStartPrice 模拟起始价（只在模拟报价源下使用，见 {@link MarketAdminApi#simulatedQuotes()}）；没填为空
   * @param quoteSource 当前用哪个报价源（技术方案/v2-报价源接入.md 第 5.5 节）；没有报价源时为空
   */
  record Symbol(SymbolSpec spec, boolean enabled, LocalDateTime updatedAt, Instant lastQuoteAt, boolean tradingOpen, BigDecimal simStartPrice,
      QuoteSource quoteSource) {}

  /**
   * 品种当前的报价源。
   *
   * @param feed alltick / itick / binance / simulated
   * @param state primary（主源）/ backup（正在用备源）/ deviation（两家偏差过大、暂停开仓，用主源价格）；模拟源为空
   */
  record QuoteSource(String feed, String state) {}

  /**
   * 品种可以改的字段；为空的不改。openPaused：品种自己的"暂停开仓"（v2：新增的品种默认暂停，在这里打开）。
   * simStartPrice：模拟起始价（给已建好的品种补价），只在模拟报价源下生效，否则忽略；见 {@link SymbolCreate}。
   */
  record SymbolPatch(String nameZh, String nameEn, Integer maxLeverage, BigDecimal minLots, BigDecimal maxLots, BigDecimal lotStep, BigDecimal feeRate,
      BigDecimal maintenanceMarginRate, BigDecimal markup, BigDecimal swapLong, BigDecimal swapShort, Boolean hot, Integer sortOrder, Boolean openPaused,
      BigDecimal simStartPrice) {}

  /** 新增品种用的交易时段模板（UTC，和 V4 迁移里第一版品种的时段一致） */
  enum SessionTemplate {
    /** 外汇、贵金属、指数、能源：周日 22:00 到周五 21:00 */
    FX,
    /** 加密货币：全天候 */
    CRYPTO,
    /** 美股：周一到周五 13:30–20:00 */
    US_STOCK
  }

  /**
   * 新增品种（v2 E3）。新增后默认"暂停开仓"（运营确认报价正常后再在品种页打开）；隔夜费率为 0（未配置，后台标红）。
   * 交易时段二选一：copySessionsFrom（从已有品种复制）或 sessionTemplate（模板）。
   * 合约单位、基础货币按类别和代码推出来（客户端只用来显示）。
   * simStartPrice：模拟起始价（可选，正数，小数位不超过 digits）。只在模拟报价源下生效：存进 market_symbol.sim_start_price，
   * 提交后模拟报价源立即从这个价开始随机游走；不是模拟源时忽略（不校验、不保存）。
   */
  record SymbolCreate(String code, String nameZh, String nameEn, String category, Integer digits, BigDecimal contractSize, String quoteCcy,
      Integer maxLeverage, BigDecimal maintenanceMarginRate, BigDecimal feeRate, BigDecimal minLots, BigDecimal maxLots, BigDecimal lotStep,
      BigDecimal markup, Boolean hot, String copySessionsFrom, String sessionTemplate, BigDecimal simStartPrice) {}

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

  /** 当前报价源是不是模拟源（falconx.market.source=simulated）：是的话后台显示"模拟起始价"输入框 */
  boolean simulatedQuotes();

  /** 返回改之前的品种 */
  Symbol updateSymbol(String code, SymbolPatch patch);

  /**
   * 新增品种（v2 E3）。代码已存在（含停用的）时抛 {@code SYMBOL_EXISTS}；字段错误一次全部返回。
   *
   * @return 新增的品种
   */
  Symbol createSymbol(SymbolCreate create);

  /** 启用或停用；返回改之前的品种 */
  Symbol setEnabled(String code, boolean enabled);

  List<Session> sessions();

  List<Holiday> holidays(LocalDate from);

  Holiday addHoliday(String symbol, LocalDate date, String reason);

  /** 返回删掉的休市日 */
  Holiday deleteHoliday(long id);

  List<FxRate> fxRates();
}
