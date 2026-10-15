package com.falconx.lite.market.api;

/**
 * 订阅报价（S9 撮合引擎用）。同一品种的报价严格按顺序回调，回调在该品种的处理线程上执行，不要做耗时操作。
 * 只回调 FRESH 的报价。
 */
@FunctionalInterface
public interface QuoteListener {
  void onQuote(MarketQuote quote);
}
