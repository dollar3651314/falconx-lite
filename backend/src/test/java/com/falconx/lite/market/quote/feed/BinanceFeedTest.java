package com.falconx.lite.market.quote.feed;

import static com.falconx.lite.market.quote.feed.FeedTestSupport.JSON;
import static com.falconx.lite.market.quote.feed.FeedTestSupport.WAIT;
import static com.falconx.lite.market.quote.feed.FeedTestSupport.await;
import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/**
 * 币安适配器（技术方案/v2-报价源接入.md 第 12 节）。不连真实服务：本地假服务器按官方文档
 * （https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md）和 2026-10-17 本机实连收到的样例发消息。
 */
class BinanceFeedTest {

  /** 2026-10-17 本机实连 data-stream.binance.vision 收到的现货样例（没有时间字段） */
  static final String SPOT_SAMPLE = "{\"stream\":\"btcusdt@bookTicker\",\"data\":{\"u\":101558387857,\"s\":\"BTCUSDT\",\"b\":\"81588.60000000\","
      + "\"B\":\"5.37792000\",\"a\":\"81588.61000000\",\"A\":\"3.98075000\"}}";
  /** 2026-10-17 本机握手 fstream.binance.com/public 收到的永续样例（有 E、T） */
  static final String FUTURES_SAMPLE = "{\"stream\":\"xauusdt@bookTicker\",\"data\":{\"e\":\"bookTicker\",\"u\":11843095950111,\"s\":\"XAUUSDT\","
      + "\"ps\":\"XAUUSDT\",\"b\":\"4170.53\",\"B\":\"41.412\",\"a\":\"4170.54\",\"A\":\"68.361\",\"T\":1792215450173,\"E\":1792215450174,\"st\":1}}";

  FakeWsServer server;
  FeedTestSupport.Recorder sink;
  BinanceFeed feed;
  SimpleMeterRegistry metrics;

  @BeforeEach
  void setUp() throws Exception {
    server = new FakeWsServer();
    sink = new FeedTestSupport.Recorder();
    metrics = new SimpleMeterRegistry();
    // LIST_SUBSCRIPTIONS 按文档回 {"result":[…],"id":n}
    server.onMessage = (c, m) -> {
      JsonNode n = JSON.readTree(m);
      if ("LIST_SUBSCRIPTIONS".equals(n.path("method").asString(""))) c.send("{\"result\":[\"btcusdt@bookTicker\"],\"id\":" + n.path("id").asLong() + "}");
    };
  }

  @AfterEach
  void tearDown() throws Exception {
    if (feed != null) feed.close();
    server.close();
  }

  QuoteFeedsProperties.Binance binance(boolean futures, int maxStreams, Duration maxAge) {
    return new QuoteFeedsProperties.Binance(true, server.baseUrl(), futures, server.url("/public"), Duration.ofMillis(200), maxStreams, maxAge);
  }

  BinanceFeed start(QuoteFeedsProperties.Binance b, Duration idle, Map<String, List<String>> codes) {
    feed = new BinanceFeed(FeedTestSupport.binanceProps(b, idle, Map.of()), codes, sink, JSON, metrics);
    feed.start();
    return feed;
  }

  @Test
  void 组合流写在URL里_流名小写_连上不发订阅消息_解析现货bookTicker没有时间用收到的时间() throws Exception {
    start(binance(false, 200, null), Duration.ofSeconds(30), Map.of("spot", List.of("BTCUSDT", "ETHUSDT")));
    FakeWsServer.Conn c = server.awaitConnection(1, WAIT);
    assertThat(c.path).isEqualTo("/stream");
    assertThat(c.query).isEqualTo("streams=btcusdt@bookTicker/ethusdt@bookTicker");
    assertThat(c.headers).as("不需要任何 key").doesNotContainKey("x-mbx-apikey");
    c.send(SPOT_SAMPLE);
    FeedTestSupport.Got g = sink.next();
    assertThat(g.feed()).isEqualTo("binance");
    assertThat(g.code()).isEqualTo("BTCUSDT");
    assertThat(g.bid()).isEqualByComparingTo("81588.60");
    assertThat(g.ask()).isEqualByComparingTo("81588.61");
    assertThat(g.time()).as("现货 bookTicker 没有时间字段，交给路由用收到的时间").isNull();
    // 第一条客户端消息是心跳，不是订阅
    String first = c.next(WAIT);
    assertThat(first).contains("LIST_SUBSCRIPTIONS").doesNotContain("SUBSCRIBE\"");
    assertThat(feed.status().getFirst().channel()).isEqualTo("spot");
    assertThat(metrics.get("fx.quote.feed.quotes").tag("feed", "binance").counter().count()).isEqualTo(1.0);
  }

