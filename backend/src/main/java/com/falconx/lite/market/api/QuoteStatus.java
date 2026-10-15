package com.falconx.lite.market.api;

/** 报价质量（沿用现有系统的 5 态，功能地图 M-06）。只有 FRESH 可以成交。 */
public enum QuoteStatus {
  FRESH,
  STALE,
  NO_QUOTE,
  MARKET_CLOSED,
  ABNORMAL
}
