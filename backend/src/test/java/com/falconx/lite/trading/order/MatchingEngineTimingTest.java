package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.api.QuoteStatus;
import com.falconx.lite.notification.api.NotifyApi;
import com.falconx.lite.risk.api.RiskApi;
import com.falconx.lite.trading.api.LedgerApi;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * AC-13 计时口径：撮合检查用的"收到时间"必须是触发这次检查的那个报价的收到时间。
 * 不连数据库：只替换 scan（记录每次检查拿到的报价和时间），检查调度（合并、补排）用的是真实代码。
 */
class MatchingEngineTimingTest {

  /** 只记录每次检查拿到的报价和收到时间；第一次检查可以卡住，模拟"检查期间又来了新价格" */
  static final class RecordingEngine extends MatchingEngine {
    record Scan(MarketQuote quote, long nanos) {}

    final List<Scan> scans = new CopyOnWriteArrayList<>();
    final AtomicInteger mismatches = new AtomicInteger();
    volatile CountDownLatch firstScanStarted = new CountDownLatch(1);
    volatile CountDownLatch releaseFirstScan = new CountDownLatch(0);

    RecordingEngine(int threads) {
      super(mock(OrderMapper.class), mock(PositionService.class), mock(Funds.class), mock(LedgerApi.class), mock(MarketApi.class),
          mock(RiskApi.class), mock(TransactionTemplate.class), mock(TradingEvents.class), mock(NotifyApi.class),
          new TradingProperties(BigDecimal.ZERO, true, threads, 1, null, null));
    }

    @Override
    void scan(MarketQuote q, long receivedNanos) {
      scans.add(new Scan(q, receivedNanos));
      // 测试里报价的 bid 就是它的收到时间：对不上说明用了别的报价的时间
      if (q.bid().longValueExact() != receivedNanos) mismatches.incrementAndGet();
      boolean first = firstScanStarted.getCount() > 0;
      firstScanStarted.countDown();
      if (first) {
        try {
          releaseFirstScan.await(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
      }
    }
  }

  RecordingEngine engine;

  @AfterEach
  void stop() {
    if (engine != null) engine.stop();
  }

  /** 品种 symbol、收到时间 nanos 的报价；bid = ask = nanos，用来核对配对 */
  static MarketQuote quote(String symbol, long nanos) {
    BigDecimal px = BigDecimal.valueOf(nanos);
    return new MarketQuote(symbol, px, px, px, Instant.EPOCH, QuoteStatus.FRESH, true);
  }

  static void awaitScans(RecordingEngine e, int n) throws InterruptedException {
    long t0 = System.nanoTime();
    while (e.scans.size() < n) {
      if (System.nanoTime() - t0 > 5_000_000_000L) throw new AssertionError("5 秒内只检查了 " + e.scans.size() + " 次");
      Thread.sleep(2);
    }
  }

  @Test
  void 两个价格紧挨着到来_第一次检查用第一个价格的收到时间_第二次用第二个的() throws Exception {
    engine = new RecordingEngine(1);
    engine.releaseFirstScan = new CountDownLatch(1);
    engine.onQuote(quote("XAUUSD", 1_000), 1_000);
    assertThat(engine.firstScanStarted.await(5, TimeUnit.SECONDS)).isTrue();
    // 第一次检查还在进行时又来了两个价格：合并成一次，用最新的那个和它自己的时间
    engine.onQuote(quote("XAUUSD", 2_000), 2_000);
    engine.onQuote(quote("XAUUSD", 3_000), 3_000);
    engine.releaseFirstScan.countDown();
    awaitScans(engine, 2);
    Thread.sleep(50);
    assertThat(engine.scans).extracting(RecordingEngine.Scan::nanos).containsExactly(1_000L, 3_000L);
    assertThat(engine.scans).extracting(s -> s.quote().bid().longValueExact()).containsExactly(1_000L, 3_000L);
  }

  @Test
  void 价格密集到来时_每次检查的报价和收到时间都是同一个报价的() throws Exception {
    engine = new RecordingEngine(4);
    int writers = 4;
    int perWriter = 20_000;
    Thread[] ts = new Thread[writers];
    for (int w = 0; w < writers; w++) {
      final int base = w * perWriter;
      ts[w] = new Thread(() -> {
        for (int i = 1; i <= perWriter; i++) {
          long nanos = base + i;
          engine.onQuote(quote("XAUUSD", nanos), nanos);
        }
      });
    }
    for (Thread t : ts) t.start();
    for (Thread t : ts) t.join();
    Thread.sleep(200);
    assertThat(engine.scans).as("至少检查过").isNotEmpty();
    assertThat(engine.mismatches.get()).as("报价和收到时间对不上的检查次数").isZero();
  }
}