  @Test
  void 心跳每次id递增_报错回应记下错误_价格为0或缺一边不当报价_单流格式也认() throws Exception {
    start(binance(false, 200, null), Duration.ofSeconds(30), Map.of("spot", List.of("BTCUSDT")));
    FakeWsServer.Conn c = server.awaitConnection(1, WAIT);
    long id1 = JSON.readTree(c.nextContaining("LIST_SUBSCRIPTIONS", WAIT)).path("id").asLong();
    long id2 = JSON.readTree(c.nextContaining("LIST_SUBSCRIPTIONS", WAIT)).path("id").asLong();
    assertThat(id2).isGreaterThan(id1);
    c.send("{\"code\":2,\"msg\":\"Invalid request: unknown method\",\"id\":9}");
    await("记下错误", () -> String.valueOf(feed.status().getFirst().lastError()).contains("Invalid request"));
    c.send("{\"stream\":\"btcusdt@bookTicker\",\"data\":{\"u\":1,\"s\":\"BTCUSDT\",\"b\":\"0.00000000\",\"B\":\"0\",\"a\":\"81588.61\",\"A\":\"1\"}}");
    c.send("{\"stream\":\"btcusdt@bookTicker\",\"data\":{\"u\":2,\"s\":\"BTCUSDT\",\"a\":\"81588.61\"}}");
    c.send("not json");
    assertThat(sink.none()).isNull();
    c.send("{\"u\":3,\"s\":\"BTCUSDT\",\"b\":\"81590.00\",\"B\":\"1\",\"a\":\"81590.01\",\"A\":\"1\"}");
    assertThat(sink.next().bid()).isEqualByComparingTo("81590.00");
  }

  @Test
  void 永续默认关闭_打开后走public路由_用撮合时间T() throws Exception {
    start(binance(false, 200, null), Duration.ofSeconds(30), Map.of("futures", List.of("XAUUSDT")));
    assertThat(feed.status()).as("futures-enabled=false 时即使给了代码也不连").isEmpty();
    feed.close();
    start(binance(true, 200, null), Duration.ofSeconds(30), Map.of("spot", List.of("BTCUSDT"), "futures", List.of("XAUUSDT")));
    FakeWsServer.Conn f = server.awaitConnection("/public/stream", 1, WAIT);
    assertThat(f.query).isEqualTo("streams=xauusdt@bookTicker");
    f.send(FUTURES_SAMPLE);
    FeedTestSupport.Got g = sink.next();
    assertThat(g.code()).isEqualTo("XAUUSDT");
    assertThat(g.bid()).isEqualByComparingTo("4170.53");
    assertThat(g.time()).isEqualTo(Instant.ofEpochMilli(1792215450173L));
    assertThat(feed.status()).extracting(QuoteFeed.ChannelStatus::channel).containsExactly("spot", "futures");
  }

  @Test
  void 超过每连接流数上限时分成多条连接() throws Exception {
    start(binance(false, 3, null), Duration.ofSeconds(30), Map.of("spot", List.of("A1USDT", "A2USDT", "A3USDT", "A4USDT", "A5USDT", "A6USDT", "A7USDT")));
    assertThat(feed.status()).extracting(QuoteFeed.ChannelStatus::channel).containsExactly("spot-1", "spot-2", "spot-3");
    assertThat(feed.status()).extracting(QuoteFeed.ChannelStatus::symbols).containsExactly(3, 3, 1);
    server.awaitConnection(3, WAIT);
    assertThat(server.connections()).extracting(c -> c.query).containsExactlyInAnyOrder("streams=a1usdt@bookTicker/a2usdt@bookTicker/a3usdt@bookTicker",
        "streams=a4usdt@bookTicker/a5usdt@bookTicker/a6usdt@bookTicker", "streams=a7usdt@bookTicker");
  }

