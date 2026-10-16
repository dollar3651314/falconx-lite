package com.falconx.lite.market.web;

import com.falconx.lite.market.MarketProperties;
import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.market.quote.QuoteBook;
import com.falconx.lite.market.quote.QuoteProcessor;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 官网公开行情（v2 需求 4.2、AC2-02、AC2-03；技术方案/v2-官网技术方案.md 第 3 节）：{@code GET /api/public/quotes}，<b>不需要登录</b>。
 * <ul>
 *   <li>只返回配置的那几个品种（{@link PublicQuoteProperties#symbols()}）的代码、中英文名、<b>卖价</b>、当日涨跌幅、报价时间、状态；
 *       不返回买价、加点、账户、持仓、敞口、阈值等任何其他字段（约定 4；字段由 {@code PublicQuoteControllerTest} 逐个检查）。</li>
 *   <li>休市（不在交易时段）返回 {@code CLOSED}，没有报价、报价过期或异常返回 {@code NO_QUOTE}；这两种状态下价格、涨跌幅、时间都是 null，
 *       <b>不返回过期价格</b>。</li>
 *   <li>整份结果缓存 {@code cacheTtl}（默认 1 秒）：所有访客共用一份，刷接口不增加计算量；另外受通用限流（{@code IpRateLimitFilter}，按 IP 每分钟 600 次）
 *       和 Nginx 外层限流约束。官网每秒轮询一次，一个页面每分钟 60 次。</li>
 *   <li>{@code sample}：报价来自模拟报价源（测试环境）时为 true，官网据此标"示例行情"。</li>
 * </ul>
 * 选轮询不用 WebSocket 的理由见技术方案：结果本来就按秒缓存，轮询简单、无状态、经过 Nginx 和限流不用特殊处理，断网恢复后自然继续。
 */
@RestController
@EnableConfigurationProperties(PublicQuoteProperties.class)
class PublicQuoteController {

  private static final Logger log = LoggerFactory.getLogger(PublicQuoteController.class);

  /** 状态：开市且有新鲜报价 */
  static final String OPEN = "OPEN";
  /** 状态：不在交易时段（官网显示"休市"） */
  static final String CLOSED = "CLOSED";
  /** 状态：开市但没有可用报价（没收到、过期、异常；官网显示"暂无报价"） */
  static final String NO_QUOTE = "NO_QUOTE";

  /** 一个品种。价格、涨跌幅、时间只在 OPEN 时有值 */
  record Item(String symbol, String nameZh, String nameEn, String bid, String changePct, String time, String status) {}

  /** 整份结果 */
  record PublicQuotes(boolean sample, List<Item> items) {}

  private record Cached(Instant at, PublicQuotes body) {}

  private final MarketApi market;
  private final QuoteProcessor processor;
  private final PublicQuoteProperties props;
  private final boolean sample;
  private final Clock clock;
  private volatile Cached cached;

  PublicQuoteController(MarketApi market, QuoteProcessor processor, PublicQuoteProperties props, MarketProperties marketProps, Clock clock) {
    this.market = market;
    this.processor = processor;
    this.props = props;
    this.sample = "simulated".equalsIgnoreCase(marketProps.source());
    this.clock = clock;
    for (String code : props.symbols()) {
      if (market.symbol(code).isEmpty()) log.warn("官网公开行情配置了品种表里没有的代码 {}，忽略", code);
    }
  }

  @GetMapping("/api/public/quotes")
  ResponseEntity<PublicQuotes> quotes() {
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(current());
  }

  /** 缓存过期才重新计算；并发时最多多算一次，结果一样，不加锁 */
  PublicQuotes current() {
    Instant now = clock.instant();
    Cached c = cached;
    if (c == null || now.isBefore(c.at()) || !now.isBefore(c.at().plus(props.cacheTtl()))) {
      c = new Cached(now, build(now));
      cached = c;
    }
    return c.body();
  }

  /** 测试用：清掉缓存 */
  void clearCache() {
    cached = null;
  }

  private PublicQuotes build(Instant now) {
    List<Item> items = new ArrayList<>();
    for (String code : props.symbols()) {
      market.symbol(code).ifPresent(s -> items.add(item(s, now)));
    }
    return new PublicQuotes(sample, List.copyOf(items));
  }

  private Item item(SymbolSpec s, Instant now) {
    if (!market.isTradingOpen(s.code(), now)) return empty(s, CLOSED);
    Optional<MarketQuote> q = processor.latest(s.code());
    Optional<QuoteBook.Entry> e = processor.book().get(s.code());
    if (q.isEmpty() || !q.get().executable() || e.isEmpty()) return empty(s, NO_QUOTE);
    BigDecimal bid = q.get().bid();
    return new Item(s.code(), s.nameZh(), s.nameEn(), Views.price(bid, s.digits()), changePct(e.get(), bid, now), q.get().time().toString(), OPEN);
  }

  /** 当日涨跌幅（%，两位小数）= (卖价 − 今日开盘卖价) ÷ 今日开盘卖价 × 100；和客户端 lib/trading.ts 的 changePercent 同一口径（按 UTC 日） */
  static String changePct(QuoteBook.Entry e, BigDecimal bid, Instant now) {
    long today = now.atZone(ZoneOffset.UTC).toLocalDate().toEpochDay();
    BigDecimal open = e.day() == today ? e.dayOpen() : bid;
    if (open.signum() == 0) return "0.00";
    return bid.subtract(open).multiply(BigDecimal.valueOf(100)).divide(open, 2, RoundingMode.HALF_UP).toPlainString();
  }

  private static Item empty(SymbolSpec s, String status) {
    return new Item(s.code(), s.nameZh(), s.nameEn(), null, null, null, status);
  }
}
