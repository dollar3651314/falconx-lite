package com.falconx.lite.market.quote.feed;

import static com.falconx.lite.market.quote.feed.FeedTestSupport.FAKE_TOKEN;
import static com.falconx.lite.market.quote.feed.FeedTestSupport.JSON;
import static com.falconx.lite.market.quote.feed.FeedTestSupport.WAIT;
import static com.falconx.lite.market.quote.feed.FeedTestSupport.await;
import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/**
 * iTick 适配器（技术方案/v2-报价源接入.md 第 1.2、9 节）。不连真实服务：本地假服务器按官方文档（https://docs.itick.org/en/websocket/forex）
 * 的消息格式回应：连上发 "Connected Successfully"，再发鉴权结果；订阅回 subscribe Successfully；ping 回 pong。
 */
class ITickFeedTest {

  FakeWsServer server;
  FeedTestSupport.Recorder sink;
  ITickFeed feed;

  @BeforeEach
  void setUp() throws Exception {
    server = new FakeWsServer();
    sink = new FeedTestSupport.Recorder();
    server.onConnect = c -> {
      c.send("{\"code\":1,\"msg\":\"Connected Successfully\"}");
      boolean ok = FAKE_TOKEN.equals(c.headers.get("token"));
      c.send(ok ? "{\"code\":1,\"resAc\":\"auth\",\"msg\":\"authenticated\"}" : "{\"code\":0,\"resAc\":\"auth\",\"msg\":\"auth failed\"}");
      if (!ok) c.kill();
    };
    server.onMessage = (c, m) -> {
      JsonNode n = JSON.readTree(m);
      switch (n.path("ac").asString()) {
        case "subscribe" -> c.send("{\"code\":1,\"resAc\":\"subscribe\",\"msg\":\"subscribe Successfully\"}");
        case "ping" -> c.send("{\"resAc\":\"pong\",\"data\":{\"params\":\"" + n.path("params").asString() + "\"}}");
        default -> {}
      }
    };
  }

  @AfterEach
  void tearDown() throws Exception {
    if (feed != null) feed.close();
    server.close();
  }

  void start(Map<String, List<String>> codes) {
    QuoteFeedsProperties p = FeedTestSupport.props(server.url("/a"), server.url("/b"), server.baseUrl(), Duration.ofSeconds(30), Map.of());
    feed = new ITickFeed(p, codes, sink, JSON, new SimpleMeterRegistry());
    feed.start();
  }

  static String depth(String s, String r, String bid, String ask) {
    return "{\"code\":1,\"data\":{\"s\":\"" + s + "\",\"r\":\"" + r + "\",\"a\":[{\"po\":1,\"p\":" + ask + ",\"v\":10.6,\"o\":10.6}],\"b\":[{\"po\":1,\"p\":" + bid
        + ",\"v\":20.9,\"o\":20.9}],\"type\":\"depth\"}}";
  }

  @Test
  void token在请求头里_鉴权成功后订阅depth_解析买卖价() throws Exception {
    start(Map.of("forex", List.of("EURUSD$GB", "XAUUSD$GB")));
    FakeWsServer.Conn c = server.awaitConnection(1, WAIT);
    assertThat(c.path).isEqualTo("/forex");
    assertThat(c.query).as("token 不在 URL 里").isEmpty();
    assertThat(c.headers.get("token")).isEqualTo(FAKE_TOKEN);
    JsonNode sub = JSON.readTree(c.nextContaining("subscribe", WAIT));
    assertThat(sub.path("params").asString()).isEqualTo("EURUSD$GB,XAUUSD$GB");
    assertThat(sub.path("types").asString()).isEqualTo("depth");

    c.send(depth("XAUUSD", "GB", "4197.70", "4198.11"));
    FeedTestSupport.Got g = sink.next();
    assertThat(g.feed()).isEqualTo("itick");
    assertThat(g.code()).isEqualTo("XAUUSD$GB");
    assertThat(g.bid()).isEqualByComparingTo("4197.70");
    assertThat(g.ask()).isEqualByComparingTo("4198.11");
    assertThat(g.time()).as("depth 没有时间字段，用收到的时间").isNull();
  }

