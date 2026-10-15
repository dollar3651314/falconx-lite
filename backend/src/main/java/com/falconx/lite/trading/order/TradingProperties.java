package com.falconx.lite.trading.order;

import java.math.BigDecimal;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 交易参数（application.yml 的 falconx.trading）。S16 改为后台可配置。
 *
 * @param positionLimitUsd 单个用户的持仓上限：已有持仓 + 挂单 + 本单的 USD 名义价值合计（需求 4.3-4，修复 T4）
 */
@ConfigurationProperties("falconx.trading")
record TradingProperties(BigDecimal positionLimitUsd) {}
