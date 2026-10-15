package com.falconx.lite.market.kline;

import java.math.BigDecimal;

/** 一根 K 线。time 是起点（UTC 秒）；ticks 是这根 K 线收到的报价条数（不是成交量）。 */
public record Bar(String symbol, Timeframe tf, long time, BigDecimal open, BigDecimal high, BigDecimal low, BigDecimal close, int ticks) {

  Bar with(BigDecimal price) {
    return new Bar(symbol, tf, time, open, high.max(price), low.min(price), price, ticks + 1);
  }
}
