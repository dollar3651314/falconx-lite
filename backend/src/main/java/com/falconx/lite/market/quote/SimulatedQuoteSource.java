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
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
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
 */
@Component
@ConditionalOnProperty(name = "falconx.market.source", havingValue = "simulated")
class SimulatedQuoteSource {

  private record Walk(String symbol, int scale, BigDecimal spread, double[] price) {}

  private final QuoteProcessor processor;
  private final MarketProperties props;
  private final List<Walk> walks = new ArrayList<>();
  private final Random random = new Random();
  private ScheduledExecutorService timer;

  SimulatedQuoteSource(QuoteProcessor processor, MarketProperties props) {
    this.processor = processor;
    this.props = props;
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
    timer = Executors.newSingleThreadScheduledExecutor(r -> new Thread(r, "simulated-quotes"));
    long ms = props.simulatedInterval().toMillis();
    timer.scheduleAtFixedRate(this::tick, ms, ms, TimeUnit.MILLISECONDS);
  }

  private void tick() {
    Instant now = Instant.now();
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
  java.util.Optional<RawQuote> moveTo(String symbol, BigDecimal bid) {
    for (Walk w : walks) {
      if (!w.symbol().equals(symbol)) continue;
      synchronized (w) {
        w.price()[0] = bid.doubleValue();
        RawQuote q = quote(w, Instant.now());
        processor.submit(q);
        return java.util.Optional.of(q);
      }
    }
    return java.util.Optional.empty();
  }

  @PreDestroy
  void stop() {
    if (timer != null) timer.shutdownNow();
  }
}