  @Test
  void 服务器的ping自动回pong_只有ping没有数据也不算空闲() throws Exception {
    server.onMessage = (c, m) -> {}; // 心跳不回应，只靠服务器的 ping 维持
    start(binance(false, 200, null), Duration.ofMillis(600), Map.of("spot", List.of("BTCUSDT")));
    FakeWsServer.Conn c = server.awaitConnection(1, WAIT);
    for (int i = 0; i < 15; i++) {
      c.ping("p" + i);
      Thread.sleep(100);
    }
    assertThat(c.pongs.poll(WAIT.toMillis(), java.util.concurrent.TimeUnit.MILLISECONDS)).as("pong 带回 ping 的内容").startsWith("p");
    assertThat(server.connections()).as("1.5 秒里一直有 ping，空闲 0.6 秒的检测没有断开").hasSize(1);
    assertThat(feed.status().getFirst().state()).isEqualTo(QuoteFeed.State.CONNECTED);
  }

  @Test
  void 服务器24小时到点关闭连接后马上重连_同一个URL等于重新订阅() throws Exception {
    start(binance(false, 200, null), Duration.ofSeconds(30), Map.of("spot", List.of("BTCUSDT", "ETHUSDT")));
    FakeWsServer.Conn first = server.awaitConnection(1, WAIT);
    first.send(SPOT_SAMPLE);
    sink.next();
    long t0 = System.nanoTime();
    first.closeNormally(1000, "");
    FakeWsServer.Conn second = server.awaitConnection(2, WAIT);
    long ms = (System.nanoTime() - t0) / 1_000_000;
    assertThat(ms).as("之前正常过，退避已清零，第一次重连 50 毫秒起").isLessThan(3000);
    assertThat(second.query).isEqualTo(first.query);
    second.send(SPOT_SAMPLE.replace("81588.60000000", "81600.00"));
    assertThat(sink.next().bid()).isEqualByComparingTo("81600.00");
    assertThat(feed.status().getFirst().reconnects()).isEqualTo(1);
    assertThat(feed.status().getFirst().lastError()).contains("服务器关闭连接（1000");
  }

  @Test
  void 连接用满最长时间主动换新连接_旧连接关掉() throws Exception {
    start(binance(false, 200, Duration.ofMillis(500)), Duration.ofSeconds(30), Map.of("spot", List.of("BTCUSDT")));
    FakeWsServer.Conn first = server.awaitConnection(1, WAIT);
    FakeWsServer.Conn second = server.awaitConnection(2, WAIT);
    assertThat(second.query).isEqualTo(first.query);
    await("旧连接关掉", () -> first.closed);
    await("新连接可用", () -> feed.status().getFirst().state() == QuoteFeed.State.CONNECTED);
    second.send(SPOT_SAMPLE);
    assertThat(sink.next().code()).isEqualTo("BTCUSDT");
    assertThat(feed.status().getFirst().reconnects()).isGreaterThanOrEqualTo(1);
  }

  @Test
  void 握手被拒绝451时记下状态并退避重试() throws Exception {
    server.rejectStatus = 451;
    start(binance(false, 200, null), Duration.ofSeconds(30), Map.of("spot", List.of("BTCUSDT")));
    await("被拒绝至少两次（在退避重试）", () -> server.handshakes >= 2);
    assertThat(feed.status().getFirst().lastError()).contains("451");
    server.rejectStatus = 0;
    server.awaitConnection(1, WAIT);
    await("连上", () -> feed.status().getFirst().state() == QuoteFeed.State.CONNECTED);
  }

  @Test
  void 突然断网后退避重连() throws Exception {
    start(binance(false, 200, null), Duration.ofSeconds(30), Map.of("spot", List.of("BTCUSDT")));
    FakeWsServer.Conn first = server.awaitConnection(1, WAIT);
    first.kill();
    FakeWsServer.Conn second = server.awaitConnection(2, WAIT);
    second.send(SPOT_SAMPLE);
    assertThat(sink.next().code()).isEqualTo("BTCUSDT");
  }
}
