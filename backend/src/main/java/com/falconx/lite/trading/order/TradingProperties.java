package com.falconx.lite.trading.order;

import java.math.BigDecimal;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * 交易参数（application.yml 的 falconx.trading）。S16 改为后台可配置。
 *
 * @param positionLimitUsd 单个用户的持仓上限：已有持仓 + 挂单 + 本单的 USD 名义价值合计（需求 4.3-4，修复 T4）
 * @param engineEnabled 是否启动撮合引擎（测试环境默认关，撮合测试里单独打开）
 * @param engineThreads 检查线程数；同一品种同一时间只占一个
 * @param engineWorkers 执行线程数：被触发的挂单、持仓并行成交或平仓；每个占一个数据库连接，要小于连接池大小
 */
@ConfigurationProperties("falconx.trading")
record TradingProperties(BigDecimal positionLimitUsd, @DefaultValue("true") boolean engineEnabled, @DefaultValue("8") int engineThreads,
    @DefaultValue("8") int engineWorkers) {}
