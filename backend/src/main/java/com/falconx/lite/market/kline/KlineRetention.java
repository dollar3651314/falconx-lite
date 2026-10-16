package com.falconx.lite.market.kline;

import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * K 线保留条数（需求 v2 第 11.2 节，AC2-19；功能取舍对照表 M-11）：每个品种、每个周期只保留最近 N 根，超出的每天清理一次。
 * <ul>
 *   <li>条数在 application.yml 的 {@code falconx.market.kline-retention.keep}（1m 10080 ≈ 7 天、5m 8640 ≈ 30 天、15m 8640 ≈ 90 天、
 *       1h 8760 ≈ 1 年、4h 4380 ≈ 2 年、1d 3650 ≈ 10 年），可以随时改；没写的周期不清理。</li>
 *   <li>每天 UTC 20:10（北京时间 04:10，测试环境数据库备份之后）运行（{@code cron}）。</li>
 *   <li><b>分批删除</b>：每批最多 {@code batch-size}（默认 5000）行、每批一个短事务（不在外层事务里），按主键范围删，不长时间锁表，
 *       不影响正在写的新 K 线。</li>
 *   <li>只删已经收盘写进库的；当前这一根在内存里，不受影响。停用的品种也按同样的条数清理。</li>
 * </ul>
 */
@Component
@EnableConfigurationProperties(KlineRetention.Props.class)
public class KlineRetention {

  private static final Logger log = LoggerFactory.getLogger(KlineRetention.class);

  /**
   * @param enabled 是否每天自动清理（后端测试关掉，测试里直接调用）
   * @param cron 什么时候运行（UTC）
   * @param batchSize 每批最多删多少行
   * @param keep 周期（1m、5m、15m、1h、4h、1d）→ 保留条数
   */
  @ConfigurationProperties("falconx.market.kline-retention")
  public record Props(@DefaultValue("true") boolean enabled, @DefaultValue("0 10 20 * * *") String cron, @DefaultValue("5000") int batchSize,
      Map<String, Integer> keep) {}

  /** 一次清理的结果：删了多少行 */
  public record Result(long deleted, int series) {}

  private final KlineMapper mapper;
  private final Props props;

  KlineRetention(KlineMapper mapper, Props props) {
    this.mapper = mapper;
    this.props = props;
  }

  /** 周期 → 保留条数（只含配置了的、大于 0 的） */
  Map<Timeframe, Integer> limits() {
    Map<Timeframe, Integer> out = new LinkedHashMap<>();
    if (props.keep() == null) return out;
    for (var e : props.keep().entrySet()) {
      Timeframe.of(e.getKey()).ifPresentOrElse(tf -> {
        if (e.getValue() != null && e.getValue() > 0) out.put(tf, e.getValue());
      }, () -> log.warn("K 线保留条数配置里有不认识的周期：{}", e.getKey()));
    }
    return out;
  }

  @Scheduled(cron = "${falconx.market.kline-retention.cron:0 10 20 * * *}", zone = "UTC")
  void scheduled() {
    if (!props.enabled()) return;
    try {
      purge();
    } catch (RuntimeException e) {
      log.error("清理 K 线失败", e);
    }
  }

  /** 按配置清理一遍。测试里直接调用 */
  public Result purge() {
    long total = 0;
    int series = 0;
    Map<Timeframe, Integer> limits = limits();
    for (String symbol : mapper.symbols()) {
      for (var e : limits.entrySet()) {
        long n = purge(symbol, e.getKey(), e.getValue());
        if (n > 0) series++;
        total += n;
      }
    }
    log.info("K 线清理完成：删除 {} 行（{} 个品种周期超过保留条数）", total, series);
    return new Result(total, series);
  }

  /** 一个品种的一个周期只留最近 keep 根，返回删除的行数 */
  long purge(String symbol, Timeframe tf, int keep) {
    Long cutoff = mapper.cutoff(symbol, tf.code, keep);
    if (cutoff == null) return 0;
    int batch = Math.max(1, props.batchSize());
    long deleted = 0;
    while (true) {
      int n = mapper.deleteUpTo(symbol, tf.code, cutoff, batch);
      deleted += n;
      if (n < batch) return deleted;
    }
  }
}
