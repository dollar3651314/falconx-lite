package com.falconx.lite.trading.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;

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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** 交易推送：真实启动服务，用 WebSocket 客户端连接（实际执行）。下单、止盈触发后收到和客户端一致的事件（T6）。 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class TradingPushTest {

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
  @Autowired MatchingEngine engine;
  @Autowired JdbcTemplate jdbc;
  @Autowired com.falconx.lite.trading.api.LedgerApi ledger;
  @MockitoBean MailApi mail;

  final HttpClient http = HttpClient.newHttpClient();

  HttpResponse<String> send(String method, String path, String body, String cookie) throws Exception {
    HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).header("Content-Type", "application/json")
        .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
    if (cookie != null) b.header("Cookie", cookie);
    return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
  }

  @SuppressWarnings("unchecked")
  String loginWithDeposit() throws Exception {
    String email = "tp" + System.nanoTime() + "@example.com";
    send("POST", "/api/auth/email-code", "{\"email\":\"" + email + "\",\"purpose\":\"REGISTER\"}", null);
    ArgumentCaptor<Map<String, String>> p = ArgumentCaptor.forClass(Map.class);
    verify(mail, atLeastOnce()).send(eq(email), eq("EMAIL_CODE"), p.capture());
    HttpResponse<String> r = send("POST", "/api/auth/register", "{\"email\":\"" + email + "\",\"code\":\"" + p.getValue().get("code")
        + "\",\"password\":\"password123\",\"firstName\":\"A\",\"lastName\":\"B\",\"birthDate\":\"1990-05-01\",\"nationality\":\"CN\"}", null);
    long uid = jdbc.queryForObject("SELECT id FROM account_user WHERE email = ?", Long.class, email);
    ledger.apply(new com.falconx.lite.trading.api.LedgerCommand(uid, com.falconx.lite.trading.api.Bucket.BALANCE, new BigDecimal("1000"),
        com.falconx.lite.trading.api.LedgerEntryType.DEPOSIT, "TEST", "dep-" + uid, "测试入金"));
    String setCookie = r.headers().firstValue("set-cookie").orElseThrow();
    return setCookie.substring(0, setCookie.indexOf(';'));
  }

  static class Collector implements WebSocket.Listener {
    final BlockingQueue<String> msgs = new LinkedBlockingQueue<>();
    final java.util.List<String> seen = new java.util.concurrent.CopyOnWriteArrayList<>();
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
        if (m == null) continue;
        seen.add(m);
        if (m.contains(contains)) return m;
      }
      throw new AssertionError("5 秒内没有收到包含 " + contains + " 的消息");
    }
  }

  @Test
  void 未登录不能连接() {
    assertThatThrownBy(() -> http.newWebSocketBuilder().buildAsync(URI.create("ws://localhost:" + port + "/api/ws/trading"), new Collector()).get(5, TimeUnit.SECONDS))
        .rootCause().hasMessageContaining("401");
  }

  @Test
  void 下单和止盈触发时推送事件_只推给本人() throws Exception {
    engine.setEnabled(true);
    try {
      processor.process(new RawQuote("XAUUSD", new BigDecimal("4126.35"), new BigDecimal("4126.75"), NOW));
      String me = loginWithDeposit();
      String other = loginWithDeposit();
      Collector mine = new Collector();
      Collector theirs = new Collector();
      WebSocket ws1 = http.newWebSocketBuilder().header("Cookie", me).buildAsync(URI.create("ws://localhost:" + port + "/api/ws/trading"), mine).get(5, TimeUnit.SECONDS);
      WebSocket ws2 = http.newWebSocketBuilder().header("Cookie", other).buildAsync(URI.create("ws://localhost:" + port + "/api/ws/trading"), theirs).get(5, TimeUnit.SECONDS);

      HttpResponse<String> r = send("POST", "/api/trading/orders",
          "{\"symbol\":\"XAUUSD\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.10\",\"leverage\":100,\"takeProfit\":\"4135.00\",\"clientOrderId\":\"push-1\"}", me);
      assertThat(r.statusCode()).isEqualTo(200);
      // 客户买价 = 原始 4126.75 + 加点 0.10（V24）
      assertThat(mine.next("\"type\":\"trade\",\"kind\":\"fill\"")).contains("\"symbol\":\"XAUUSD\"").contains("\"price\":\"4126.85\"");
      assertThat(mine.seen).as("成交前先推 positions、account").anyMatch(m -> m.contains("\"type\":\"positions\"")).anyMatch(m -> m.contains("\"type\":\"account\""));

      // 客户卖价 4135.60 − 0.10 = 4135.50 到止盈；盈亏 (4135.50 − 4126.85) × 10 = 86.5
      processor.process(new RawQuote("XAUUSD", new BigDecimal("4135.60"), new BigDecimal("4136.00"), NOW));
      assertThat(mine.next("\"kind\":\"tp\"")).contains("\"pnl\":\"86.5\"").contains("\"price\":\"4135.50\"");
      // 站内信实时推送（{"type":"notification","item":{…}}，和客户端 ServerEvent 一致），按客户的语言（默认中文）
      // 站内信在平仓事务提交时推出，比 trade 事件早
      // 体验优化 1021 UX-9：市价开仓先有一条"开仓成功"站内信（只发站内信）
      assertThat(mine.seen).filteredOn(m -> m.contains("\"type\":\"notification\"")).hasSize(2).first().asString().contains("\"kind\":\"fill\"").contains("\"title\":\"开仓成功\"");
      assertThat(mine.seen).filteredOn(m -> m.contains("\"type\":\"notification\"")).last().asString().contains("\"kind\":\"tpsl\"").contains("\"title\":\"止盈止损已触发\"").contains("\"read\":false");
      assertThat(theirs.msgs.poll(300, TimeUnit.MILLISECONDS)).as("别人收不到").isNull();
      ws1.sendClose(WebSocket.NORMAL_CLOSURE, "").get(5, TimeUnit.SECONDS);
      ws2.sendClose(WebSocket.NORMAL_CLOSURE, "").get(5, TimeUnit.SECONDS);
    } finally {
      engine.setEnabled(false);
      processor.process(new RawQuote("XAUUSD", new BigDecimal("4126.35"), new BigDecimal("4126.75"), NOW));
    }
  }
}
