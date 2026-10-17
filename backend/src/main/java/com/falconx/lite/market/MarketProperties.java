package com.falconx.lite.market;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 行情参数（application.yml 的 falconx.market）。质量守卫的阈值沿用现有系统（功能地图 M-05、M-06）。
 *
 * @param source 报价模式：none（不启动，测试里直接喂报价）、simulated（开发和测试环境：配了 token 的真实报价源接管它覆盖的品种，其余模拟）、
 *     live（只用真实报价源）；真实报价源见 {@code quote.feed}（技术方案/v2-报价源接入.md）
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
