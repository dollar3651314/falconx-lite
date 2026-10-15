package com.falconx.lite.market.kline;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

/** K 线桶的起点按 UTC 向下取整（功能地图 M-10）。 */
class TimeframeTest {

  long t(String iso) {
    return Instant.parse(iso).getEpochSecond();
  }

  @Test
  void 各周期的起点() {
    long at = t("2026-10-14T13:47:29Z");
    assertThat(Timeframe.M1.bucket(at)).isEqualTo(t("2026-10-14T13:47:00Z"));
    assertThat(Timeframe.M5.bucket(at)).isEqualTo(t("2026-10-14T13:45:00Z"));
    assertThat(Timeframe.M15.bucket(at)).isEqualTo(t("2026-10-14T13:45:00Z"));
    assertThat(Timeframe.H1.bucket(at)).isEqualTo(t("2026-10-14T13:00:00Z"));
    assertThat(Timeframe.H4.bucket(at)).isEqualTo(t("2026-10-14T12:00:00Z"));
    assertThat(Timeframe.D1.bucket(at)).isEqualTo(t("2026-10-14T00:00:00Z"));
    assertThat(Timeframe.of("15m")).contains(Timeframe.M15);
    assertThat(Timeframe.of("2m")).isEmpty();
  }
}
