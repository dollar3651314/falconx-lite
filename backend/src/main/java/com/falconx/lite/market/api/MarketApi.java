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

  /** 1 单位 ccy 折合多少 USD（USDT 视同 USD）；找不到汇率时为空，调用方应拒绝交易 */
  Optional<BigDecimal> toUsdRate(String ccy);

  void subscribe(QuoteListener listener);
}
