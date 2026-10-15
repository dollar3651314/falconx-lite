package com.falconx.lite.trading.ledger;

import java.math.BigDecimal;

/** trading_ledger 的一行（只取幂等判断需要的字段）。 */
record LedgerRow(long id, BigDecimal valueAfter) {}
