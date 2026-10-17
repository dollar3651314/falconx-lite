package com.falconx.lite.market.quote;

import static com.falconx.lite.market.quote.feed.FakeWsServerAccess.FAKE_TOKEN;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.quote.feed.FakeWsServerAccess;
import com.falconx.lite.market.quote.feed.QuoteFeed;
import com.falconx.lite.market.quote.feed.QuoteFeeds;
import com.falconx.lite.notification.api.MailApi;
import com.falconx.lite.support.FixedClockConfig;
import java.math.BigDecimal;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 官网公开行情的开关 {@code FX_PUBLIC_QUOTES_SOURCE=live}（技术方案/v2-报价源接入.md 第 6 节，拿到展示授权以后才打开）：
 * 官网取交易报价（真实源的价格），{@code sample} 为 false。默认（simulated）的情况见 {@link QuoteFeedsWiringTest}。只配 AllTick 的假 token。
 */
@SpringBootTest(properties = {"falconx.market.source=simulated", "falconx.market.simulated-interval=1h", "falconx.market.public-quotes.symbols=XAUUSD",
    "falconx.market.public-quotes.source=live"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(FixedClockConfig.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PublicQuotesLiveTest {

  static final FakeWsServerAccess server = FakeWsServerAccess.start();

  @DynamicPropertySource
  static void feeds(DynamicPropertyRegistry r) {
    r.add("falconx.market.feeds.alltick.token", () -> FAKE_TOKEN);
    r.add("falconx.market.feeds.alltick.fx-url", () -> server.url("/quote-b-ws-api"));
    r.add("falconx.market.feeds.alltick.stock-url", () -> server.url("/quote-stock-b-ws-api"));
    r.add("falconx.market.feeds.alltick.channel-gap", () -> "100ms");
  }

  @AfterAll
  static void stop() {
    server.close();
  }

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired QuoteProcessor processor;
  @Autowired QuoteFeeds feeds;
  @Autowired SimulatedQuoteSource simulated;
  @MockitoBean MailApi mail;

  @Test
  void 打开live后官网显示真实源的价格_不再标示例行情() throws Exception {
    QuoteFeedsWiringTest.await("AllTick 两条连接都订阅了",
        () -> feeds.feeds().size() == 1 && feeds.feeds().getFirst().status().stream().allMatch(s -> s.state() == QuoteFeed.State.CONNECTED)
            && server.subscribed() >= 2);
    server.allTickDepth("GOLD", "4126.50", "4126.90");
    QuoteFeedsWiringTest.await("XAUUSD 有交易报价", () -> processor.latest("XAUUSD").filter(MarketQuote::executable).isPresent());
    simulated.moveTo("XAUUSD", new BigDecimal("4197.70"));
    JsonNode body = json.readTree(mvc.perform(get("/api/public/quotes")).andReturn().getResponse().getContentAsString());
    assertThat(body.get("sample").asBoolean()).isFalse();
    // AllTick 的 4126.50 − 加点 0.10（V24）
    assertThat(body.get("items").get(0).get("bid").asString()).isEqualTo("4126.40");
  }
}
