package com.falconx.lite.market.quote.feed;

import com.falconx.lite.market.MarketProperties;
import com.falconx.lite.market.api.MarketAdminApi.QuoteSource;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.market.config.SymbolCatalog;
import com.falconx.lite.market.quote.QuoteProcessor;
import com.falconx.lite.market.quote.RawQuote;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 按品种选报价源（技术方案/v2-报价源接入.md 第 3、4 节）：
 * <ul>
 *   <li>每个品种的映射来自 {@link QuoteFeedsProperties#parsedRoutes()}，<b>只保留配了 token 的报价源</b>。一个都没有的品种：
 *       {@code simulated} 模式下继续走模拟源，{@code live} 模式下没有报价；</li>
 *   <li>主备：主源这个品种超过 {@code failover-after} 没报价、备源有新报价 → 切备源；主源重新连续报价满 {@code failback-after} → 切回；
 *       切换在每条报价进来时判断，不用定时器；</li>
 *   <li>交叉校验：两家的报价都在 {@code cross-check-max-age} 以内时比较中间价，偏差超过 {@code max-deviation} →
 *       {@link QuoteProcessor#setSourceBlocked}（这个品种不能成交），回到阈值以内或一边没有新价时恢复；</li>
 *   <li>进主链路前：USDT 计价的映射乘 {@code usdt-usd-rate}；按品种小数位取整，买价向下、卖价向上（点差只会变宽）。</li>
 * </ul>
 * 只有"当前使用的源"的报价交给 {@link QuoteProcessor}，之后的交易时段、质量守卫、加点都不变。时间都用注入的时钟。
 */
@Component
@EnableConfigurationProperties(QuoteFeedsProperties.class)
public class QuoteRouter implements QuoteSink {

  private static final Logger log = LoggerFactory.getLogger(QuoteRouter.class);
  private static final MathContext MC = MathContext.DECIMAL64;

  /** 报价模式（falconx.market.source） */
  public enum Mode {
    /** 不启动任何报价源（后端测试） */
    NONE,
    /** 配了 token 的报价源接管它覆盖的品种，其余模拟（开发、测试环境） */
    SIMULATED,
    /** 只用真实报价源（生产） */
    LIVE
  }

  private record Last(BigDecimal bid, BigDecimal ask, Instant receivedAt, Instant streakSince) {
    BigDecimal mid() {
      return bid.add(ask).divide(BigDecimal.TWO, MC);
    }
  }

  /** 一个品种的状态（按品种加锁） */
  private static final class Route {
    final String symbol;
    /** 配了 token 的报价源，主源在前 */
    final List<QuoteFeedsProperties.Route> feeds;
    final Map<String, Last> last = new HashMap<>();
    /** 当前用 feeds 里的第几个 */
    int active;
    boolean blocked;
    BigDecimal deviation;

    Route(String symbol, List<QuoteFeedsProperties.Route> feeds) {
      this.symbol = symbol;
      this.feeds = feeds;
    }

    String activeFeed() {
      return feeds.get(active).feed();
    }
  }

  private final Mode mode;
  private final QuoteFeedsProperties props;
  private final QuoteProcessor processor;
  private final SymbolCatalog catalog;
  private final Clock clock;
  /** 有可用真实源的品种 */
  private final Map<String, Route> routes = new LinkedHashMap<>();
  /** 报价源|代码（大写） → 品种 */
  private final Map<String, Route> byCode = new HashMap<>();
  /** 报价源 → 连接 → 代码 */
  private final Map<String, Map<String, List<String>>> subscriptions = new LinkedHashMap<>();

  public QuoteRouter(MarketProperties market, QuoteFeedsProperties props, QuoteProcessor processor, SymbolCatalog catalog, Clock clock, MeterRegistry metrics) {
    this.mode = mode(market.source());
    this.props = props;
    this.processor = processor;
    this.catalog = catalog;
    this.clock = clock;
    Map<String, List<QuoteFeedsProperties.Route>> parsed = props.parsedRoutes();
    for (var e : parsed.entrySet()) {
      for (QuoteFeedsProperties.Route r : e.getValue()) validate(e.getKey(), r);
    }
    if (mode != Mode.NONE) {
      for (var e : parsed.entrySet()) {
        List<QuoteFeedsProperties.Route> usable = e.getValue().stream().filter(r -> props.configured(r.feed())).toList();
        if (usable.isEmpty()) continue;
        Route route = new Route(e.getKey(), usable);
        routes.put(e.getKey(), route);
        for (QuoteFeedsProperties.Route r : usable) {
          byCode.put(key(r.feed(), r.code()), route);
          subscriptions.computeIfAbsent(r.feed(), k -> new LinkedHashMap<>()).computeIfAbsent(r.channel(), k -> new ArrayList<>()).add(r.code());
        }
      }
    }
    Gauge.builder("fx.quote.route.backup", this, x -> x.onBackup().size()).description("正在用备源的品种数").register(metrics);
    Gauge.builder("fx.quote.route.deviation", this, x -> x.deviations().size()).description("两家报价偏差过大、暂停成交的品种数").register(metrics);
    if (!routes.isEmpty()) log.info("真实报价源接管 {} 个品种（报价模式 {}，报价源 {}）", routes.size(), mode, subscriptions.keySet());
  }

  static Mode mode(String source) {
    if (source == null) return Mode.NONE;
    return switch (source.strip().toLowerCase(Locale.ROOT)) {
      case "simulated" -> Mode.SIMULATED;
      case "live" -> Mode.LIVE;
      default -> Mode.NONE;
    };
  }

  private static void validate(String symbol, QuoteFeedsProperties.Route r) {
    Set<String> channels = switch (r.feed()) {
      case AllTickFeed.NAME -> AllTickFeed.CHANNELS;
      case ITickFeed.NAME -> ITickFeed.CHANNELS;
      default -> throw new IllegalArgumentException("falconx.market.feeds.routes." + symbol + " 用了不认识的报价源 " + r.feed());
    };
    if (!channels.contains(r.channel())) {
      throw new IllegalArgumentException("falconx.market.feeds.routes." + symbol + " 的 " + r.feed() + " 连接 " + r.channel() + " 不对，只能是 " + channels);
    }
  }

  private static String key(String feed, String code) {
    return feed + "|" + code.toUpperCase(Locale.ROOT);
  }

  public Mode mode() {
    return mode;
  }

  /** 这个品种的交易报价来自真实源（不是模拟源）：{@code live} 模式下全部是，{@code simulated} 模式下有配了 token 的映射的才是 */
  public boolean liveTrading(String symbol) {
    return mode == Mode.LIVE || (mode == Mode.SIMULATED && routes.containsKey(symbol));
  }

  /** 每家报价源要订阅的代码（按连接分）；没有配 token 的报价源不在里面 */
  public Map<String, Map<String, List<String>>> subscriptions() {
    return subscriptions;
  }

  /** 品种当前在用的报价源（后台品种页）；没有报价源时为空 */
  public Optional<QuoteSource> current(String symbol) {
    Route r = routes.get(symbol);
    if (r == null) return mode == Mode.SIMULATED ? Optional.of(new QuoteSource("simulated", null)) : Optional.empty();
    synchronized (r) {
      String state = r.blocked ? "deviation" : r.active == 0 ? "primary" : "backup";
      return Optional.of(new QuoteSource(r.activeFeed(), state));
    }
  }

  /** 正在用备源的品种 */
  public List<String> onBackup() {
    List<String> out = new ArrayList<>();
    for (Route r : routes.values()) {
      synchronized (r) {
        if (r.active != 0) out.add(r.symbol + "（" + r.activeFeed() + "）");
      }
    }
    return out;
  }

  /** 偏差过大、暂停成交的品种和偏差（百分比） */
  public List<String> deviations() {
    List<String> out = new ArrayList<>();
    for (Route r : routes.values()) {
      synchronized (r) {
        if (r.blocked) out.add(r.symbol + " " + r.deviation.movePointRight(2).setScale(2, RoundingMode.HALF_UP).toPlainString() + "%");
      }
    }
    return out;
  }

  /** 这家报价源负责的品种（告警看"开市的品种有没有报价"用） */
  public List<String> symbolsOf(String feed) {
    return routes.values().stream().filter(r -> r.feeds.stream().anyMatch(x -> x.feed().equals(feed))).map(r -> r.symbol).toList();
  }

  @Override
  public void onQuote(String feed, String code, BigDecimal bid, BigDecimal ask, Instant time) {
    Route r = byCode.get(key(feed, code));
    if (r == null) return; // 没订阅的代码
    Optional<SymbolSpec> spec = catalog.get(r.symbol);
    if (spec.isEmpty()) return; // 停用的品种
    if (code.toUpperCase(Locale.ROOT).endsWith("USDT") && props.usdtUsdRate().compareTo(BigDecimal.ONE) != 0) {
      bid = bid.multiply(props.usdtUsdRate(), MC);
      ask = ask.multiply(props.usdtUsdRate(), MC);
    }
    int digits = spec.get().digits();
    bid = bid.setScale(digits, RoundingMode.FLOOR);
    ask = ask.setScale(digits, RoundingMode.CEILING);
    if (bid.signum() <= 0 || ask.signum() <= 0) return;
    Instant now = clock.instant();
    RawQuote out = null;
    synchronized (r) {
      Last prev = r.last.get(feed);
      boolean gap = prev == null || Duration.between(prev.receivedAt(), now).compareTo(props.failoverAfter()) > 0;
      r.last.put(feed, new Last(bid, ask, now, gap ? now : prev.streakSince()));
      choose(r, now);
      crossCheck(r, now);
      if (feed.equals(r.activeFeed())) out = new RawQuote(r.symbol, bid, ask, time == null ? now : time);
    }
    if (out != null) processor.submit(out);
  }

  private boolean fresh(Last l, Instant now, Duration within) {
    return l != null && Duration.between(l.receivedAt(), now).compareTo(within) <= 0;
  }

  /** 主备切换 */
  private void choose(Route r, Instant now) {
    if (r.feeds.size() < 2) return;
    Last p = r.last.get(r.feeds.get(0).feed());
    Last b = r.last.get(r.feeds.get(1).feed());
    boolean pFresh = fresh(p, now, props.failoverAfter());
    boolean bFresh = fresh(b, now, props.failoverAfter());
    if (r.active == 0) {
      if (!pFresh && bFresh) {
        r.active = 1;
        log.warn("品种 {} 主报价源 {} 超过 {} 秒没有报价，切到备源 {}", r.symbol, r.feeds.get(0).feed(), props.failoverAfter().toSeconds(), r.feeds.get(1).feed());
      }
    } else if (pFresh && (!bFresh || Duration.between(p.streakSince(), now).compareTo(props.failbackAfter()) >= 0)) {
      r.active = 0;
      log.info("品种 {} 主报价源 {} 已恢复，切回主源", r.symbol, r.feeds.get(0).feed());
    }
  }

  /** 交叉校验 */
  private void crossCheck(Route r, Instant now) {
    if (r.feeds.size() < 2) return;
    Last p = r.last.get(r.feeds.get(0).feed());
    Last b = r.last.get(r.feeds.get(1).feed());
    boolean block = false;
    BigDecimal dev = null;
    if (fresh(p, now, props.crossCheckMaxAge()) && fresh(b, now, props.crossCheckMaxAge())) {
      dev = p.mid().subtract(b.mid()).abs().divide(b.mid(), MC);
      block = dev.compareTo(props.maxDeviation()) > 0;
    }
    if (block != r.blocked) {
      r.blocked = block;
      if (block) {
        log.warn("品种 {} 两家报价偏差 {}（{} {} / {} {}），超过阈值 {}，暂停成交", r.symbol, dev.toPlainString(), r.feeds.get(0).feed(), p.mid(),
            r.feeds.get(1).feed(), b.mid(), props.maxDeviation());
      } else {
        log.info("品种 {} 两家报价偏差恢复正常，恢复成交", r.symbol);
      }
      processor.setSourceBlocked(r.symbol, block);
    }
    if (block) r.deviation = dev;
  }
}
