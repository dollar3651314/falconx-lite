package com.falconx.lite.market.quote;

import static org.assertj.core.api.Assertions.assertThat;

import com.falconx.lite.common.health.AlertCheck;
import com.falconx.lite.common.health.AlertProperties;
import com.falconx.lite.market.MarketProperties;
import com.falconx.lite.market.config.SymbolCatalog;
import com.falconx.lite.support.FixedClockConfig;
import com.falconx.lite.support.MutableClock;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

/**
 * 行情全部断流告警（E8，AC2-20 的"模拟行情断流"）：真实的品种和交易时段（MySQL），时钟固定在 2026-10-14（周三）10:00 UTC，
 * 外汇、指数、黄金、加密开市，美股休市。
 */
@SpringBootTest
@ActiveProfiles("test")
@Import(FixedClockConfig.class)
class MarketAlertTest {

  @Autowired QuoteProcessor processor;
  @Autowired SymbolCatalog catalog;
  @Autowired MarketProperties market;
  @Autowired Clock clock;

  MutableClock clock() {
    return (MutableClock) clock;
  }

  @AfterEach
  void reset() {
    clock().reset();
  }

  MarketAlert alert(String source) {
    MarketProperties p = new MarketProperties(source, market.simulatedInterval(), market.staleAfter(), market.unchangedMaxAge(), market.maxSpreadRate(),
        market.maxTickJumpRate(), market.maxVolatilityRate(), market.volatilityWindow(), market.pushInterval(), market.fixedUsdRates());
    return new MarketAlert(processor, catalog, p, AlertProperties.defaults(), clock);
  }

  void quote(String symbol, String bid, String ask) {
    processor.process(new RawQuote(symbol, new BigDecimal(bid), new BigDecimal(ask), clock.instant()));
  }

  static AlertCheck.Item only(List<AlertCheck.Item> items) {
    assertThat(items).hasSize(1);
    assertThat(items.getFirst().name()).isEqualTo("market");
    return items.getFirst();
  }

  @Test
  void 开市品种30秒没有任何报价就告警_有报价就恢复() {
    clock().advance(Duration.ofHours(1)); // 和其他测试喂过的报价错开
    MarketAlert a = alert("simulated");
    assertThat(only(a.evaluate()).ok()).as("刚启动，从启动时间算起").isTrue();
    clock().advance(Duration.ofSeconds(31));
    AlertCheck.Item down = only(a.evaluate());
    assertThat(down.ok()).isFalse();
    assertThat(down.detail()).contains("31 秒没有收到任何报价").contains("simulated");

    quote("EURUSD", "1.08000", "1.08010");
    assertThat(only(a.evaluate()).ok()).as("一个开市品种有报价就不算全部断流").isTrue();
    clock().advance(Duration.ofSeconds(30));
    assertThat(only(a.evaluate()).ok()).as("30 秒内").isTrue();
    clock().advance(Duration.ofSeconds(1));
    assertThat(only(a.evaluate()).ok()).isFalse();
  }

  @Test
  void 只有休市品种有报价也算断流() {
    clock().advance(Duration.ofHours(2));
    MarketAlert a = alert("lp");
    clock().advance(Duration.ofSeconds(40));
    quote("AAPL", "180.00", "180.05"); // 美股这个时间休市
    assertThat(processor.lastReceived("AAPL")).as("报价年龄照样记").contains(clock.instant());
    assertThat(only(a.evaluate()).ok()).isFalse();
  }

  @Test
  void 没有报价源时不检查_测试环境的模拟报价源要检查() {
    assertThat(alert("none").evaluate()).isEmpty();
    assertThat(alert("").evaluate()).isEmpty();
    assertThat(alert("simulated").evaluate()).hasSize(1);
  }
}
