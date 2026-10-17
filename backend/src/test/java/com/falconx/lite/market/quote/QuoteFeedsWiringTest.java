package com.falconx.lite.market.quote;

import static com.falconx.lite.market.quote.feed.FakeWsServerAccess.FAKE_TOKEN;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.falconx.lite.common.health.AlertCheck;
import com.falconx.lite.market.api.MarketAdminApi;
import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.api.QuoteStatus;
import com.falconx.lite.market.quote.feed.FakeWsServerAccess;
import com.falconx.lite.market.quote.feed.QuoteFeed;
import com.falconx.lite.market.quote.feed.QuoteFeeds;
import com.falconx.lite.market.quote.feed.QuoteRouter;
import com.falconx.lite.notification.api.MailApi;
import com.falconx.lite.support.FixedClockConfig;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
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
 * 报价源接入的整条链路（技术方案/v2-报价源接入.md 第 9 节），用真实的 MySQL 和 Redis（C37），<b>不连真实服务</b>：
 * 两家都配上假 token、地址指向测试进程里的本地假服务器（按两家文档的消息格式回应）。时钟固定在 2026-10-14（周三）10:00 UTC，外汇开市。
 * 检查：真实报价进入交易链路、后台显示报价源、交叉校验暂停开仓（报价照常用主源）、告警项出现、<b>官网接口默认仍是模拟价</b>。
 * 模拟源（每小时才走一步）只在测试里手动推（{@link SimulatedQuoteSource#moveTo}）。
 */
@SpringBootTest(properties = {"falconx.market.source=simulated", "falconx.market.simulated-interval=1h",
    "falconx.market.public-quotes.symbols=XAUUSD,EURUSD,USDCAD"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(FixedClockConfig.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class QuoteFeedsWiringTest {

  static final FakeWsServerAccess server = FakeWsServerAccess.start();

  @DynamicPropertySource
  static void feeds(DynamicPropertyRegistry r) {
    r.add("falconx.market.feeds.alltick.token", () -> FAKE_TOKEN);
    r.add("falconx.market.feeds.alltick.fx-url", () -> server.url("/quote-b-ws-api"));
    r.add("falconx.market.feeds.alltick.stock-url", () -> server.url("/quote-stock-b-ws-api"));
    r.add("falconx.market.feeds.alltick.channel-gap", () -> "100ms");
    r.add("falconx.market.feeds.itick.token", () -> FAKE_TOKEN);
    r.add("falconx.market.feeds.itick.url", server::baseUrl);
    r.add("falconx.market.feeds.reconnect-initial", () -> "100ms");
  }

  @AfterAll
  static void stop() {
    server.close();
  }

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired QuoteProcessor processor;
  @Autowired QuoteRouter router;
  @Autowired QuoteFeeds feeds;
  @Autowired SimulatedQuoteSource simulated;
  @Autowired MarketAdminApi admin;
  @Autowired MarketApi market;
  @Autowired List<AlertCheck> alerts;
  @MockitoBean MailApi mail;

  @BeforeEach
  void connected() throws Exception {
    await("两家的连接都建好并订阅", () -> feeds.feeds().stream().allMatch(f -> f.status().stream().allMatch(s -> s.state() == QuoteFeed.State.CONNECTED))
        && server.subscribed() >= 2 + 4);
  }

  static void await(String what, Supplier<Boolean> ok) throws InterruptedException {
    long end = System.nanoTime() + Duration.ofSeconds(15).toNanos();
    while (System.nanoTime() < end) {
      if (ok.get()) return;
      Thread.sleep(20);
    }
    throw new AssertionError("等了 15 秒还没有：" + what);
  }

  Optional<MarketQuote> latest(String symbol) {
    return processor.latest(symbol);
  }

  Map<String, Boolean> alertItems() {
    Map<String, Boolean> out = new HashMap<>();
    for (AlertCheck a : alerts) for (AlertCheck.Item i : a.evaluate()) out.put(i.name(), i.ok());
    return out;
  }

  @Test
  void 配了两家token_各自建连接_AllTick外汇加美股两条_iTick按品类四条() {
    Map<String, Integer> byFeed = new HashMap<>();
    for (QuoteFeed f : feeds.feeds()) byFeed.put(f.name(), f.status().size());
    assertThat(byFeed).containsEntry("alltick", 2).containsEntry("itick", 4);
    assertThat(server.allTickQuery()).isEqualTo("token=" + FAKE_TOKEN);
    assertThat(server.iTickTokenHeader()).isEqualTo(FAKE_TOKEN);
    assertThat(router.liveTrading("EURUSD")).isTrue();
    assertThat(router.liveTrading("NOPE")).isFalse();
  }

  @Test
  void 主源报价进入交易链路_后台品种页显示报价源() throws Exception {
    server.allTickDepth("USDJPY", "157.9151", "157.9302");
    await("USDJPY 有可成交的报价", () -> latest("USDJPY").filter(MarketQuote::executable).isPresent());
    MarketQuote q = latest("USDJPY").orElseThrow();
    // 按品种 3 位小数取整（买价向下 157.915、卖价向上 157.931），再加点每边 10 点 = 0.010（V24）
    assertThat(q.bid()).as("按品种 3 位小数，买价向下，再减加点").isEqualByComparingTo("157.905");
    assertThat(q.ask()).as("卖价向上，再加加点").isEqualByComparingTo("157.941");
    MarketAdminApi.Symbol s = admin.symbols().stream().filter(x -> x.spec().code().equals("USDJPY")).findFirst().orElseThrow();
    assertThat(s.quoteSource()).isEqualTo(new MarketAdminApi.QuoteSource("alltick", "primary"));
    assertThat(s.lastQuoteAt()).isNotNull();
    MarketAdminApi.Symbol aapl = admin.symbols().stream().filter(x -> x.spec().code().equals("AAPL")).findFirst().orElseThrow();
    assertThat(aapl.quoteSource().feed()).isEqualTo("alltick");
    assertThat(admin.simulatedQuotes()).as("simulated 模式下仍显示模拟起始价（给没有映射的品种用）").isTrue();
  }

  @Test
  void 两家偏差过大时只暂停开仓并告警_报价照常可成交用主源价格_回落后恢复() throws Exception {
    server.allTickDepth("GBPUSD", "1.33420", "1.33435");
    await("GBPUSD 可成交", () -> latest("GBPUSD").filter(MarketQuote::executable).isPresent());
    server.iTickDepth("GBPUSD", "GB", "1.34420", "1.34435"); // 约 0.75%
    await("GBPUSD 暂停开仓", () -> market.quoteDeviationPaused("GBPUSD"));
    assertThat(alertItems()).containsEntry("quote.deviation", false);
    server.allTickDepth("GBPUSD", "1.33424", "1.33439");
    await("主源的新价进主链路", () -> latest("GBPUSD").map(q -> q.bid().compareTo(new BigDecimal("1.33414")) == 0).orElse(false));
    MarketQuote q = latest("GBPUSD").orElseThrow();
    assertThat(q.executable()).as("报价照常可以成交（平仓、止盈止损、强平用它）").isTrue();
    assertThat(q.status()).isEqualTo(QuoteStatus.FRESH);
    // 主源 1.33424 / 1.33439，加点每边 10 点（0.00010），买卖合计 20 点
    assertThat(q.ask()).isEqualByComparingTo("1.33449");
    assertThat(market.quoteDeviationPaused("GBPUSD")).as("主源这条仍然偏差").isTrue();
    assertThat(admin.symbols().stream().filter(x -> x.spec().code().equals("GBPUSD")).findFirst().orElseThrow().quoteSource())
        .isEqualTo(new MarketAdminApi.QuoteSource("alltick", "deviation"));
    server.iTickDepth("GBPUSD", "GB", "1.33421", "1.33436");
    await("偏差恢复", () -> !market.quoteDeviationPaused("GBPUSD"));
    assertThat(latest("GBPUSD").orElseThrow().bid()).as("备源的价格从来没进主链路").isEqualByComparingTo("1.33414");
    assertThat(alertItems()).containsEntry("quote.deviation", true);
  }

  @Test
  void 告警项_两家连接正常_不影响健康检查的status() throws Exception {
    Map<String, Boolean> items = alertItems();
    assertThat(items).containsKeys("quote.alltick", "quote.itick", "quote.failover", "quote.deviation");
    assertThat(items.get("quote.alltick")).isTrue();
    assertThat(items.get("quote.itick")).isTrue();
    JsonNode h = json.readTree(mvc.perform(get("/api/health")).andReturn().getResponse().getContentAsString());
    assertThat(h.get("status").asString()).isEqualTo("UP");
  }

  @Test
  void 连接断开时只亮告警_重连后恢复() throws Exception {
    server.rejectStatus(503);
    server.killAll();
    await("告警 quote.itick 变 DOWN", () -> Boolean.FALSE.equals(alertItems().get("quote.itick")));
    JsonNode h = json.readTree(mvc.perform(get("/api/health")).andReturn().getResponse().getContentAsString());
    assertThat(h.get("status").asString()).as("外部报价源故障不让存活检查 DOWN（约定 24）").isEqualTo("UP");
    server.rejectStatus(0);
    await("重连成功", () -> feeds.feeds().stream().allMatch(f -> f.status().stream().allMatch(s -> s.state() == QuoteFeed.State.CONNECTED)));
    await("告警恢复", () -> Boolean.TRUE.equals(alertItems().get("quote.itick")));
  }

  @Test
  void 官网接口默认不出真实价格_真实源接管的品种显示模拟的示例行情() throws Exception {
    server.allTickDepth("GOLD", "4126.50", "4126.90");
    await("XAUUSD 交易报价来自 AllTick", () -> latest("XAUUSD").filter(MarketQuote::executable).isPresent());
    assertThat(simulated.moveTo("XAUUSD", new BigDecimal("4197.70"))).isPresent();
    assertThat(latest("XAUUSD").orElseThrow().bid()).as("模拟价不进交易链路（AllTick 4126.50 − 加点 0.10）").isEqualByComparingTo("4126.40");
    JsonNode body = json.readTree(mvc.perform(get("/api/public/quotes")).andReturn().getResponse().getContentAsString());
    assertThat(body.get("sample").asBoolean()).isTrue();
    JsonNode xau = null;
    for (JsonNode n : body.get("items")) if (n.get("symbol").asString().equals("XAUUSD")) xau = n;
    assertThat(xau).isNotNull();
    assertThat(xau.get("status").asString()).isEqualTo("OPEN");
    assertThat(xau.get("bid").asString()).as("官网是模拟价（4197.70 − 加点 0.10），不是 AllTick 的价格").isEqualTo("4197.60");
    assertThat(json.writeValueAsString(body)).doesNotContain("4126.5").doesNotContain("4126.4");
  }
}
