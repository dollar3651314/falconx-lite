package com.falconx.lite.market.quote.feed;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
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
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * 按品种选报价源、主备切换、交叉校验（技术方案/v2-报价源接入.md 第 3、4 节）。直接调用 {@link QuoteRouter#onQuote}，时钟手动拨，不连网络。
 */
class QuoteRouterTest {

  static final Map<String, List<String>> ROUTES = Map.of(
      "EURUSD", List.of("alltick:fx:EURUSD", "itick:forex:EURUSD$GB"),
      "BTCUSD", List.of("alltick:fx:BTCUSDT", "itick:crypto:BTCUSDT$BA"),
      "US2000", List.of("alltick:fx:US2000"),
      "AAPL", List.of("alltick:stock:AAPL.US", "itick:stock:AAPL$US"));

  MutableClock clock;
  QuoteProcessor processor;
  SymbolCatalog catalog;

  @BeforeEach
  void setUp() {
    clock = new MutableClock();
    processor = mock(QuoteProcessor.class);
    catalog = mock(SymbolCatalog.class);
    when(catalog.get(anyString())).thenReturn(Optional.empty());
    spec("EURUSD", 5);
    spec("BTCUSD", 1);
    spec("US2000", 1);
    spec("AAPL", 2);
  }

  void spec(String code, int digits) {
    SymbolSpec s = new SymbolSpec(code, code, code, "fx", digits, BigDecimal.ONE, "unit", "X", "USD", 100, BigDecimal.ONE, BigDecimal.ONE, BigDecimal.ONE,
        BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, false, false, 0);
    when(catalog.get(code)).thenReturn(Optional.of(s));
  }

  static QuoteFeedsProperties props(String alltickToken, String itickToken, String primary, String usdtRate) {
    return new QuoteFeedsProperties(primary, Duration.ofSeconds(10), Duration.ofSeconds(30), new BigDecimal("0.005"), Duration.ofSeconds(5),
        new BigDecimal(usdtRate), Duration.ofSeconds(60), null, null, null, new QuoteFeedsProperties.AllTick(alltickToken, null, null, null, null),
        new QuoteFeedsProperties.ITick(itickToken, null, null), ROUTES);
  }

  QuoteRouter router(String source, QuoteFeedsProperties p) {
    MarketProperties m = new MarketProperties(source, Duration.ofMillis(500), Duration.ofSeconds(5), Duration.ofMinutes(1), new BigDecimal("0.05"),
        new BigDecimal("0.10"), new BigDecimal("0.05"), Duration.ofSeconds(60), Duration.ofMillis(250), Map.of());
    return new QuoteRouter(m, p, processor, catalog, clock, new SimpleMeterRegistry());
  }

  QuoteRouter both() {
    return router("simulated", props("ci_only_fake_token", "ci_only_fake_token", "alltick", "1"));
  }

  static BigDecimal d(String s) {
    return new BigDecimal(s);
  }

  /** 交给主链路的报价（按顺序） */
  List<RawQuote> submitted() {
    ArgumentCaptor<RawQuote> c = ArgumentCaptor.forClass(RawQuote.class);
    verify(processor, org.mockito.Mockito.atLeast(0)).submit(c.capture());
    return c.getAllValues();
  }

  @Test
  void 没有token时和以前一样_全部走模拟源_不订阅任何东西() {
    QuoteRouter r = router("simulated", props("", "", "alltick", "1"));
    assertThat(r.subscriptions()).isEmpty();
    assertThat(r.liveTrading("EURUSD")).isFalse();
    assertThat(r.current("EURUSD")).contains(new QuoteSource("simulated", null));
    r.onQuote("alltick", "EURUSD", d("1.1"), d("1.2"), null);
    verify(processor, never()).submit(any());
  }

  @Test
  void 报价模式none时即使配了token也不订阅() {
    QuoteRouter r = router("none", props("ci_only_fake_token", "ci_only_fake_token", "alltick", "1"));
    assertThat(r.subscriptions()).isEmpty();
    assertThat(r.liveTrading("EURUSD")).isFalse();
    assertThat(r.current("EURUSD")).isEmpty();
  }

  @Test
  void live模式下所有品种都不用模拟价成交() {
    QuoteRouter r = router("live", props("", "", "alltick", "1"));
    assertThat(r.liveTrading("EURUSD")).isTrue();
    assertThat(r.liveTrading("XAUUSD")).as("没有映射的品种也不用模拟价").isTrue();
    assertThat(r.current("EURUSD")).isEmpty();
  }

  @Test
  void 只配了一家token时只订阅这一家_按连接分组() {
    QuoteRouter r = router("simulated", props("", "ci_only_fake_token", "alltick", "1"));
    assertThat(r.subscriptions()).containsOnlyKeys("itick");
    assertThat(r.subscriptions().get("itick")).containsOnlyKeys("forex", "crypto", "stock");
    assertThat(r.liveTrading("US2000")).as("US2000 只有 AllTick，没配 token → 模拟").isFalse();
    assertThat(r.current("EURUSD")).contains(new QuoteSource("itick", "primary"));
  }

  @Test
  void 主源正常时只用主源的报价_取整买价向下卖价向上() {
    QuoteRouter r = both();
    r.onQuote("alltick", "EURUSD", d("1.1250049"), d("1.1251201"), Instant.parse("2026-10-14T09:59:59.500Z"));
    r.onQuote("itick", "EURUSD$GB", d("1.12500"), d("1.12510"), null);
    List<RawQuote> s = submitted();
    assertThat(s).hasSize(1);
    assertThat(s.getFirst().symbol()).isEqualTo("EURUSD");
    assertThat(s.getFirst().bid()).isEqualByComparingTo("1.12500");
    assertThat(s.getFirst().ask()).isEqualByComparingTo("1.12513");
    assertThat(s.getFirst().time()).isEqualTo(Instant.parse("2026-10-14T09:59:59.500Z"));
    assertThat(r.current("EURUSD")).contains(new QuoteSource("alltick", "primary"));
  }

  @Test
  void 主源10秒没报价切到备源_恢复30秒后切回() {
    QuoteRouter r = both();
    r.onQuote("alltick", "EURUSD", d("1.12500"), d("1.12510"), null);
    clock.advance(Duration.ofSeconds(5));
    r.onQuote("itick", "EURUSD$GB", d("1.12501"), d("1.12511"), null);
    assertThat(r.current("EURUSD").orElseThrow().state()).as("主源才 5 秒没价，不切").isEqualTo("primary");
    clock.advance(Duration.ofSeconds(6));
    clearInvocations(processor);
    r.onQuote("itick", "EURUSD$GB", d("1.12502"), d("1.12512"), null);
    assertThat(r.current("EURUSD")).contains(new QuoteSource("itick", "backup"));
    assertThat(submitted()).as("切换后备源的报价进主链路").hasSize(1);
    assertThat(r.onBackup()).containsExactly("EURUSD（itick）");

    // 主源恢复，但没满 30 秒：仍用备源，主源的报价不进主链路
    clock.advance(Duration.ofSeconds(1));
    clearInvocations(processor);
    r.onQuote("alltick", "EURUSD", d("1.12503"), d("1.12513"), null);
    for (int i = 0; i < 5; i++) {
      clock.advance(Duration.ofSeconds(5));
      r.onQuote("itick", "EURUSD$GB", d("1.12503"), d("1.12513"), null);
      r.onQuote("alltick", "EURUSD", d("1.12503"), d("1.12513"), null);
    }
    assertThat(r.current("EURUSD").orElseThrow().feed()).as("主源恢复 25 秒").isEqualTo("itick");
    clock.advance(Duration.ofSeconds(5));
    r.onQuote("alltick", "EURUSD", d("1.12504"), d("1.12514"), null);
    assertThat(r.current("EURUSD")).as("主源连续报价满 30 秒，切回").contains(new QuoteSource("alltick", "primary"));
    assertThat(r.onBackup()).isEmpty();
  }

  @Test
  void 备源也断了时主源一恢复就切回() {
    QuoteRouter r = both();
    r.onQuote("itick", "EURUSD$GB", d("1.12500"), d("1.12510"), null);
    assertThat(r.current("EURUSD").orElseThrow().feed()).as("主源从来没报价，直接用备源").isEqualTo("itick");
    clock.advance(Duration.ofSeconds(20));
    r.onQuote("alltick", "EURUSD", d("1.12500"), d("1.12510"), null);
    assertThat(r.current("EURUSD").orElseThrow().feed()).isEqualTo("alltick");
  }

  @Test
  void 两家偏差超过千分之五暂停成交_回落后恢复() {
    QuoteRouter r = both();
    r.onQuote("alltick", "BTCUSDT", d("81500.0"), d("81510.0"), null);
    r.onQuote("itick", "BTCUSDT$BA", d("81900.0"), d("81910.0"), null); // 偏差约 0.49%
    verify(processor, never()).setSourceBlocked(anyString(), anyBoolean());
    r.onQuote("itick", "BTCUSDT$BA", d("82000.0"), d("82010.0"), null); // 偏差约 0.61%
    verify(processor).setSourceBlocked("BTCUSD", true);
    assertThat(r.current("BTCUSD")).contains(new QuoteSource("alltick", "deviation"));
    assertThat(r.deviations()).hasSize(1);
    assertThat(r.deviations().getFirst()).startsWith("BTCUSD 0.6");
    r.onQuote("alltick", "BTCUSDT", d("81990.0"), d("82000.0"), null);
    verify(processor).setSourceBlocked("BTCUSD", false);
    assertThat(r.deviations()).isEmpty();
  }

  @Test
  void 一边没有新价时不做交叉校验() {
    QuoteRouter r = both();
    r.onQuote("itick", "BTCUSDT$BA", d("90000.0"), d("90010.0"), null);
    clock.advance(Duration.ofSeconds(6));
    r.onQuote("alltick", "BTCUSDT", d("81500.0"), d("81510.0"), null);
    verify(processor, never()).setSourceBlocked(anyString(), anyBoolean());
  }

  @Test
  void USDT系数只作用于USDT计价的代码() {
    QuoteRouter r = router("simulated", props("ci_only_fake_token", "", "alltick", "0.999"));
    r.onQuote("alltick", "BTCUSDT", d("80000.0"), d("80010.0"), null);
    r.onQuote("alltick", "EURUSD", d("1.12500"), d("1.12510"), null);
    List<RawQuote> s = submitted();
    assertThat(s.get(0).bid()).isEqualByComparingTo("79920.0");
    assertThat(s.get(0).ask()).isEqualByComparingTo("79930.0"); // 80010 × 0.999 = 79929.99 → 向上 79930.0
    assertThat(s.get(1).bid()).isEqualByComparingTo("1.12500");
  }

  @Test
  void 只有一个源的品种没有切换和校验() {
    QuoteRouter r = both();
    r.onQuote("alltick", "US2000", d("2753.8"), d("2754.2"), null);
    clock.advance(Duration.ofMinutes(5));
    r.onQuote("alltick", "US2000", d("2760.8"), d("2761.2"), null);
    assertThat(submitted()).hasSize(2);
    assertThat(r.current("US2000")).contains(new QuoteSource("alltick", "primary"));
    assertThat(r.symbolsOf("itick")).doesNotContain("US2000");
  }

  @Test
  void 主源可以整体对调成iTick() {
    QuoteRouter r = router("simulated", props("ci_only_fake_token", "ci_only_fake_token", "itick", "1"));
    r.onQuote("itick", "EURUSD$GB", d("1.12501"), d("1.12511"), null);
    r.onQuote("alltick", "EURUSD", d("1.12500"), d("1.12510"), null);
    assertThat(submitted()).hasSize(1);
    assertThat(submitted().getFirst().bid()).isEqualByComparingTo("1.12501");
    assertThat(r.current("EURUSD")).contains(new QuoteSource("itick", "primary"));
  }

  @Test
  void 没订阅的代码和停用的品种忽略() {
    QuoteRouter r = both();
    r.onQuote("alltick", "GBPUSD", d("1.3"), d("1.4"), null);
    when(catalog.get("EURUSD")).thenReturn(Optional.empty());
    r.onQuote("alltick", "EURUSD", d("1.1"), d("1.2"), null);
    verify(processor, never()).submit(any());
  }

  @Test
  void 映射写错时启动失败() {
    QuoteFeedsProperties bad = new QuoteFeedsProperties(null, null, null, null, null, null, null, null, null, null, null, null,
        Map.of("EURUSD", List.of("alltick:EURUSD")));
    assertThatThrownBy(() -> router("simulated", bad)).hasMessageContaining("格式不对");
    QuoteFeedsProperties badChannel = new QuoteFeedsProperties(null, null, null, null, null, null, null, null, null, null, null, null,
        Map.of("EURUSD", List.of("alltick:forex:EURUSD")));
    assertThatThrownBy(() -> router("simulated", badChannel)).hasMessageContaining("连接 forex 不对");
    QuoteFeedsProperties badFeed = new QuoteFeedsProperties(null, null, null, null, null, null, null, null, null, null, null, null,
        Map.of("EURUSD", List.of("okx:spot:EUR-USDT")));
    assertThatThrownBy(() -> router("simulated", badFeed)).hasMessageContaining("不认识的报价源 okx");
  }

  @Test
  void application_yml里50个品种都有映射_AllTick覆盖50个_iTick覆盖49个() throws Exception {
    var yaml = new org.springframework.boot.env.YamlPropertySourceLoader().load("app", new org.springframework.core.io.ClassPathResource("application.yml"));
    var env = new org.springframework.core.env.StandardEnvironment();
    yaml.forEach(env.getPropertySources()::addLast);
    QuoteFeedsProperties p = org.springframework.boot.context.properties.bind.Binder.get(env).bind("falconx.market.feeds", QuoteFeedsProperties.class)
        .get();
    Map<String, List<QuoteFeedsProperties.Route>> routes = p.parsedRoutes();
    assertThat(routes).hasSize(50);
    assertThat(routes.values().stream().filter(l -> l.stream().anyMatch(x -> x.feed().equals("alltick"))).count()).isEqualTo(50);
    assertThat(routes.values().stream().filter(l -> l.stream().anyMatch(x -> x.feed().equals("itick"))).count()).isEqualTo(49);
    assertThat(routes.get("US2000")).hasSize(1);
    assertThat(routes.get("XAGUSD").getFirst().code()).as("AllTick 代码区分大小写").isEqualTo("Silver");
    assertThat(routes.get("EURUSD").get(1).code()).isEqualTo("EURUSD$GB");
    assertThat(p.alltick().token()).as("仓库里没有 token").isEmpty();
    assertThat(p.itick().token()).isEmpty();
    assertThat(p.usdtUsdRate()).isEqualByComparingTo("1");
    // 默认配置能通过校验
    router("simulated", p);
  }
}
