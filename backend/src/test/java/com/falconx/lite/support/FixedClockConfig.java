package com.falconx.lite.support;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * 测试用固定时钟：2026-10-14（周三）10:00 UTC，外汇、指数、黄金、加密在交易时段，美股休市。
 * 交易和风控测试都 @Import 这一个类，共用同一个 Spring 上下文。
 */
@TestConfiguration
public class FixedClockConfig {

  public static final Instant NOW = Instant.parse("2026-10-14T10:00:00Z");

  @Bean
  @Primary
  Clock fixedClock() {
    return Clock.fixed(NOW, ZoneOffset.UTC);
  }
}
