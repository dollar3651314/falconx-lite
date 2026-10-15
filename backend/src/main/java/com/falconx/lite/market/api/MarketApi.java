package com.falconx.lite.market.api;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** 行情模块对其他模块开放的操作。 */
public interface MarketApi {

  List<SymbolSpec> symbols();

  Optional<SymbolSpec> symbol(String code);

  /** 最新报价；从没收到过报价时为空 */
  Optional<MarketQuote> quote(String code);

  /** 该时刻是否在交易时段内（每周时段 + 休市日） */
  boolean isTradingOpen(String code, Instant at);

  /** UTC 日期这一天是不是这个品种的交易日（有交易时段、不是休市日）。 */
  boolean isTradingDay(String code, java.time.LocalDate date);

  /** 1 单位 ccy 折合多少 USD（USDT 视同 USD）；找不到汇率时为空，调用方应拒绝交易 */
  Optional<BigDecimal> toUsdRate(String ccy);

  /**
   * 可以用来开仓的汇率：来源报价当前可以成交（新鲜、正常、在交易时段内）才返回；固定汇率和 USD、USDT 总是返回。
   * 返回空表示"汇率失效"，相关品种不能开新仓（需求 4.5-5）。
   */
  Optional<BigDecimal> liveUsdRate(String ccy);

  void subscribe(QuoteListener listener);
}
