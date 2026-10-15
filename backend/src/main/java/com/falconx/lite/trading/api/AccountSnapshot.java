package com.falconx.lite.trading.api;

import java.math.BigDecimal;

/** 交易账户当前的三项金额。 */
public record AccountSnapshot(long userId, BigDecimal balance, BigDecimal withdrawFrozen, BigDecimal orderFrozen) {}
