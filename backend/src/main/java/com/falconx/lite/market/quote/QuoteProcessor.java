package com.falconx.lite.market.quote;

import com.falconx.lite.market.MarketProperties;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.api.QuoteListener;
import com.falconx.lite.market.api.QuoteStatus;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.market.config.SymbolCatalog;
import com.falconx.lite.market.kline.KlineService;
import jakarta.annotation.PreDestroy;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * 行情主链路（00-架构方案.md 3.3 ①）：报价 → 交易时段 → 质量守卫 → 加点 → 最新报价 → K 线 → 订阅者。
 * 按品种分到固定的处理线程（同一品种严格按顺序），不同品种并行。
 */
@Component
public class QuoteProcessor {

  private static final Logger log = LoggerFactory.getLogger(QuoteProcessor.class);
  private static final int STRIPES = 8;

  private final SymbolCatalog catalog;
  private final KlineService klines;
  private final MarketProperties props;
  private final QualityGuard guard;
  private final QuoteBook book = new QuoteBook();
  private final RecentTicks ticks = new RecentTicks();
  private final List<QuoteListener> listeners = new CopyOnWriteArrayList<>();
  private final Set<String> changed = ConcurrentHashMap.newKeySet();
  private final ExecutorService[] stripes = new ExecutorService[STRIPES];
  private final Clock clock;

  QuoteProcessor(SymbolCatalog catalog, KlineService klines, MarketProperties props, Clock clock) {
    this.catalog = catalog;
    this.klines = klines;
    this.props = props;
    this.guard = new QualityGuard(props);
    this.clock = clock;
    for (int i = 0; i < STRIPES; i++) {
      int n = i;
      stripes[i] = Executors.newSingleThreadExecutor(r -> new Thread(r, "quote-" + n));
    }
  }

  /** 报价源调用：交给该品种的处理线程 */
  public void submit(RawQuote q) {
    stripes[Math.floorMod(q.symbol().hashCode(), STRIPES)].execute(() -> {
      try {
        process(q);
      } catch (RuntimeException e) {
        log.error("处理报价失败 {}", q.symbol(), e);
      }
    });
  }

  /** 处理一条报价，返回质量状态。测试里直接调用 */
  public QuoteStatus process(RawQuote q) {
    Optional<SymbolSpec> spec = catalog.get(q.symbol());
    if (spec.isEmpty()) return QuoteStatus.ABNORMAL; // 没有配置的品种直接丢弃
    Instant now = clock.instant();
    if (!catalog.isOpen(q.symbol(), now)) {
      book.markStatus(q.symbol(), QuoteStatus.MARKET_CLOSED);
      return QuoteStatus.MARKET_CLOSED;
    }
    QuoteStatus st = guard.evaluate(q, now);
    if (st != QuoteStatus.FRESH) {
      book.markStatus(q.symbol(), st);
      changed.add(q.symbol());
      return st;
    }
    // 加点只加一次：卖价减、买价加（需求 4.3-2，修复现有系统 T1 的重复加点）
    var markup = spec.get().markup();
    MarketQuote mq = new MarketQuote(q.symbol(), q.bid().subtract(markup), q.ask().add(markup), QualityGuard.mid(q.bid(), q.ask()), q.time(), st, true);
    book.put(mq);
    ticks.add(q.symbol(), new RecentTicks.Tick(q.time(), mq.bid(), mq.ask()));
    klines.accept(q.symbol(), mq.mid(), q.time());
    changed.add(q.symbol());
    for (QuoteListener l : listeners) {
      try {
        l.onQuote(mq);
      } catch (RuntimeException e) {
        log.error("报价订阅者处理失败 {}", q.symbol(), e);
      }
    }
    return st;
  }

  public void subscribe(QuoteListener l) {
    listeners.add(l);
  }

  public QuoteBook book() {
    return book;
  }

  /** 某个品种最近 limit 笔报价（Tick 图），只在内存里，见 {@link RecentTicks} */
  public List<RecentTicks.Tick> recentTicks(String symbol, int limit) {
    return ticks.recent(symbol, limit);
  }

  public Optional<MarketQuote> latest(String symbol) {
    return book.latest(symbol, clock.instant(), props.staleAfter().toMillis());
  }

  /** 推送用：取出并清空自上次以来有变化的品种 */
  public Set<String> drainChanged() {
    Set<String> out = Set.copyOf(changed);
    changed.removeAll(out);
    return out;
  }

  Instant now() {
    return clock.instant();
  }

  @PreDestroy
  void stop() {
    for (ExecutorService e : stripes) e.shutdownNow();
  }
}
