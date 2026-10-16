package com.falconx.lite.market.web;

import com.falconx.lite.common.error.BizException;
import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.market.kline.Bar;
import com.falconx.lite.market.kline.KlineService;
import com.falconx.lite.market.kline.Timeframe;
import com.falconx.lite.market.quote.QuoteProcessor;
import com.falconx.lite.market.quote.RecentTicks;
import com.falconx.lite.market.web.Views.KlineView;
import com.falconx.lite.market.web.Views.QuoteView;
import com.falconx.lite.market.web.Views.SymbolView;
import com.falconx.lite.market.web.Views.TickView;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 行情接口（需要登录）。实时更新走 WebSocket /api/ws/market。 */
@RestController
class MarketController {

  private final MarketApi market;
  private final QuoteProcessor processor;
  private final KlineService klines;

  MarketController(MarketApi market, QuoteProcessor processor, KlineService klines) {
    this.market = market;
    this.processor = processor;
    this.klines = klines;
  }

  @GetMapping("/api/market/symbols")
  List<SymbolView> symbols() {
    return market.symbols().stream().map(s -> Views.symbol(s, Views.open(market, s.code()))).toList();
  }

  @GetMapping("/api/market/quotes")
  List<QuoteView> quotes() {
    return processor.book().all().stream()
        .flatMap(e -> market.symbol(e.quote().symbol()).stream().map(s -> Views.quote(e, s, market)))
        .toList();
  }

  @GetMapping("/api/market/klines")
  List<KlineView> klines(@RequestParam String symbol, @RequestParam String tf, @RequestParam(defaultValue = "300") int limit) {
    SymbolSpec s = market.symbol(symbol).orElseThrow(() -> new BizException("SYMBOL_NOT_FOUND", "品种不存在"));
    Timeframe t = Timeframe.of(tf).orElseThrow(() -> new BizException("TIMEFRAME_INVALID", "K 线周期不支持"));
    int n = Math.max(1, Math.min(limit, 1000));
    return klines.history(symbol, t, n).stream().map(b -> Views.kline(b, s.digits())).toList();
  }

  /**
   * 最近逐笔报价（客户端 Tick 图的初始数据，之后客户端用 WebSocket 推送的报价往后接）。
   * 只在内存里保留每个品种最近 500 笔，服务重启后从空开始（不存数据库，对照表 M-09）。
   */
  @GetMapping("/api/market/ticks")
  List<TickView> ticks(@RequestParam String symbol, @RequestParam(defaultValue = "500") int limit) {
    SymbolSpec s = market.symbol(symbol).orElseThrow(() -> new BizException("SYMBOL_NOT_FOUND", "品种不存在"));
    int n = Math.max(1, Math.min(limit, RecentTicks.CAPACITY));
    return processor.recentTicks(symbol, n).stream().map(t -> Views.tick(t, s.digits())).toList();
  }

  /** 今日走势（电脑版行情表的迷你图）：每个品种最近 24 根 1 小时 K 线的收盘价 */
  @GetMapping("/api/market/sparklines")
  Map<String, List<String>> sparklines() {
    Map<String, List<String>> out = new LinkedHashMap<>();
    for (SymbolSpec s : market.symbols()) {
      out.put(s.code(), klines.history(s.code(), Timeframe.H1, 24).stream().map(Bar::close).map(v -> Views.price(v, s.digits())).toList());
    }
    return out;
  }
}
