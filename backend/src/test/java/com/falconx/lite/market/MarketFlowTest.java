package com.falconx.lite.market;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.api.QuoteStatus;
import com.falconx.lite.market.config.SymbolCatalog;
import com.falconx.lite.market.kline.KlineService;
import com.falconx.lite.market.kline.Timeframe;
import com.falconx.lite.market.quote.QuoteProcessor;
import com.falconx.lite.market.quote.RawQuote;
import com.falconx.lite.notification.api.MailApi;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** 行情主链路和接口，用真实的 MySQL（C37）。时钟固定在 2026-10-14（周三）10:00 UTC，所有品种都在交易时段内。 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MarketFlowTest {

  static final Instant NOW = Instant.parse("2026-10-14T10:00:00Z");

  @TestConfiguration
  static class FixedClock {
    @Bean
    @Primary
    Clock fixedClock() {
      return Clock.fixed(NOW, ZoneOffset.UTC);
    }
  }

  @Autowired QuoteProcessor processor;
  @Autowired MarketApi market;
  @Autowired SymbolCatalog catalog;
  @Autowired KlineService klines;
  @Autowired JdbcTemplate jdbc;
  @Autowired MockMvc mvc;
  @MockitoBean MailApi mail;

  static RawQuote q(String symbol, String bid, String ask, Instant at) {
    return new RawQuote(symbol, new BigDecimal(bid), new BigDecimal(ask), at);
  }

  @Test
  void 五十个品种的配置已加载_合约大小和杠杆按A01和A03() {
    assertThat(market.symbols()).hasSize(50);
    var xau = market.symbol("XAUUSD").orElseThrow();
    assertThat(xau.contractSize()).isEqualByComparingTo("100");
    assertThat(xau.maxLeverage()).isEqualTo(200);
    assertThat(market.symbol("EURUSD").orElseThrow().contractSize()).isEqualByComparingTo("100000");
    assertThat(market.symbol("XAGUSD").orElseThrow().contractSize()).isEqualByComparingTo("5000");
  }

  @Test
  void 加点只加一次_卖价减买价加_订阅者收到报价() {
    jdbc.update("UPDATE market_symbol SET markup = 0.5 WHERE code = 'US500'");
    catalog.reload();
    List<MarketQuote> got = new CopyOnWriteArrayList<>();
    market.subscribe(mq -> { if (mq.symbol().equals("US500")) got.add(mq); });
    assertThat(processor.process(q("US500", "6712.0", "6712.4", NOW))).isEqualTo(QuoteStatus.FRESH);
    MarketQuote mq = market.quote("US500").orElseThrow();
    assertThat(mq.bid()).isEqualByComparingTo("6711.5");
    assertThat(mq.ask()).isEqualByComparingTo("6712.9");
    assertThat(mq.mid()).as("中间价不含加点").isEqualByComparingTo("6712.2");
    assertThat(mq.executable()).isTrue();
    assertThat(got).hasSize(1);
    jdbc.update("UPDATE market_symbol SET markup = 0 WHERE code = 'US500'");
    catalog.reload();
  }

  @Test
  void 异常报价不更新价格且不可成交() {
    processor.process(q("ETHUSD", "4086.20", "4087.80", NOW));
    assertThat(processor.process(q("ETHUSD", "4087.00", "4086.00", NOW))).isEqualTo(QuoteStatus.ABNORMAL);
    MarketQuote mq = market.quote("ETHUSD").orElseThrow();
    assertThat(mq.bid()).isEqualByComparingTo("4086.20");
    assertThat(mq.executable()).isFalse();
  }

  @Test
  void 汇率_直接对_反向对_固定汇率_USDT视同USD() {
    processor.process(q("GBPUSD", "1.33180", "1.33190", NOW));
    processor.process(q("USDJPY", "151.840", "151.860", NOW));
    assertThat(market.toUsdRate("GBP").orElseThrow()).isEqualByComparingTo("1.33185");
    assertThat(market.toUsdRate("JPY").orElseThrow().doubleValue()).isCloseTo(1 / 151.85, org.assertj.core.data.Offset.offset(1e-9));
    assertThat(market.toUsdRate("HKD").orElseThrow()).isEqualByComparingTo("0.12853470");
    assertThat(market.toUsdRate("USDT").orElseThrow()).isEqualByComparingTo("1");
    assertThat(market.toUsdRate("XYZ")).isEmpty();
  }

  @Test
  void 交易时段_美股周末和盘后休市_加密全天_外汇周五晚收市_休市日全天休市() {
    assertThat(market.isTradingOpen("AAPL", Instant.parse("2026-10-14T14:00:00Z"))).isTrue();
    assertThat(market.isTradingOpen("AAPL", Instant.parse("2026-10-14T21:00:00Z"))).isFalse();
    assertThat(market.isTradingOpen("AAPL", Instant.parse("2026-10-17T14:00:00Z"))).as("周六").isFalse();
    assertThat(market.isTradingOpen("BTCUSD", Instant.parse("2026-10-17T03:00:00Z"))).isTrue();
    assertThat(market.isTradingOpen("EURUSD", Instant.parse("2026-10-16T21:30:00Z"))).as("周五 21:30").isFalse();
    assertThat(market.isTradingOpen("EURUSD", Instant.parse("2026-10-18T22:30:00Z"))).as("周日 22:30").isTrue();
    jdbc.update("INSERT IGNORE INTO market_holiday (symbol, trade_date, reason) VALUES ('AUS200', '2026-10-14', '测试')");
    catalog.reload();
    assertThat(market.isTradingOpen("AUS200", NOW)).isFalse();
    assertThat(processor.process(q("AUS200", "8975.0", "8976.0", NOW))).isEqualTo(QuoteStatus.MARKET_CLOSED);
    jdbc.update("DELETE FROM market_holiday WHERE symbol = 'AUS200'");
    catalog.reload();
  }

  @Test
  void K线跨桶时上一根收盘写库_历史接口含当前这一根() {
    Instant a = NOW.minusSeconds(120);
    // 用固定时钟时，报价时间不能和"现在"差超过 5 秒，所以直接调用 K 线聚合
    klines.accept("SOLUSD", new BigDecimal("196.00"), a);
    klines.accept("SOLUSD", new BigDecimal("197.50"), a.plusSeconds(10));
    klines.accept("SOLUSD", new BigDecimal("195.00"), a.plusSeconds(20));
    klines.accept("SOLUSD", new BigDecimal("196.20"), a.plusSeconds(70));
    var bars = klines.history("SOLUSD", Timeframe.M1, 10);
    assertThat(bars).hasSizeGreaterThanOrEqualTo(2);
    var closed = bars.get(bars.size() - 2);
    assertThat(closed.open()).isEqualByComparingTo("196.00");
    assertThat(closed.high()).isEqualByComparingTo("197.50");
    assertThat(closed.low()).isEqualByComparingTo("195.00");
    assertThat(closed.close()).isEqualByComparingTo("195.00");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM market_kline WHERE symbol = 'SOLUSD' AND timeframe = '1m'", Integer.class)).isGreaterThanOrEqualTo(1);
  }

  @SuppressWarnings("unchecked")
  private Cookie login() throws Exception {
    String email = "m" + System.nanoTime() + "@example.com";
    mvc.perform(post("/api/auth/email-code").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\",\"purpose\":\"REGISTER\"}"));
    ArgumentCaptor<Map<String, String>> p = ArgumentCaptor.forClass(Map.class);
    verify(mail, atLeastOnce()).send(eq(email), eq("EMAIL_CODE"), p.capture());
    return mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\",\"code\":\"" + p.getValue().get("code")
        + "\",\"password\":\"password123\",\"firstName\":\"A\",\"lastName\":\"B\",\"birthDate\":\"1990-05-01\",\"nationality\":\"CN\"}")).andReturn().getResponse().getCookie("fx_session");
  }

  @Test
  void 接口_品种_报价_K线_今日走势_需要登录() throws Exception {
    assertThat(mvc.perform(get("/api/market/symbols")).andReturn().getResponse().getStatus()).isEqualTo(401);
    Cookie c = login();
    processor.process(q("XAUUSD", "4126.35", "4126.75", NOW));
    String symbols = mvc.perform(get("/api/market/symbols").cookie(c)).andReturn().getResponse().getContentAsString();
    assertThat(symbols).contains("\"code\":\"XAUUSD\"").contains("\"contractSize\":\"100\"").contains("\"unit\":\"ounce\"").contains("\"tradingOpen\":");
    String quotes = mvc.perform(get("/api/market/quotes").cookie(c)).andReturn().getResponse().getContentAsString();
    assertThat(quotes).contains("\"symbol\":\"XAUUSD\"").contains("\"bid\":\"4126.35\"").contains("\"ask\":\"4126.75\"").contains("\"quoteToUsd\":\"1\"");
    String k = mvc.perform(get("/api/market/klines").param("symbol", "XAUUSD").param("tf", "15m").cookie(c)).andReturn().getResponse().getContentAsString();
    assertThat(k).contains("\"open\":\"4126.55\"");
    assertThat(mvc.perform(get("/api/market/klines").param("symbol", "XAUUSD").param("tf", "2m").cookie(c)).andReturn().getResponse().getContentAsString()).contains("TIMEFRAME_INVALID");
    assertThat(mvc.perform(get("/api/market/sparklines").cookie(c)).andReturn().getResponse().getContentAsString()).contains("\"XAUUSD\":[");
  }
}
