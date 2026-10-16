package com.falconx.lite.market.kline;

import static org.assertj.core.api.Assertions.assertThat;

import com.falconx.lite.support.FixedClockConfig;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

/** K 线保留条数（v2 第 11.2 节，AC2-19）：真实 MySQL，用一个测试专用的品种代码，测完删掉。 */
@SpringBootTest
@ActiveProfiles("test")
@Import(FixedClockConfig.class)
class KlineRetentionTest {

  @Autowired KlineRetention retention;
  @Autowired KlineMapper mapper;
  @Autowired KlineService klines;
  @Autowired JdbcTemplate jdbc;

  final String symbol = "RT" + (System.nanoTime() % 10_000_000_000L);

  @AfterEach
  void cleanup() {
    jdbc.update("DELETE FROM market_kline WHERE symbol = ?", symbol);
  }

  void bars(Timeframe tf, int n) {
    long start = 1_700_000_000L / tf.seconds * tf.seconds;
    for (int i = 0; i < n; i++) {
      BigDecimal p = BigDecimal.valueOf(100 + i);
      mapper.upsert(new Bar(symbol, tf, start + i * tf.seconds, p, p, p, p, 1));
    }
  }

  long count(Timeframe tf) {
    return mapper.count(symbol, tf.code);
  }

  @Test
  void 保留条数按需求11_2节配置() {
    assertThat(retention.limits()).containsExactly(Map.entry(Timeframe.M1, 10080), Map.entry(Timeframe.M5, 8640), Map.entry(Timeframe.M15, 8640),
        Map.entry(Timeframe.H1, 8760), Map.entry(Timeframe.H4, 4380), Map.entry(Timeframe.D1, 3650));
  }

  @Test
  void 每个周期只留最近N根_分批删除_没配置的周期不动_图表照常显示_AC2_19() {
    bars(Timeframe.M1, 25);
    bars(Timeframe.M5, 5);
    bars(Timeframe.H1, 2);
    bars(Timeframe.D1, 2);
    KlineRetention small = new KlineRetention(mapper, new KlineRetention.Props(true, "0 10 20 * * *", 7, Map.of("1m", 10, "5m", 3, "1d", 5, "2w", 1)));

    assertThat(small.purge(symbol, Timeframe.M1, 10)).as("25 根留 10 根，每批 7 行，分 3 批").isEqualTo(15);
    assertThat(count(Timeframe.M1)).isEqualTo(10);
    List<Bar> chart = klines.history(symbol, Timeframe.M1, 1000);
    assertThat(chart).as("图表照常显示，留下的是最新的 10 根，从旧到新").hasSize(10);
    assertThat(chart.getFirst().close()).isEqualByComparingTo("115");
    assertThat(chart.getLast().close()).isEqualByComparingTo("124");

    small.purge();
    assertThat(count(Timeframe.M1)).as("再清理一次不多删").isEqualTo(10);
    assertThat(count(Timeframe.M5)).isEqualTo(3);
    assertThat(count(Timeframe.H1)).as("没配置的周期不清理").isEqualTo(2);
    assertThat(count(Timeframe.D1)).as("不够条数的不删").isEqualTo(2);
  }

  @Test
  void 清理后每个品种每个周期都不超过配置的条数() {
    bars(Timeframe.M15, 12);
    bars(Timeframe.H4, 9);
    KlineRetention small = new KlineRetention(mapper, new KlineRetention.Props(true, "0 10 20 * * *", 2, Map.of("15m", 4, "4h", 4)));
    KlineRetention.Result r = small.purge();
    assertThat(r.deleted()).isGreaterThanOrEqualTo(13);
    for (String s : mapper.symbols()) {
      assertThat(mapper.count(s, "15m")).as(s).isLessThanOrEqualTo(4);
      assertThat(mapper.count(s, "4h")).as(s).isLessThanOrEqualTo(4);
    }
  }

  @Test
  void 定时任务关掉时不清理() {
    bars(Timeframe.M1, 3);
    new KlineRetention(mapper, new KlineRetention.Props(false, "0 10 20 * * *", 7, Map.of("1m", 1))).scheduled();
    assertThat(count(Timeframe.M1)).isEqualTo(3);
  }
}
