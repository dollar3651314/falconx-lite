package com.falconx.lite.market.quote;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Tick 图用的最近逐笔报价：每个品种只留最近 500 笔，按时间从旧到新返回。 */
class RecentTicksTest {

  static final Instant T0 = Instant.parse("2026-10-14T10:00:00Z");

  static RecentTicks.Tick t(int i) {
    return new RecentTicks.Tick(T0.plusMillis(i), BigDecimal.valueOf(100 + i), BigDecimal.valueOf(101 + i));
  }

  @Test
  void 没有报价的品种返回空() {
    assertThat(new RecentTicks().recent("XAUUSD", 500)).isEmpty();
  }

  @Test
  void 超过500笔丢掉最旧的_按时间从旧到新() {
    RecentTicks r = new RecentTicks();
    for (int i = 0; i < 620; i++) r.add("XAUUSD", t(i));
    r.add("EURUSD", t(0));
    List<RecentTicks.Tick> all = r.recent("XAUUSD", 10_000);
    assertThat(all).hasSize(RecentTicks.CAPACITY);
    assertThat(all.get(0)).isEqualTo(t(120));
    assertThat(all.get(all.size() - 1)).isEqualTo(t(619));
    assertThat(r.recent("EURUSD", 500)).containsExactly(t(0));
  }

  @Test
  void limit取最近几笔_小于1按1() {
    RecentTicks r = new RecentTicks();
    for (int i = 0; i < 5; i++) r.add("XAUUSD", t(i));
    assertThat(r.recent("XAUUSD", 2)).containsExactly(t(3), t(4));
    assertThat(r.recent("XAUUSD", 0)).containsExactly(t(4));
  }
}
