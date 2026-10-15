package com.falconx.lite.trading.order;

import java.math.BigDecimal;
import java.time.LocalTime;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * 交易参数（application.yml 的 falconx.trading）。S16 改为后台可配置。
 *
 * @param positionLimitUsd 单个用户的持仓上限：已有持仓 + 挂单 + 本单的 USD 名义价值合计（需求 4.3-4，修复 T4）
 * @param engineEnabled 是否启动撮合引擎（测试环境默认关，撮合测试里单独打开）
 * @param engineThreads 检查线程数；同一品种同一时间只占一个
 * @param engineWorkers 执行线程数：被触发的挂单、持仓并行成交或平仓；每个占一个数据库连接，要小于连接池大小
 * @param swap 隔夜费结算（S10）
 */
@ConfigurationProperties("falconx.trading")
record TradingProperties(BigDecimal positionLimitUsd, @DefaultValue("true") boolean engineEnabled, @DefaultValue("8") int engineThreads,
    @DefaultValue("8") int engineWorkers, @DefaultValue Swap swap) {

  /**
   * 隔夜费。
   *
   * @param enabled 是否定时结算（测试环境默认关，测试里直接调用）
   * @param rolloverTime 每天的结算时点（UTC），沿用现有系统的 22:00
   * @param catchUpDays 服务停机后补结算最近几天
   */
  record Swap(@DefaultValue("true") boolean enabled, @DefaultValue("22:00") LocalTime rolloverTime, @DefaultValue("3") int catchUpDays) {}
}
