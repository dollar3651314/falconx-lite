package com.falconx.lite.market.quote;

import com.falconx.lite.market.MarketProperties;
import jakarta.annotation.PreDestroy;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * 模拟行情源（falconx.market.source=simulated）：开发和测试环境用，价格做小幅随机游走，点差固定。
 * 起始价格取自原型数据（resources/simulated-prices.csv）。正式环境接 LP（S20），不使用这个类。
 * v2：csv 里没有的品种（后台新增的）用后台填的"模拟起始价"（market_symbol.sim_start_price）：启动时从库里读，
 * 后台新增或补填后由行情模块调用 {@link #seed} 立即加入。csv 里有的品种始终以 csv 为准。
 */
@Component
@ConditionalOnProperty(name = "falconx.market.source", havingValue = "simulated")
public class SimulatedQuoteSource {

  private record Walk(String symbol, int scale, BigDecimal spread, double[] price) {}

  /** 后台起始价的品种用的点差：起始价的万分之一，按小数位四舍五入，至少 1 个最小价格单位（csv 里外汇大约是这个比例） */
  static final BigDecimal SEED_SPREAD_RATE = new BigDecimal("0.0001");

  private final QuoteProcessor processor;
  private final MarketProperties props;
  private final SimStartPrices startPrices;
  private final Clock clock;
  /** 计时线程遍历，后台线程追加（{@link #seed}），用写时复制 */
  private final List<Walk> walks = new CopyOnWriteArrayList<>();
  private final Random random = new Random();
  private ScheduledExecutorService timer;

  /** 库里填了模拟起始价的品种（行情模块的后台实现提供，避免报价源直接读后台的表） */
  public interface SimStartPrices {
    record Entry(String symbol, BigDecimal price, int digits) {}

    List<Entry> simStartPrices();
  }

  SimulatedQuoteSource(QuoteProcessor processor, MarketProperties props, SimStartPrices startPrices, Clock clock) {
    this.processor = processor;
    this.props = props;
    this.startPrices = startPrices;
    this.clock = clock;
    try (var in = new BufferedReader(new InputStreamReader(new ClassPathResource("simulated-prices.csv").getInputStream(), StandardCharsets.UTF_8))) {
      in.lines().filter(l -> !l.isBlank() && !l.startsWith("#") && !l.startsWith("code,")).forEach(l -> {
        String[] p = l.split(",");
        BigDecimal price = new BigDecimal(p[1]);
        walks.add(new Walk(p[0], Math.max(price.scale(), new BigDecimal(p[2]).scale()), new BigDecimal(p[2]), new double[] {price.doubleValue()}));
      });
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  @EventListener(ApplicationReadyEvent.class)
  void start() {
    seedFromDatabase();
    timer = Executors.newSingleThreadScheduledExecutor(r -> new Thread(r, "simulated-quotes"));
    long ms = props.simulatedInterval().toMillis();
    timer.scheduleAtFixedRate(this::tick, ms, ms, TimeUnit.MILLISECONDS);
  }

  /** 库里填了模拟起始价、csv 里没有的品种加入随机游走（启动时调用；测试里调用它模拟重启）。返回这次加入的品种 */
  public List<String> seedFromDatabase() {
    return startPrices.simStartPrices().stream().filter(e -> seed(e.symbol(), e.price(), e.digits())).map(SimStartPrices.Entry::symbol).toList();
  }

  /** 是否已经在给这个品种报价（csv 或后台起始价） */
  public boolean has(String symbol) {
    return walks.stream().anyMatch(w -> w.symbol().equals(symbol));
  }

  /**
   * 后台起始价：还没有在报价的品种从 startPrice 开始随机游走（和其他品种同样的规则），立即推一条报价。
   * 已经在报价的品种（csv 里有，或之前已经加入）不变：避免价格跳变触发质量守卫、打到已有持仓的止盈止损。
   *
   * @return 是否加入了
   */
  public synchronized boolean seed(String symbol, BigDecimal startPrice, int digits) {
    if (symbol == null || startPrice == null || startPrice.signum() <= 0 || has(symbol)) return false;
    Walk w = new Walk(symbol, digits, seedSpread(startPrice, digits), new double[] {startPrice.doubleValue()});
    walks.add(w);
    synchronized (w) {
      processor.submit(quote(w, clock.instant()));
    }
    return true;
  }

  static BigDecimal seedSpread(BigDecimal price, int digits) {
    BigDecimal point = BigDecimal.ONE.movePointLeft(digits);
    return price.multiply(SEED_SPREAD_RATE).setScale(digits, RoundingMode.HALF_UP).max(point);
  }

  private void tick() {
    Instant now = clock.instant();
    for (Walk w : walks) {
      synchronized (w) {
        w.price()[0] *= 1 + random.nextGaussian() * 0.0002;
        processor.submit(quote(w, now));
      }
    }
  }

  private static RawQuote quote(Walk w, Instant now) {
    BigDecimal bid = BigDecimal.valueOf(w.price()[0]).setScale(w.scale(), RoundingMode.HALF_UP);
    return new RawQuote(w.symbol(), bid, bid.add(w.spread()), now);
  }

  /**
   * 把某个品种的原始卖价（不含加点）移到 bid，立即推一条报价，之后从这里继续随机游走。
   * 只给端到端测试用（{@link E2eMarket}，profile e2e），让止盈止损按测试的节奏触发。
   *
   * @return 推出的那条原始报价；没有这个品种时为空
   */
  Optional<RawQuote> moveTo(String symbol, BigDecimal bid) {
    for (Walk w : walks) {
      if (!w.symbol().equals(symbol)) continue;
      synchronized (w) {
        w.price()[0] = bid.doubleValue();
        RawQuote q = quote(w, clock.instant());
        processor.submit(q);
        return Optional.of(q);
      }
    }
    return Optional.empty();
  }

  @PreDestroy
  void stop() {
    if (timer != null) timer.shutdownNow();
  }
}
