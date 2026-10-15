package com.falconx.lite.market.api;

import java.math.BigDecimal;

/** 品种参数（market_symbol 一行）。交易模块下单、算保证金时使用。 */
public record SymbolSpec(
    String code, String nameZh, String nameEn, String category, int digits, BigDecimal contractSize, String unit,
    String baseCcy, String quoteCcy, int maxLeverage, BigDecimal minLots, BigDecimal maxLots, BigDecimal lotStep,
    BigDecimal feeRate, BigDecimal maintenanceMarginRate, BigDecimal markup, BigDecimal swapLong, BigDecimal swapShort,
    boolean hot, boolean openPaused, int sortOrder) {}
