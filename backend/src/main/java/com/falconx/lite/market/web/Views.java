package com.falconx.lite.market.web;

import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.market.kline.Bar;
import com.falconx.lite.market.quote.QuoteBook;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;

/** 返回给客户端的格式，和前端 src/api/types.ts 的 SymbolInfo、Quote、Kline 一致。价格按品种小数位输出成字符串。 */
final class Views {
  private Views() {}

  record SymbolView(String code, String nameZh, String nameEn, String category, int digits, String contractSize, String unit, String baseCcy, String quoteCcy,
      int maxLeverage, String minLots, String maxLots, String lotStep, String feeRate, String maintenanceMarginRate, boolean hot, boolean openPaused,
      boolean tradingOpen) {}

  record QuoteView(String symbol, String bid, String ask, String open, String high, String low, String quoteToUsd, String time) {}

  record KlineView(long time, String open, String high, String low, String close, String volume) {}

  static String plain(BigDecimal v) {
    return v.stripTrailingZeros().toPlainString();
  }

  static String price(BigDecimal v, int digits) {
    return v.setScale(digits, RoundingMode.HALF_UP).toPlainString();
  }

  static SymbolView symbol(SymbolSpec s, boolean open) {
    return new SymbolView(s.code(), s.nameZh(), s.nameEn(), s.category(), s.digits(), plain(s.contractSize()), s.unit(), s.baseCcy(), s.quoteCcy(),
        s.maxLeverage(), plain(s.minLots()), plain(s.maxLots()), plain(s.lotStep()), plain(s.feeRate()), plain(s.maintenanceMarginRate()), s.hot(),
        s.openPaused(), open);
  }

  static QuoteView quote(QuoteBook.Entry e, SymbolSpec s, MarketApi market) {
    int d = s.digits();
    String usd = market.toUsdRate(s.quoteCcy()).map(Views::plain).orElse(null);
    return new QuoteView(s.code(), price(e.quote().bid(), d), price(e.quote().ask(), d), price(e.dayOpen(), d), price(e.dayHigh(), d), price(e.dayLow(), d), usd,
        e.quote().time().toString());
  }

  static KlineView kline(Bar b, int digits) {
    return new KlineView(b.time(), price(b.open(), digits), price(b.high(), digits), price(b.low(), digits), price(b.close(), digits), String.valueOf(b.ticks()));
  }

  static boolean open(MarketApi market, String code) {
    return market.isTradingOpen(code, Instant.now());
  }
}
