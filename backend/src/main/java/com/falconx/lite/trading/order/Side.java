package com.falconx.lite.trading.order;

import com.falconx.lite.market.api.MarketQuote;
import java.math.BigDecimal;

/** 买卖方向。接口里用小写（buy / sell），和客户端一致。 */
enum Side {
  BUY,
  SELL;

  /** 开仓成交价：买入按 ask，卖出按 bid */
  BigDecimal openPrice(MarketQuote q) {
    return this == BUY ? q.ask() : q.bid();
  }

  /** 平仓价：多单按 bid 平，空单按 ask 平 */
  BigDecimal closePrice(MarketQuote q) {
    return this == BUY ? q.bid() : q.ask();
  }

  String api() {
    return name().toLowerCase();
  }
}
