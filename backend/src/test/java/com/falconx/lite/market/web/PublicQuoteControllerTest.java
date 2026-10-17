package com.falconx.lite.market.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.falconx.lite.market.quote.QuoteProcessor;
import com.falconx.lite.market.quote.RawQuote;
import com.falconx.lite.notification.api.MailApi;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 官网公开行情 GET /api/public/quotes（v2 需求 4.2、AC2-02、AC2-03）。用真实的 MySQL 和 Redis（C37）。
 * 时钟固定在 2026-10-14（周三）10:00 UTC：外汇、贵金属、加密货币都在交易时段内，美股（AAPL）还没开盘，用来测"休市"。
 * 品种清单在这里改成 5 个已有代码 + 1 个不存在的代码，检查"按配置顺序、忽略不存在的代码"。
 */
@SpringBootTest(properties = "falconx.market.public-quotes.symbols=BTCUSD,ETHUSD,AAPL,NOPE,EURUSD,XAUUSD")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PublicQuoteControllerTest {

  static final Instant NOW = Instant.parse("2026-10-14T10:00:00Z");

  @TestConfiguration
  static class FixedClock {
    @Bean
    @Primary
    Clock fixedClock() {
      return Clock.fixed(NOW, ZoneOffset.UTC);
    }
  }

  @Autowired MockMvc mvc;
  @Autowired QuoteProcessor processor;
  @Autowired PublicQuoteController controller;
  @Autowired ObjectMapper json;
  @MockitoBean MailApi mail;

  @BeforeEach
  void clear() {
    controller.clearCache();
  }

  static RawQuote q(String symbol, String bid, String ask) {
    return new RawQuote(symbol, new BigDecimal(bid), new BigDecimal(ask), NOW);
  }

  JsonNode fetch() throws Exception {
    MockHttpServletResponse r = mvc.perform(get("/api/public/quotes")).andReturn().getResponse();
    assertThat(r.getStatus()).as("不带登录 Cookie 也能访问：%s", r.getContentAsString()).isEqualTo(200);
    assertThat(r.getHeader("Cache-Control")).contains("no-store");
    return json.readTree(r.getContentAsString());
  }

  static JsonNode item(JsonNode body, String symbol) {
    for (JsonNode n : body.get("items")) if (n.get("symbol").asString().equals(symbol)) return n;
    throw new AssertionError("没有 " + symbol);
  }

  @Test
  void 不需要登录_按配置顺序返回_忽略不存在的代码_测试配置不是示例行情() throws Exception {
    JsonNode body = fetch();
    List<String> codes = new ArrayList<>();
    body.get("items").forEach(n -> codes.add(n.get("symbol").asString()));
    assertThat(codes).containsExactly("BTCUSD", "ETHUSD", "AAPL", "EURUSD", "XAUUSD");
    assertThat(body.get("sample").asBoolean()).as("测试配置的报价源是 none，不是模拟报价源").isFalse();
    assertThat(item(body, "XAUUSD").get("nameZh").asString()).isEqualTo("黄金");
    assertThat(item(body, "XAUUSD").get("nameEn").asString()).isEqualTo("Gold");
  }

  @Test
  void AC2_03_只有品种_名称_卖价_涨跌幅_时间_状态这些字段_没有账户和风控字段() throws Exception {
    processor.process(q("XAUUSD", "4126.50", "4126.90"));
    JsonNode body = fetch();
    Set<String> top = new TreeSet<>();
    top.addAll(body.propertyNames());
    assertThat(top).containsExactly("items", "sample");
    for (JsonNode n : body.get("items")) {
      Set<String> f = new TreeSet<>();
      f.addAll(n.propertyNames());
      assertThat(f).as(n.toString()).containsExactlyInAnyOrder("symbol", "nameZh", "nameEn", "bid", "changePct", "time", "status");
    }
    // 和端到端 AC-23 同一份风控字段清单（e2e/tests/support.ts 的 RISK_KEYS），再加上买价、加点、账户、持仓相关的字段
    Pattern leak = Pattern.compile("\"(longUsd|shortUsd|netUsd|threshold|platformNetUsd|platformThreshold|netThreshold|platformNetThreshold|manualPaused"
        + "|autoPaused|autoGlobalPaused|globalManualPaused|autoLiquidation|exposure|ask|markup|mid|openPaused|balance|equity|margin|position|positions"
        + "|userId|email|leverage|maxLeverage|feeRate|contractSize)\"\\s*:", Pattern.CASE_INSENSITIVE);
    assertThat(leak.matcher(json.writeValueAsString(body)).find()).as(body.toString()).isFalse();
  }

  @Test
  void 开市有报价_返回卖价和当日涨跌幅() throws Exception {
    processor.process(q("ETHUSD", "4000.00", "4001.00"));
    processor.process(q("ETHUSD", "4040.004", "4041.00"));
    JsonNode eth = item(fetch(), "ETHUSD");
    assertThat(eth.get("status").asString()).isEqualTo("OPEN");
    // 卖价含加点（V24：ETHUSD 每边 0.10）：4040.004 − 0.10 = 4039.904
    assertThat(eth.get("bid").asString()).as("按品种小数位（2 位）").isEqualTo("4039.90");
    assertThat(eth.get("changePct").asString()).as("(4039.904 − 3999.90) ÷ 3999.90 = 1.0001%").isEqualTo("1.00");
    assertThat(eth.get("time").asString()).isEqualTo(NOW.toString());
  }

  @Test
  void 休市显示CLOSED_没有报价或报价异常显示NO_QUOTE_都不返回价格() throws Exception {
    processor.process(q("AAPL", "230.00", "230.10")); // 10:00 UTC 美股没开盘
    processor.process(q("XAUUSD", "4126.35", "4126.75"));
    processor.process(q("XAUUSD", "4127.00", "4126.00")); // 卖价高于买价：异常
    JsonNode body = fetch();
    JsonNode aapl = item(body, "AAPL");
    assertThat(aapl.get("status").asString()).isEqualTo("CLOSED");
    JsonNode eur = item(body, "EURUSD");
    assertThat(eur.get("status").asString()).as("从没收到过报价").isEqualTo("NO_QUOTE");
    JsonNode xau = item(body, "XAUUSD");
    assertThat(xau.get("status").asString()).as("最新报价异常，不显示上一条价格").isEqualTo("NO_QUOTE");
    for (JsonNode n : List.of(aapl, eur, xau)) {
      assertThat(n.get("bid").isNull()).as(n.toString()).isTrue();
      assertThat(n.get("changePct").isNull()).as(n.toString()).isTrue();
      assertThat(n.get("time").isNull()).as(n.toString()).isTrue();
    }
  }

  @Test
  void 结果缓存_缓存期内新报价不重新计算() throws Exception {
    // 卖价含加点（V24：BTCUSD 1 位小数，每边 10 点 = 1.0）
    processor.process(q("BTCUSD", "100000.0", "100010.0"));
    assertThat(item(fetch(), "BTCUSD").get("bid").asString()).isEqualTo("99999.0");
    processor.process(q("BTCUSD", "100100.0", "100110.0"));
    // 时钟固定，缓存（1 秒）一直有效：仍然是上一份结果
    assertThat(item(fetch(), "BTCUSD").get("bid").asString()).isEqualTo("99999.0");
    controller.clearCache();
    assertThat(item(fetch(), "BTCUSD").get("bid").asString()).isEqualTo("100099.0");
  }
}
