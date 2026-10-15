package com.falconx.lite.common.config;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 系统配置（表 {@code common_config}，后台方案 G7）。各模块读配置时优先用这里的值，没有或读不出来时用调用方给的默认值（application.yml）。
 * 读取有 5 秒缓存；后台改了以后本机立即生效（多台服务器时最多晚 5 秒）。只有后台模块写。
 */
@Service
public class SystemConfig {

  private static final Logger log = LoggerFactory.getLogger(SystemConfig.class);
  private static final long CACHE_NANOS = 5_000_000_000L;

  /** 一项配置，后台列表用 */
  public record Entry(ConfigKey key, String value, Long updatedBy, LocalDateTime updatedAt) {}

  private final ConfigMapper mapper;
  private volatile Map<String, String> cache = Map.of();
  private volatile long loadedAt = Long.MIN_VALUE;

  SystemConfig(ConfigMapper mapper) {
    this.mapper = mapper;
  }

  private Map<String, String> values() {
    long now = System.nanoTime();
    if (loadedAt == Long.MIN_VALUE || now - loadedAt > CACHE_NANOS) {
      try {
        cache = mapper.all().stream().collect(Collectors.toMap(r -> r.configKey, r -> r.value));
        loadedAt = now;
      } catch (RuntimeException e) {
        log.warn("读取系统配置失败，用上一次的值：{}", e.getMessage());
      }
    }
    return cache;
  }

  public String text(ConfigKey k, String fallback) {
    String v = values().get(k.key);
    return v == null ? fallback : v;
  }

  public BigDecimal decimal(ConfigKey k, BigDecimal fallback) {
    return parse(k, fallback, BigDecimal::new);
  }

  public int integer(ConfigKey k, int fallback) {
    return parse(k, fallback, Integer::parseInt);
  }

  public Duration hours(ConfigKey k, Duration fallback) {
    return parse(k, fallback, v -> Duration.ofHours(Long.parseLong(v)));
  }

  public Duration minutes(ConfigKey k, Duration fallback) {
    return parse(k, fallback, v -> Duration.ofMinutes(Long.parseLong(v)));
  }

  private <T> T parse(ConfigKey k, T fallback, Function<String, T> f) {
    String v = values().get(k.key);
    if (v == null || v.isBlank()) return fallback;
    try {
      return f.apply(v.strip());
    } catch (RuntimeException e) {
      log.warn("系统配置 {} 的值不合法，用默认值", k.key);
      return fallback;
    }
  }

  @Transactional(readOnly = true)
  public List<Entry> list() {
    Map<String, ConfigMapper.Row> rows = mapper.all().stream().collect(Collectors.toMap(r -> r.configKey, r -> r));
    return java.util.Arrays.stream(ConfigKey.values()).map(k -> {
      ConfigMapper.Row r = rows.get(k.key);
      return new Entry(k, r == null ? "" : r.value, r == null ? null : r.updatedBy, r == null ? null : r.updatedAt);
    }).toList();
  }

  /** 保存（值已经由调用方校验过）；返回原来的值 */
  @Transactional
  public String set(ConfigKey k, String value, long adminId, LocalDateTime now) {
    ConfigMapper.Row old = mapper.lock(k.key);
    mapper.upsert(k.key, value, adminId, now);
    loadedAt = Long.MIN_VALUE;
    return old == null ? null : old.value;
  }

  /** 测试用：清掉缓存 */
  public void refresh() {
    loadedAt = Long.MIN_VALUE;
  }
}