  @Test
  void 多档时取最优价_tick和quote没有买卖价不当报价() throws Exception {
    start(Map.of("crypto", List.of("BTCUSDT$BA")));
    FakeWsServer.Conn c = server.awaitConnection(1, WAIT);
    c.nextContaining("subscribe", WAIT);
    c.send("{\"code\":1,\"data\":{\"s\":\"BTCUSDT\",\"r\":\"BA\",\"ld\":81567.5,\"v\":1,\"t\":1792000000000,\"type\":\"tick\"}}");
    c.send("{\"code\":1,\"data\":{\"s\":\"BTCUSDT\",\"r\":\"BA\",\"ld\":81567.5,\"o\":1,\"h\":1,\"l\":1,\"t\":1792000000000,\"v\":1,\"tu\":1,\"type\":\"quote\"}}");
    assertThat(sink.none()).isNull();
    c.send("{\"code\":1,\"data\":{\"s\":\"BTCUSDT\",\"r\":\"BA\",\"a\":[{\"po\":2,\"p\":81570.1},{\"po\":1,\"p\":81568.0}],"
        + "\"b\":[{\"po\":2,\"p\":81560.0},{\"po\":1,\"p\":81567.5}],\"type\":\"depth\"}}");
    FeedTestSupport.Got g = sink.next();
    assertThat(g.bid()).isEqualByComparingTo("81567.5");
    assertThat(g.ask()).isEqualByComparingTo("81568.0");
  }

  @Test
  void 定时ping_服务器回pong() throws Exception {
    start(Map.of("forex", List.of("EURUSD$GB")));
    FakeWsServer.Conn c = server.awaitConnection(1, WAIT);
    JsonNode ping = JSON.readTree(c.nextContaining("ping", WAIT));
    assertThat(ping.path("params").asString()).matches("\\d{13}");
  }

  @Test
  void 按品类分连接() throws Exception {
    start(Map.of("forex", List.of("EURUSD$GB"), "indices", List.of("US30USD$GB"), "crypto", List.of("BTCUSDT$BA"), "stock", List.of("AAPL$US")));
    for (String path : List.of("/forex", "/indices", "/crypto", "/stock")) server.awaitConnection(path, 1, WAIT);
    FakeWsServer.Conn stock = server.awaitConnection("/stock", 1, WAIT);
    assertThat(stock.nextContaining("subscribe", WAIT)).contains("AAPL$US").doesNotContain("EURUSD");
    stock.send("{\"code\":1,\"data\":{\"s\":\"AAPL\",\"r\":\"US\",\"e\":\"NASDAQ\",\"a\":[{\"po\":1,\"p\":225.01}],\"b\":[{\"po\":1,\"p\":225}],\"type\":\"depth\"}}");
    assertThat(sink.next().code()).isEqualTo("AAPL$US");
    assertThat(feed.status()).hasSize(4);
  }

  @Test
  void 鉴权失败被断开后退避重连_token改对之前一直重试() throws Exception {
    server.onConnect = c -> {
      c.send("{\"code\":1,\"msg\":\"Connected Successfully\"}");
      c.send("{\"code\":0,\"resAc\":\"auth\",\"msg\":\"auth failed\"}");
      try {
        Thread.sleep(50);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      c.kill();
    };
    start(Map.of("forex", List.of("EURUSD$GB")));
    server.awaitConnection(3, WAIT);
    await("记下鉴权失败或断开", () -> feed.status().getFirst().lastError() != null);
    assertThat(feed.status().getFirst().reconnects()).isGreaterThanOrEqualTo(2);
    assertThat(String.valueOf(feed.status().getFirst().lastError())).doesNotContain(FAKE_TOKEN);
  }

  @Test
  void 断开后重连并重新订阅() throws Exception {
    start(Map.of("forex", List.of("EURUSD$GB")));
    FakeWsServer.Conn first = server.awaitConnection(1, WAIT);
    first.nextContaining("subscribe", WAIT);
    first.kill();
    FakeWsServer.Conn second = server.awaitConnection(2, WAIT);
    assertThat(second.nextContaining("subscribe", WAIT)).contains("EURUSD$GB");
    second.send(depth("EURUSD", "GB", "1.12501", "1.12512"));
    assertThat(sink.next().code()).isEqualTo("EURUSD$GB");
  }

  @Test
  void 没有鉴权回应时5秒后也订阅() throws Exception {
    server.onConnect = c -> c.send("{\"code\":1,\"msg\":\"Connected Successfully\"}");
    start(Map.of("forex", List.of("EURUSD$GB")));
    FakeWsServer.Conn c = server.awaitConnection(1, WAIT);
    assertThat(c.nextContaining("subscribe", Duration.ofSeconds(8))).contains("EURUSD$GB");
  }
}
