package com.falconx.lite.market;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 行情参数（application.yml 的 falconx.market）。质量守卫的阈值沿用现有系统（功能地图 M-05、M-06）。
 *
 * @param source 报价源：simulated（模拟，开发和测试环境）、none（不启动，测试里直接喂报价）；LP 在 S20 接入
 * @param fixedUsdRates 没有对应外汇品种的币种用的固定汇率（例如港币，联系汇率）
 */
@ConfigurationProperties(prefix = "falconx.market")
public record MarketProperties(
    String source,
    Duration simulatedInterval,
    Duration staleAfter,
    Duration unchangedMaxAge,
    BigDecimal maxSpreadRate,
    BigDecimal maxTickJumpRate,
    BigDecimal maxVolatilityRate,
    Duration volatilityWindow,
    Duration pushInterval,
    Map<String, BigDecimal> fixedUsdRates) {}
