package com.falconx.lite.market.quote.feed;

import static com.falconx.lite.market.quote.feed.FeedTestSupport.FAKE_TOKEN;
import static com.falconx.lite.market.quote.feed.FeedTestSupport.JSON;
import static com.falconx.lite.market.quote.feed.FeedTestSupport.WAIT;
import static com.falconx.lite.market.quote.feed.FeedTestSupport.await;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.falconx.lite.market.MarketProperties;
import com.falconx.lite.market.api.MarketAdminApi.QuoteSource;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.market.config.SymbolCatalog;
import com.falconx.lite.market.quote.QuoteProcessor;
import com.falconx.lite.market.quote.RawQuote;
import com.falconx.lite.support.MutableClock;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * 币安断了切到 AllTick（技术方案/v2-报价源接入.md 第 12 节）：真实的 {@link BinanceFeed}、{@link AllTickFeed}、{@link QuoteRouter} 串起来，
 * 两家都连本地假服务器；路由的时钟手动拨（主备切换按路由的时钟判断）。
 */
class BinanceFailoverTest {

  FakeWsServer server;
  BinanceFeed binance;
  AllTickFeed alltick;

  @AfterEach
  void tearDown() throws Exception {
    if (binance != null) binance.close();
    if (alltick != null) alltick.close();
    if (server != null) server.close();
  }

  @Test
  void 币安断线时BTCUSD切到AllTick_币安重连恢复满30秒后切回() throws Exception {
    server = new FakeWsServer();
    server.onMessage = (c, m) -> {
      if (m.contains("\"cmd_id\":22002")) c.send("{\"ret\":200,\"msg\":\"ok\",\"cmd_id\":22003,\"seq_id\":1,\"trace\":\"x\",\"data\":{}}");
    };
    MutableClock clock = new MutableClock();
    List<RawQuote> submitted = new CopyOnWriteArrayList<>();
    QuoteProcessor processor = mock(QuoteProcessor.class);
    org.mockito.Mockito.doAnswer(i -> submitted.add(i.getArgument(0))).when(processor).submit(org.mockito.ArgumentMatchers.any());
    SymbolCatalog catalog = mock(SymbolCatalog.class);
    when(catalog.get(anyString())).thenReturn(Optional.of(new SymbolSpec("BTCUSD", "BTCUSD", "BTCUSD", "crypto", 1, BigDecimal.ONE, "unit", "BTC", "USD", 100,
        BigDecimal.ONE, BigDecimal.ONE, BigDecimal.ONE, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, false, false, 0)));
    QuoteFeedsProperties props = new QuoteFeedsProperties("alltick", Duration.ofSeconds(10), Duration.ofSeconds(30), new BigDecimal("0.005"),
        Duration.ofSeconds(5), BigDecimal.ONE, Duration.ofSeconds(60), Duration.ofMillis(50), Duration.ofMillis(400), Duration.ofSeconds(30),
        new QuoteFeedsProperties.AllTick(FAKE_TOKEN, server.url("/quote-b-ws-api"), server.url("/quote-stock-b-ws-api"), Duration.ofMillis(200),
            Duration.ofMillis(100)),
        null, new QuoteFeedsProperties.Binance(true, server.baseUrl(), false, null, Duration.ofMillis(200), 0, null),
        Map.of("BTCUSD", List.of("binance:spot:BTCUSDT", "alltick:fx:BTCUSDT", "itick:crypto:BTCUSDT$BA")));
    MarketProperties market = new MarketProperties("simulated", Duration.ofMillis(500), Duration.ofSeconds(5), Duration.ofMinutes(1), new BigDecimal("0.05"),
        new BigDecimal("0.10"), new BigDecimal("0.05"), Duration.ofSeconds(60), Duration.ofMillis(250), Map.of());
    QuoteRouter router = new QuoteRouter(market, props, processor, catalog, clock, new SimpleMeterRegistry());
    assertThat(router.subscriptions()).containsOnlyKeys("binance", "alltick");

    SimpleMeterRegistry metrics = new SimpleMeterRegistry();
    // 报价先交给路由，再计数（测试用来等"这一条已经被路由处理过"）
    Map<String, AtomicInteger> seen = Map.of("binance", new AtomicInteger(), "alltick", new AtomicInteger());
    QuoteSink sink = (feed, code, bid, ask, time) -> {
      router.onQuote(feed, code, bid, ask, time);
      seen.get(feed).incrementAndGet();
    };
    binance = new BinanceFeed(props, router.subscriptions().get("binance"), sink, JSON, metrics);
    alltick = new AllTickFeed(props, router.subscriptions().get("alltick"), sink, JSON, metrics);
    binance.start();
    alltick.start();
    FakeWsServer.Conn bn = server.awaitConnection("/stream", 1, WAIT);
    FakeWsServer.Conn at = server.awaitConnection("/quote-b-ws-api", 1, WAIT);
    at.nextContaining("22002", WAIT);

    bn.send(BinanceFeedTest.SPOT_SAMPLE);
    await("币安的价到了路由", () -> seen.get("binance").get() == 1);
    at.send(AllTickFeedTest.depth("BTCUSDT", "81580.0", "81590.0", 1_792_000_000_000L));
    await("AllTick 的价到了路由", () -> seen.get("alltick").get() == 1);
    assertThat(submitted).as("只有主源（币安）的价进主链路").hasSize(1);
    assertThat(submitted.getFirst().bid()).isEqualByComparingTo("81588.6");
    assertThat(router.current("BTCUSD")).contains(new QuoteSource("binance", "primary"));

    // 币安断线（握手也被拒绝，一直连不上），11 秒后 AllTick 来新价 → 切到 AllTick
    server.rejectStatus = 451;
    bn.kill();
    await("币安连接断开", () -> binance.status().getFirst().state() != QuoteFeed.State.CONNECTED);
    clock.advance(Duration.ofSeconds(11));
    at.send(AllTickFeedTest.depth("BTCUSDT", "81590.0", "81600.0", 1_792_000_011_000L));
    await("切到 AllTick", () -> router.current("BTCUSD").orElseThrow().equals(new QuoteSource("alltick", "backup")));
    await("AllTick 的价进主链路", () -> submitted.getLast().bid().compareTo(new BigDecimal("81590.0")) == 0);

    // 币安恢复：重连后连续报价满 30 秒才切回
    server.rejectStatus = 0;
    FakeWsServer.Conn bn2 = server.awaitConnection("/stream", 2, WAIT);
    await("币安重连", () -> binance.status().getFirst().state() == QuoteFeed.State.CONNECTED);
    for (int i = 0; i <= 6; i++) {
      int b = seen.get("binance").get();
      int a = seen.get("alltick").get();
      bn2.send(BinanceFeedTest.SPOT_SAMPLE.replace("81588.60000000", "8159" + i + ".00000000"));
      at.send(AllTickFeedTest.depth("BTCUSDT", "81590.0", "81600.0", 1_792_000_011_000L));
      await("两家这一条都到了路由", () -> seen.get("binance").get() > b && seen.get("alltick").get() > a);
      if (i < 6) {
        assertThat(router.current("BTCUSD").orElseThrow().feed()).as("币安恢复才 " + (i * 5) + " 秒，仍用 AllTick").isEqualTo("alltick");
        clock.advance(Duration.ofSeconds(5));
      }
    }
    assertThat(router.current("BTCUSD")).as("币安连续报价满 30 秒，切回").contains(new QuoteSource("binance", "primary"));
  }
}
