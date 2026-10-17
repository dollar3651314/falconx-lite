package com.falconx.lite.market.quote.feed;

import static com.falconx.lite.market.quote.feed.FeedTestSupport.FAKE_TOKEN;
import static com.falconx.lite.market.quote.feed.FeedTestSupport.JSON;
import static com.falconx.lite.market.quote.feed.FeedTestSupport.WAIT;
import static com.falconx.lite.market.quote.feed.FeedTestSupport.await;
import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/**
 * AllTick 适配器（技术方案/v2-报价源接入.md 第 1.1、9 节）。不连真实服务：本地假服务器按官方文档的消息格式
 * （https://alltick.co/apis/en/websocket/depth-subscription）回应和推送。
 */
class AllTickFeedTest {

  FakeWsServer server;
  FeedTestSupport.Recorder sink;
  AllTickFeed feed;
  SimpleMeterRegistry metrics;

  @BeforeEach
  void setUp() throws Exception {
    server = new FakeWsServer();
    sink = new FeedTestSupport.Recorder();
    metrics = new SimpleMeterRegistry();
    // 收到订阅就回 22003 成功（和真实服务一样）
    server.onMessage = (c, m) -> {
      JsonNode n = JSON.readTree(m);
      if (n.path("cmd_id").asInt() == 22002) c.send("{\"ret\":200,\"msg\":\"ok\",\"cmd_id\":22003,\"seq_id\":" + n.path("seq_id").asLong() + ",\"trace\":\"x\",\"data\":{}}");
      if (n.path("cmd_id").asInt() == 22000) c.send("{\"ret\":200,\"msg\":\"ok\",\"cmd_id\":22001,\"seq_id\":1,\"trace\":\"x\",\"data\":{}}");
    };
  }

  @AfterEach
  void tearDown() throws Exception {
    if (feed != null) feed.close();
    server.close();
  }

  AllTickFeed start(Duration idle, Map<String, List<String>> codes) {
    QuoteFeedsProperties p = FeedTestSupport.props(server.url("/quote-b-ws-api"), server.url("/quote-stock-b-ws-api"), server.baseUrl(), idle, Map.of());
    feed = new AllTickFeed(p, codes, sink, JSON, metrics);
    feed.start();
    return feed;
  }

  static String depth(String code, String bid, String ask, long tickTime) {
    return "{\"cmd_id\":22999,\"data\":{\"code\":\"" + code + "\",\"seq\":1,\"tick_time\":" + tickTime + ",\"bids\":[{\"price\":\"" + bid
        + "\",\"volume\":\"1\"}],\"asks\":[{\"price\":\"" + ask + "\",\"volume\":\"1\"}]}}";
  }

  @Test
  void token在URL参数里_订阅22002一档完整清单_解析22999的买卖价和毫秒时间() throws Exception {
    start(Duration.ofSeconds(30), Map.of("fx", List.of("EURUSD", "GOLD")));
    FakeWsServer.Conn c = server.awaitConnection(1, WAIT);
    assertThat(c.path).isEqualTo("/quote-b-ws-api");
    assertThat(c.query).isEqualTo("token=" + FAKE_TOKEN);
    JsonNode sub = JSON.readTree(c.nextContaining("22002", WAIT));
    assertThat(sub.path("trace").asString()).isNotBlank();
    List<String> codes = new ArrayList<>();
    for (JsonNode s : sub.path("data").path("symbol_list")) {
      codes.add(s.path("code").asString());
      assertThat(s.path("depth_level").asInt()).isEqualTo(1);
    }
    assertThat(codes).containsExactly("EURUSD", "GOLD");

    c.send(depth("EURUSD", "1.12501", "1.12512", 1_792_000_000_123L));
    FeedTestSupport.Got g = sink.next();
    assertThat(g.feed()).isEqualTo("alltick");
    assertThat(g.code()).isEqualTo("EURUSD");
    assertThat(g.bid()).isEqualByComparingTo("1.12501");
    assertThat(g.ask()).isEqualByComparingTo("1.12512");
    assertThat(g.time()).isEqualTo(Instant.ofEpochMilli(1_792_000_000_123L));
    assertThat(feed.status().getFirst().state()).isEqualTo(QuoteFeed.State.CONNECTED);
    assertThat(metrics.get("fx.quote.feed.quotes").counter().count()).isEqualTo(1.0);
    assertThat(metrics.get("fx.quote.feed.connected").tag("channel", "fx").gauge().value()).isEqualTo(1.0);
  }

  @Test
  void 秒级时间也认_只有一边盘口和成交价推送22998不当报价() throws Exception {
    start(Duration.ofSeconds(30), Map.of("fx", List.of("GOLD")));
    FakeWsServer.Conn c = server.awaitConnection(1, WAIT);
    c.nextContaining("22002", WAIT);
    // 文档示例里 tick_time 是秒
    c.send(depth("GOLD", "4197.70", "4198.11", 1_792_000_000L));
    assertThat(sink.next().time()).isEqualTo(Instant.ofEpochSecond(1_792_000_000L));
    // 一边为空（涨跌停、没有盘口）
    c.send("{\"cmd_id\":22999,\"data\":{\"code\":\"GOLD\",\"seq\":2,\"tick_time\":1792000001000,\"bids\":[{\"price\":\"4197.7\"}],\"asks\":[]}}");
    // 成交价：没有买卖价
    c.send("{\"cmd_id\":22998,\"data\":{\"code\":\"GOLD\",\"seq\":3,\"tick_time\":1792000001000,\"price\":\"4197.9\",\"volume\":\"1\",\"turnover\":\"1\","
        + "\"trade_direction\":1}}");
    // 看不懂的消息不影响后面的
    c.send("not json");
    assertThat(sink.none()).isNull();
    c.send(depth("GOLD", "4197.80", "4198.20", 1_792_000_002_000L));
    assertThat(sink.next().bid()).isEqualByComparingTo("4197.80");
  }

