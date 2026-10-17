package com.falconx.lite.market.quote.feed;

import java.math.BigDecimal;
import java.time.Instant;

/** 报价源解析出的一条买卖价（代码是数据商的代码，还没换成平台品种），交给 {@link QuoteRouter} */
public interface QuoteSink {

  /**
   * @param feed 报价源名字（alltick / itick / binance）
   * @param code 数据商的品种代码（iTick 是 "代码$地区"）
   * @param time 数据商给的报价时间；没有时为空（用收到的时间）
   */
  void onQuote(String feed, String code, BigDecimal bid, BigDecimal ask, Instant time);
}
