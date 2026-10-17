package com.falconx.lite.market.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;

import com.falconx.lite.market.kline.KlineService;
import com.falconx.lite.market.quote.QuoteProcessor;
import com.falconx.lite.market.quote.RawQuote;
import com.falconx.lite.notification.api.MailApi;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** 行情推送：真实启动服务，用 WebSocket 客户端连接（实际执行）。时钟固定在周三交易时段。 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class MarketPushTest {

  static final Instant NOW = Instant.parse("2026-10-14T10:00:00Z");

  @TestConfiguration
  static class FixedClock {
    @Bean
    @Primary
    Clock fixedClock() {
      return Clock.fixed(NOW, ZoneOffset.UTC);
    }
  }

  @LocalServerPort int port;
  @Autowired QuoteProcessor processor;
  @Autowired KlineService klines;
  @MockitoBean MailApi mail;

  final HttpClient http = HttpClient.newHttpClient();

  @SuppressWarnings("unchecked")
  String loginCookie() throws Exception {
    String email = "ws" + System.nanoTime() + "@example.com";
    post("/api/auth/email-code", "{\"email\":\"" + email + "\",\"purpose\":\"REGISTER\"}");
    ArgumentCaptor<Map<String, String>> p = ArgumentCaptor.forClass(Map.class);
    verify(mail, atLeastOnce()).send(eq(email), eq("EMAIL_CODE"), p.capture());
    HttpResponse<String> r = post("/api/auth/register", "{\"email\":\"" + email + "\",\"code\":\"" + p.getValue().get("code")
        + "\",\"password\":\"password123\",\"firstName\":\"A\",\"lastName\":\"B\",\"birthDate\":\"1990-05-01\",\"nationality\":\"CN\"}");
    String setCookie = r.headers().firstValue("set-cookie").orElseThrow();
    return setCookie.substring(0, setCookie.indexOf(';'));
  }

  HttpResponse<String> post(String path, String body) throws Exception {
    return http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
  }

  static class Collector implements WebSocket.Listener {
    final BlockingQueue<String> msgs = new LinkedBlockingQueue<>();
    final StringBuilder buf = new StringBuilder();

    @Override
    public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
      buf.append(data);
      if (last) {
        msgs.add(buf.toString());
        buf.setLength(0);
      }
      ws.request(1);
      return null;
    }

    String next(String contains) throws InterruptedException {
      long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
      while (System.nanoTime() < end) {
        String m = msgs.poll(200, TimeUnit.MILLISECONDS);
        if (m != null && m.contains(contains)) return m;
      }
      throw new AssertionError("5 秒内没有收到包含 " + contains + " 的消息");
    }
  }

  @Test
  void 未登录不能连接() {
    assertThatThrownBy(() -> http.newWebSocketBuilder().buildAsync(URI.create("ws://localhost:" + port + "/api/ws/market"), new Collector()).get(5, TimeUnit.SECONDS))
        .rootCause().hasMessageContaining("401");
  }

  @Test
  void 登录后收到报价推送和订阅的K线() throws Exception {
    String cookie = loginCookie();
    Collector c = new Collector();
    WebSocket ws = http.newWebSocketBuilder().header("Cookie", cookie).connectTimeout(Duration.ofSeconds(5))
        .buildAsync(URI.create("ws://localhost:" + port + "/api/ws/market"), c).get(5, TimeUnit.SECONDS);
    assertThat(c.next("\"type\":\"quotes\"")).as("连上后先推一次全部报价").isNotNull();

    processor.process(new RawQuote("NZDUSD", new BigDecimal("0.57010"), new BigDecimal("0.57030"), NOW));
    // 推送的是对客报价，含加点（V24：5 位小数，每边 10 点 = 0.00010）
    assertThat(c.next("\"symbol\":\"NZDUSD\"")).contains("\"bid\":\"0.57000\"").contains("\"ask\":\"0.57040\"");

    ws.sendText("{\"op\":\"subKline\",\"symbol\":\"NZDUSD\",\"tf\":\"1m\"}", true).get(5, TimeUnit.SECONDS);
    Thread.sleep(300);
    klines.accept("NZDUSD", new BigDecimal("0.57040"), NOW.plusSeconds(1));
    assertThat(c.next("\"type\":\"kline\"")).contains("\"tf\":\"1m\"").contains("\"close\":\"0.57040\"");
    ws.sendClose(WebSocket.NORMAL_CLOSURE, "").get(5, TimeUnit.SECONDS);
  }
}