  @Test
  void 每隔心跳间隔发22000() throws Exception {
    start(Duration.ofSeconds(30), Map.of("fx", List.of("EURUSD")));
    FakeWsServer.Conn c = server.awaitConnection(1, WAIT);
    JsonNode hb = JSON.readTree(c.nextContaining("22000", WAIT));
    assertThat(hb.path("cmd_id").asInt()).isEqualTo(22000);
    assertThat(hb.has("data")).isTrue();
    JsonNode hb2 = JSON.readTree(c.nextContaining("22000", WAIT));
    assertThat(hb2.path("trace").asString()).as("trace 每次不同").isNotEqualTo(hb.path("trace").asString());
  }

  @Test
  void 服务器断开后退避重连_重连后重新订阅() throws Exception {
    start(Duration.ofSeconds(30), Map.of("fx", List.of("EURUSD", "USDJPY")));
    FakeWsServer.Conn first = server.awaitConnection(1, WAIT);
    first.nextContaining("22002", WAIT);
    first.kill();
    FakeWsServer.Conn second = server.awaitConnection(2, WAIT);
    String sub = second.nextContaining("22002", WAIT);
    assertThat(sub).as("重连后重新订阅完整清单").contains("EURUSD").contains("USDJPY");
    second.send(depth("USDJPY", "157.915", "157.930", 1_792_000_000_000L));
    assertThat(sink.next().code()).isEqualTo("USDJPY");
    assertThat(feed.status().getFirst().reconnects()).isGreaterThanOrEqualTo(1);
    assertThat(metrics.get("fx.quote.feed.reconnects").counter().count()).isGreaterThanOrEqualTo(1.0);
  }

  @Test
  void 握手被拒绝时记下HTTP状态_错误里没有token_服务恢复后连上() throws Exception {
    server.rejectStatus = 401;
    start(Duration.ofSeconds(30), Map.of("fx", List.of("EURUSD")));
    await("被拒绝至少两次（在退避重试）", () -> server.handshakes >= 2);
    QuoteFeed.ChannelStatus st = feed.status().getFirst();
    assertThat(st.state()).isNotEqualTo(QuoteFeed.State.CONNECTED);
    assertThat(st.lastError()).contains("401").doesNotContain(FAKE_TOKEN);
    server.rejectStatus = 0;
    FakeWsServer.Conn c = server.awaitConnection(1, WAIT);
    c.nextContaining("22002", WAIT);
    await("连上", () -> feed.status().getFirst().state() == QuoteFeed.State.CONNECTED);
  }

  @Test
  void 订阅被拒绝时记下错误码() throws Exception {
    server.onMessage = (c, m) -> {
      if (m.contains("22002")) c.send("{\"ret\":600,\"msg\":\"code invalid\",\"cmd_id\":22003,\"seq_id\":1,\"trace\":\"x\",\"data\":{}}");
    };
    start(Duration.ofSeconds(30), Map.of("fx", List.of("NOPE")));
    server.awaitConnection(1, WAIT);
    await("记下 600", () -> String.valueOf(feed.status().getFirst().lastError()).contains("600"));
  }

  @Test
  void 长时间没有任何消息就断开重连() throws Exception {
    server.onMessage = (c, m) -> {}; // 什么都不回（连接在、但不推数据）
    start(Duration.ofMillis(500), Map.of("fx", List.of("EURUSD")));
    server.awaitConnection(1, WAIT);
    server.awaitConnection(2, WAIT);
    assertThat(feed.status().getFirst().lastError()).contains("没有收到任何消息");
  }

  @Test
  void 外汇和美股是两条连接_股票连接晚一个间隔才开始() throws Exception {
    start(Duration.ofSeconds(30), Map.of("fx", List.of("EURUSD"), "stock", List.of("AAPL.US")));
    FakeWsServer.Conn fx = server.awaitConnection("/quote-b-ws-api", 1, WAIT);
    FakeWsServer.Conn stock = server.awaitConnection("/quote-stock-b-ws-api", 1, WAIT);
    assertThat(stock.query).isEqualTo("token=" + FAKE_TOKEN);
    assertThat(stock.nextContaining("22002", WAIT)).contains("AAPL.US").doesNotContain("EURUSD");
    assertThat(fx.nextContaining("22002", WAIT)).contains("EURUSD").doesNotContain("AAPL");
    stock.send(depth("AAPL.US", "344.92", "345.00", 1_792_000_000_000L));
    FeedTestSupport.Got g = sink.next();
    assertThat(g.code()).isEqualTo("AAPL.US");
    assertThat(g.ask()).isEqualByComparingTo(new BigDecimal("345.00"));
  }

  @Test
  void 退避时间翻倍_有上限() {
    QuoteFeedsProperties p = FeedTestSupport.props("ws://127.0.0.1:1/a", "ws://127.0.0.1:1/b", "ws://127.0.0.1:1", Duration.ofSeconds(30), Map.of());
    feed = new AllTickFeed(p, Map.of("fx", List.of("EURUSD")), sink, JSON, metrics);
    assertThat(feed.backoffMillis(0)).isBetween(50L, 60L);
    assertThat(feed.backoffMillis(1)).isBetween(100L, 120L);
    assertThat(feed.backoffMillis(2)).isBetween(200L, 240L);
    assertThat(feed.backoffMillis(10)).isBetween(400L, 480L);
    assertThat(feed.backoffMillis(1000)).isBetween(400L, 480L);
  }
}
