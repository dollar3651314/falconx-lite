package com.falconx.lite.market.api;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * 对客户的报价：bid、ask 已含加点（只加一次）。买入按 ask 成交，卖出按 bid 成交。
 *
 * @param mid 基准中间价（不含加点），K 线和汇率用
 * @param executable 可以成交：最新报价质量为 FRESH、没有过期、在交易时段内
 */
public record MarketQuote(String symbol, BigDecimal bid, BigDecimal ask, BigDecimal mid, Instant time, QuoteStatus status, boolean executable) {}
