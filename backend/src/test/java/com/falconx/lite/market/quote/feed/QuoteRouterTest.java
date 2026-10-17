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
        new QuoteFeedsProperties.ITick(itickToken, null, null), null, ROUTES);
  }

  /** 加密货币"币安、AllTick、iTick"的映射（和 application.yml 一样），另加一个只有币安永续的品种测开关 */
  static final Map<String, List<String>> ROUTES_WITH_BINANCE = Map.of(
      "EURUSD", List.of("alltick:fx:EURUSD", "itick:forex:EURUSD$GB"),
      "BTCUSD", List.of("binance:spot:BTCUSDT", "alltick:fx:BTCUSDT", "itick:crypto:BTCUSDT$BA"),
      "XAUUSD", List.of("alltick:fx:GOLD", "itick:forex:XAUUSD$GB", "binance:futures:XAUUSDT"));

  static QuoteFeedsProperties props(String alltickToken, String itickToken, String primary, QuoteFeedsProperties.Binance binance) {
    return new QuoteFeedsProperties(primary, Duration.ofSeconds(10), Duration.ofSeconds(30), new BigDecimal("0.005"), Duration.ofSeconds(5), BigDecimal.ONE,
        Duration.ofSeconds(60), null, null, null, new QuoteFeedsProperties.AllTick(alltickToken, null, null, null, null),
        new QuoteFeedsProperties.ITick(itickToken, null, null), binance, ROUTES_WITH_BINANCE);
  }

  static QuoteFeedsProperties.Binance binanceOn(boolean futures) {
    return new QuoteFeedsProperties.Binance(true, null, futures, null, null, 0, null);
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
  void 两家偏差超过千分之五暂停开仓_报价只用主源_回落后恢复() {
    QuoteRouter r = both();
    r.onQuote("alltick", "BTCUSDT", d("81500.0"), d("81510.0"), null);
    r.onQuote("itick", "BTCUSDT$BA", d("81900.0"), d("81910.0"), null); // 偏差约 0.49%
    verify(processor, never()).setDeviationPaused(anyString(), anyBoolean());
    r.onQuote("itick", "BTCUSDT$BA", d("82000.0"), d("82010.0"), null); // 偏差约 0.61%
    verify(processor).setDeviationPaused("BTCUSD", true);
    assertThat(r.current("BTCUSD")).contains(new QuoteSource("alltick", "deviation"));
    assertThat(r.deviations()).hasSize(1);
    assertThat(r.deviations().getFirst()).startsWith("BTCUSD 0.6");
    // 偏差期间主源的报价照常进主链路（平仓、止盈止损、强平用它），备源的不进
    clearInvocations(processor);
    r.onQuote("alltick", "BTCUSDT", d("81520.0"), d("81530.0"), null);
    r.onQuote("itick", "BTCUSDT$BA", d("82020.0"), d("82030.0"), null);
    assertThat(submitted()).extracting(RawQuote::bid).as("只有主源的价格").containsExactly(d("81520.0"));
    r.onQuote("alltick", "BTCUSDT", d("81990.0"), d("82000.0"), null);
    verify(processor).setDeviationPaused("BTCUSD", false);
    assertThat(r.deviations()).isEmpty();
  }

  @Test
  void 正在用备源时出现偏差_立即切回主源用主源价格() {
    QuoteRouter r = both();
    r.onQuote("itick", "EURUSD$GB", d("1.12500"), d("1.12510"), null);
    assertThat(r.current("EURUSD")).as("主源从来没报价，用备源").contains(new QuoteSource("itick", "backup"));
    clearInvocations(processor);
    // 主源恢复（没满 30 秒，本来还会继续用备源），但两家相差约 0.9%
    r.onQuote("alltick", "EURUSD", d("1.13500"), d("1.13510"), null);
    verify(processor).setDeviationPaused("EURUSD", true);
    assertThat(r.current("EURUSD")).contains(new QuoteSource("alltick", "deviation"));
    assertThat(submitted()).extracting(RawQuote::bid).as("切回主源，这一条主源的报价就进主链路").containsExactly(d("1.13500"));
    clearInvocations(processor);
    r.onQuote("itick", "EURUSD$GB", d("1.12501"), d("1.12511"), null);
    assertThat(submitted()).as("备源的价格不进主链路").isEmpty();
  }

  @Test
  void 一边没有新价时不做交叉校验() {
    QuoteRouter r = both();
    r.onQuote("itick", "BTCUSDT$BA", d("90000.0"), d("90010.0"), null);
    clock.advance(Duration.ofSeconds(6));
    r.onQuote("alltick", "BTCUSDT", d("81500.0"), d("81510.0"), null);
    verify(processor, never()).setDeviationPaused(anyString(), anyBoolean());
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
  void 币安开关关闭时和以前一样_加密货币AllTick主iTick备_不订阅币安() {
    QuoteRouter r = router("simulated", props("ci_only_fake_token", "ci_only_fake_token", "alltick", QuoteFeedsProperties.Binance.off()));
    assertThat(r.subscriptions()).containsOnlyKeys("alltick", "itick");
    r.onQuote("binance", "BTCUSDT", d("81588.6"), d("81588.7"), null);
    verify(processor, never()).submit(any());
    r.onQuote("alltick", "BTCUSDT", d("81500.0"), d("81510.0"), null);
    assertThat(r.current("BTCUSD")).contains(new QuoteSource("alltick", "primary"));
    assertThat(r.subscriptions().get("itick").get("crypto")).containsExactly("BTCUSDT$BA");
  }

  @Test
  void 币安打开后加密货币币安主AllTick备_iTick不订阅加密货币_其他品种不变() {
    QuoteRouter r = router("simulated", props("ci_only_fake_token", "ci_only_fake_token", "alltick", binanceOn(false)));
    assertThat(r.subscriptions().get("binance")).containsOnlyKeys("spot");
    assertThat(r.subscriptions().get("binance").get("spot")).containsExactly("BTCUSDT");
    assertThat(r.subscriptions().get("itick")).as("iTick 排第三，不订阅加密货币").doesNotContainKey("crypto");
    assertThat(r.subscriptions().get("alltick").get("fx")).contains("BTCUSDT", "EURUSD", "GOLD");
    r.onQuote("binance", "BTCUSDT", d("81588.60000000"), d("81588.61000000"), null);
    r.onQuote("alltick", "BTCUSDT", d("81580.0"), d("81590.0"), null);
    List<RawQuote> s = submitted();
    assertThat(s).hasSize(1);
    assertThat(s.getFirst().bid()).as("BTCUSD 1 位小数，买价向下").isEqualByComparingTo("81588.6");
    assertThat(s.getFirst().ask()).as("卖价向上").isEqualByComparingTo("81588.7");
    assertThat(s.getFirst().time()).as("币安现货没有时间，用收到的时间").isEqualTo(clock.instant());
    assertThat(r.current("BTCUSD")).contains(new QuoteSource("binance", "primary"));
    assertThat(r.current("EURUSD")).contains(new QuoteSource("alltick", "primary"));
    assertThat(r.symbolsOf("binance")).containsExactly("BTCUSD");
  }

  @Test
  void 币安断了10秒切到AllTick_恢复30秒后切回币安() {
    QuoteRouter r = router("simulated", props("ci_only_fake_token", "ci_only_fake_token", "alltick", binanceOn(false)));
    r.onQuote("binance", "BTCUSDT", d("81588.6"), d("81588.7"), null);
    clock.advance(Duration.ofSeconds(11));
    clearInvocations(processor);
    r.onQuote("alltick", "BTCUSDT", d("81590.0"), d("81600.0"), null);
    assertThat(r.current("BTCUSD")).contains(new QuoteSource("alltick", "backup"));
    assertThat(submitted()).extracting(RawQuote::bid).containsExactly(d("81590.0"));
    for (int i = 0; i < 6; i++) {
      r.onQuote("binance", "BTCUSDT", d("81595.0"), d("81595.1"), null);
      r.onQuote("alltick", "BTCUSDT", d("81590.0"), d("81600.0"), null);
      clock.advance(Duration.ofSeconds(5));
    }
    r.onQuote("binance", "BTCUSDT", d("81595.0"), d("81595.1"), null);
    assertThat(r.current("BTCUSD")).contains(new QuoteSource("binance", "primary"));
  }

  @Test
  void 币安和AllTick偏差超过千分之五同样只暂停开仓() {
    QuoteRouter r = router("simulated", props("ci_only_fake_token", "", "alltick", binanceOn(false)));
    r.onQuote("binance", "BTCUSDT", d("81500.0"), d("81510.0"), null);
    r.onQuote("alltick", "BTCUSDT", d("82000.0"), d("82010.0"), null);
    verify(processor).setDeviationPaused("BTCUSD", true);
    assertThat(r.current("BTCUSD")).contains(new QuoteSource("binance", "deviation"));
  }

  @Test
  void AllTick没有token时币安主iTick备_对调主源不影响币安的位置() {
    QuoteRouter r = router("simulated", props("", "ci_only_fake_token", "alltick", binanceOn(false)));
    assertThat(r.subscriptions().get("itick").get("crypto")).containsExactly("BTCUSDT$BA");
    r.onQuote("itick", "BTCUSDT$BA", d("81580.0"), d("81590.0"), null);
    assertThat(r.current("BTCUSD")).as("币安还没报价，先用备源").contains(new QuoteSource("itick", "backup"));
    QuoteRouter swapped = router("simulated", props("ci_only_fake_token", "ci_only_fake_token", "itick", binanceOn(false)));
    assertThat(swapped.subscriptions().get("binance").get("spot")).containsExactly("BTCUSDT");
    assertThat(swapped.subscriptions().get("itick").get("crypto")).as("iTick 和 AllTick 对调，币安仍排第一").containsExactly("BTCUSDT$BA");
    assertThat(swapped.subscriptions().get("alltick").get("fx")).doesNotContain("BTCUSDT");
    assertThat(swapped.current("EURUSD").orElseThrow().feed()).isEqualTo("itick");
  }

  @Test
  void 币安永续的映射只有打开futures开关才用() {
    QuoteRouter off = router("simulated", props("", "", "alltick", binanceOn(false)));
    assertThat(off.subscriptions().get("binance")).containsOnlyKeys("spot");
    assertThat(off.liveTrading("XAUUSD")).isFalse();
    QuoteRouter on = router("simulated", props("", "", "alltick", binanceOn(true)));
    assertThat(on.subscriptions().get("binance").get("futures")).containsExactly("XAUUSDT");
    QuoteRouter withTokens = router("simulated", props("ci_only_fake_token", "ci_only_fake_token", "alltick", binanceOn(true)));
    assertThat(withTokens.subscriptions().get("binance")).as("排在第三，AllTick、iTick 都能用时不用").doesNotContainKey("futures");
  }

  @Test
  void 同一家的同一个代码用在两个品种时启动失败() {
    QuoteFeedsProperties dup = new QuoteFeedsProperties(null, null, null, null, null, null, null, null, null, null, null, null, binanceOn(false),
        Map.of("BTCUSD", List.of("binance:spot:BTCUSDT"), "BTCUSD2", List.of("binance:spot:btcusdt")));
    assertThatThrownBy(() -> router("simulated", dup)).hasMessageContaining("同时用在");
  }

  @Test
  void 映射写错时启动失败() {
    QuoteFeedsProperties bad = new QuoteFeedsProperties(null, null, null, null, null, null, null, null, null, null, null, null, null,
        Map.of("EURUSD", List.of("alltick:EURUSD")));
    assertThatThrownBy(() -> router("simulated", bad)).hasMessageContaining("格式不对");
    QuoteFeedsProperties badChannel = new QuoteFeedsProperties(null, null, null, null, null, null, null, null, null, null, null, null, null,
        Map.of("EURUSD", List.of("alltick:forex:EURUSD")));
    assertThatThrownBy(() -> router("simulated", badChannel)).hasMessageContaining("连接 forex 不对");
    QuoteFeedsProperties badFeed = new QuoteFeedsProperties(null, null, null, null, null, null, null, null, null, null, null, null, null,
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
    assertThat(p.binance().enabled()).as("币安默认关闭").isFalse();
    assertThat(p.binance().futuresEnabled()).as("币安永续默认关闭").isFalse();
    assertThat(p.binance().spotUrl()).isEqualTo("wss://data-stream.binance.vision");
    assertThat(p.binance().maxConnectionAge()).isEqualTo(Duration.ofHours(23));
    List<String> binance = routes.entrySet().stream().filter(e -> e.getValue().stream().anyMatch(x -> x.feed().equals("binance"))).map(Map.Entry::getKey)
        .sorted().toList();
    assertThat(binance).as("币安只给 10 个加密货币").containsExactly("ADAUSD", "BCHUSD", "BNBUSD", "BTCUSD", "DOGEUSD", "DOTUSD", "ETHUSD", "LTCUSD",
        "SOLUSD", "XRPUSD");
    assertThat(routes.values().stream().flatMap(List::stream).filter(x -> x.feed().equals("binance")).allMatch(x -> x.channel().equals("spot")))
        .as("Amos 2026-10-17：不用币安永续，映射里没有 futures").isTrue();
    assertThat(routes.get("BTCUSD")).extracting(QuoteFeedsProperties.Route::feed).containsExactly("binance", "alltick", "itick");
    assertThat(routes.get("BTCUSD").getFirst().code()).isEqualTo("BTCUSDT");
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
