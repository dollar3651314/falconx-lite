package com.falconx.lite.market.quote;

import static org.assertj.core.api.Assertions.assertThat;

import com.falconx.lite.market.MarketProperties;
import com.falconx.lite.market.api.QuoteStatus;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** 质量守卫的每条规则（沿用现有系统阈值：点差 5%、时间偏差 5 秒、不变 1 分钟、跳变 10%、60 秒波动 5%）。 */
class QualityGuardTest {

  static final MarketProperties P = new MarketProperties("none", Duration.ofMillis(500), Duration.ofSeconds(5), Duration.ofMinutes(1),
      new BigDecimal("0.05"), new BigDecimal("0.10"), new BigDecimal("0.05"), Duration.ofSeconds(60), Duration.ofMillis(250), Map.of());
  static final Instant T0 = Instant.parse("2026-10-14T10:00:00Z");

  static RawQuote q(String bid, String ask, Instant at) {
    return new RawQuote("EURUSD", new BigDecimal(bid), new BigDecimal(ask), at);
  }

  @Test
  void 正常报价是FRESH() {
    assertThat(new QualityGuard(P).evaluate(q("1.1000", "1.1002", T0), T0)).isEqualTo(QuoteStatus.FRESH);
  }

  @Test
  void 价格非正_买卖倒挂_点差过大是ABNORMAL() {
    QualityGuard g = new QualityGuard(P);
    assertThat(g.evaluate(q("0", "1.1", T0), T0)).isEqualTo(QuoteStatus.ABNORMAL);
    assertThat(g.evaluate(q("1.1002", "1.1000", T0), T0)).isEqualTo(QuoteStatus.ABNORMAL);
    assertThat(g.evaluate(q("1.00", "1.06", T0), T0)).isEqualTo(QuoteStatus.ABNORMAL);
  }

  @Test
  void 报价时间偏差超过5秒是STALE() {
    assertThat(new QualityGuard(P).evaluate(q("1.1000", "1.1002", T0.minusSeconds(6)), T0)).isEqualTo(QuoteStatus.STALE);
  }

  @Test
  void 价格超过1分钟不变是NO_QUOTE() {
    QualityGuard g = new QualityGuard(P);
    g.evaluate(q("1.1000", "1.1002", T0), T0);
    Instant later = T0.plusSeconds(61);
    assertThat(g.evaluate(q("1.1000", "1.1002", later), later)).isEqualTo(QuoteStatus.NO_QUOTE);
    assertThat(g.evaluate(q("1.1001", "1.1003", later), later)).as("价格变了就恢复").isEqualTo(QuoteStatus.FRESH);
  }

  @Test
  void 单次跳变超过10百分比是ABNORMAL() {
    QualityGuard g = new QualityGuard(P);
    g.evaluate(q("1.0000", "1.0002", T0), T0);
    assertThat(g.evaluate(q("1.1100", "1.1102", T0.plusSeconds(1)), T0.plusSeconds(1))).isEqualTo(QuoteStatus.ABNORMAL);
  }

  @Test
  void 六十秒内波动超过5百分比是ABNORMAL() {
    QualityGuard g = new QualityGuard(P);
    String[] steps = {"1.0000", "1.0300", "1.0600"};
    QuoteStatus last = null;
    for (int i = 0; i < steps.length; i++) {
      Instant at = T0.plusSeconds(i * 10L);
      BigDecimal bid = new BigDecimal(steps[i]);
      last = g.evaluate(new RawQuote("EURUSD", bid, bid.add(new BigDecimal("0.0002")), at), at);
    }
    assertThat(last).isEqualTo(QuoteStatus.ABNORMAL);
  }
}
