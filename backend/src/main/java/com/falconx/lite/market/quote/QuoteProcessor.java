package com.falconx.lite.market.quote;

import com.falconx.lite.market.MarketProperties;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.api.QuoteListener;
import com.falconx.lite.market.api.QuoteStatus;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.market.config.SymbolCatalog;
import com.falconx.lite.market.kline.KlineService;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
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
 * <p>监控（E8、E10）：记下每个品种最后一次收到原始报价的时间（不管质量守卫是否通过、是否休市），给行情断流告警
 * {@link MarketAlert} 和指标 {@code fx_quote_age_seconds}（每个品种最后报价距今的秒数）用；收到的报价数是指标 {@code fx_quotes_received_total}。
 * <p>报价源接入（技术方案/v2-报价源接入.md）：
 * <ul>
 *   <li>两家真实报价源价格偏差过大的品种（{@link #setDeviationPaused}，由 {@code feed.QuoteRouter} 设置）<b>只暂停开仓</b>（Amos 2026-10-17 选 B）：
 *       报价照常（用主源的价格）、照常可以成交，所以平仓、止盈止损、强平照常执行；开仓（市价单、挂单成交）由交易模块通过
 *       {@code MarketApi#quoteDeviationPaused} 拒绝。这里不改报价状态；</li>
 *   <li>官网"示例行情"单独一份（{@link #submitSample}）：真实源接管的品种，模拟价只写这里，不进交易链路。</li>
 * </ul>
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
  /** 品种 → 最后一次收到原始报价的时间 */
  private final Map<String, Instant> lastReceived = new ConcurrentHashMap<>();
  private final MeterRegistry metrics;
  private final Counter received;
  /** 两家报价源偏差过大、暂停开仓的品种（只在内存里，和品种自己的"暂停开仓"、风控的暂停是三个互不覆盖的开关） */
  private final Set<String> deviationPaused = ConcurrentHashMap.newKeySet();
  /** 官网"示例行情"（模拟价，不经过质量守卫，不进交易链路） */
  private final QuoteBook samples = new QuoteBook();

  QuoteProcessor(SymbolCatalog catalog, KlineService klines, MarketProperties props, Clock clock, MeterRegistry metrics) {
    this.catalog = catalog;
    this.klines = klines;
    this.props = props;
    this.guard = new QualityGuard(props);
    this.clock = clock;
    this.metrics = metrics;
    this.received = Counter.builder("fx.quotes.received").description("收到的原始报价条数（含被质量守卫拦下和休市的）").register(metrics);
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
    received(q.symbol(), now);
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

  private void received(String symbol, Instant now) {
    received.increment();
    if (lastReceived.put(symbol, now) == null) {
      Gauge.builder("fx.quote.age", () -> {
        Instant t = lastReceived.get(symbol);
        return t == null ? Double.NaN : (clock.millis() - t.toEpochMilli()) / 1000.0;
      }).description("这个品种最后一次收到报价距今的秒数").baseUnit("seconds").tag("symbol", symbol).register(metrics);
    }
  }

  /**
   * 报价源偏差（两家价格对不上）时暂停这个品种<b>开仓</b>；偏差回落后恢复。只动这一个开关，
   * 不碰品种自己的 {@code open_paused} 和风控的暂停（恢复时不会把运营手动设的暂停打开）。
   * 报价不受影响（继续可以成交），平仓、止盈止损、强平照常。
   */
  public void setDeviationPaused(String symbol, boolean paused) {
    if (paused) deviationPaused.add(symbol);
    else deviationPaused.remove(symbol);
  }

  /** 这个品种是否因为两家报价源偏差过大暂停开仓 */
  public boolean isDeviationPaused(String symbol) {
    return deviationPaused.contains(symbol);
  }

  /** 官网"示例行情"：模拟价加上品种的加点后直接记下（不经过质量守卫、不推送、不进 K 线和撮合） */
  public void submitSample(RawQuote q) {
    catalog.get(q.symbol()).ifPresent(spec -> samples.put(new MarketQuote(q.symbol(), q.bid().subtract(spec.markup()), q.ask().add(spec.markup()),
        QualityGuard.mid(q.bid(), q.ask()), q.time(), QuoteStatus.FRESH, true)));
  }

  /** 官网"示例行情"的最新一条（超过 staleAfter 没更新视为不可成交） */
  public Optional<MarketQuote> latestSample(String symbol) {
    return samples.latest(symbol, clock.instant(), props.staleAfter().toMillis());
  }

  public QuoteBook sampleBook() {
    return samples;
  }

  /** 这个品种最后一次收到原始报价的时间；从没收到过时为空 */
  public Optional<Instant> lastReceived(String symbol) {
    return Optional.ofNullable(lastReceived.get(symbol));
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
