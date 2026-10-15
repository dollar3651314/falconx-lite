package com.falconx.lite.market.quote;

import java.math.BigDecimal;
import java.time.Instant;

/** 报价源给的原始报价（不含加点），symbol 已是平台品种代码。 */
public record RawQuote(String symbol, BigDecimal bid, BigDecimal ask, Instant time) {}
