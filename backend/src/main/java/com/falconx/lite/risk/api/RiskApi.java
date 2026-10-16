package com.falconx.lite.risk.api;

import java.math.BigDecimal;
import java.util.List;

/**
 * 风控对其他模块的接口（需求 4.5）。
 * <ul>
 *   <li>交易模块只问"能不能开仓""要不要自动强平"，拿不到敞口数据；客户只会看到"该品种暂停开仓"这类原因（修复 T5）</li>
 *   <li>看板和操作给后台用（S16 做接口和审计、二次确认）</li>
 * </ul>
 */
public interface RiskApi {

  /** 平台是否暂停开仓：手动全局暂停，或平台总净敞口超阈值自动禁开。 */
  boolean globalOpenPaused();

  /** 品种是否暂停开仓：风控人员手动暂停，或品种净敞口超阈值自动禁开。（品种配置里的"暂停开仓"由行情模块管） */
  boolean symbolOpenPaused(String symbol);

  /** 自动强平开关；关闭后撮合引擎不再自动强平（止盈止损照常）。 */
  boolean autoLiquidationEnabled();

  /**
   * 通知风控人员（现在发邮件到 FX_RISK_ALERT_EMAILS；站内信和推送在 S15、S16）。给其他模块用，例如充值冲正挂账（F4）。
   *
   * @param template 邮件模板名
   */
  void notifyStaff(String template, java.util.Map<String, String> params);

  // ---------- 看板（只给后台） ----------

  /**
   * 一个品种的敞口（USD）。
   *
   * @param netUsd 多头 − 空头
   * @param threshold 阈值（净敞口绝对值）；空表示不监控
   */
  record SymbolExposure(String symbol, BigDecimal longUsd, BigDecimal shortUsd, BigDecimal netUsd, BigDecimal threshold, boolean manualPaused,
      boolean autoPaused) {}

  /**
   * 风控看板。
   *
   * @param platformNetUsd 平台总净敞口 = 各品种净敞口绝对值之和（和现有系统同一口径）
   */
  record Dashboard(List<SymbolExposure> symbols, BigDecimal platformNetUsd, BigDecimal platformThreshold, boolean globalManualPaused,
      boolean globalAutoPaused, boolean autoLiquidation) {}

  Dashboard dashboard();

  // ---------- 操作（高危，后台在 S16 加二次确认和审计日志；这里记风控事件） ----------

  void pauseSymbol(String symbol, long operatorId);

  /** 恢复品种开仓：同时清除手动暂停和自动禁开 */
  void resumeSymbol(String symbol, long operatorId);

  void pauseGlobal(long operatorId);

  /** 恢复平台开仓：同时清除手动暂停和自动禁开 */
  void resumeGlobal(long operatorId);

  void setAutoLiquidation(boolean enabled, long operatorId);

  /** 品种净敞口阈值（USD）；传空表示不监控 */
  void setSymbolThreshold(String symbol, BigDecimal threshold, long operatorId);

  /** 平台总净敞口阈值（USD）；传空表示不监控 */
  void setPlatformThreshold(BigDecimal threshold, long operatorId);

  /**
   * 一条风控事件（S16c 后台看板）。kind 见 risk_event 表注释；operatorId 为空表示系统自动。
   */
  record Event(long id, String kind, String symbol, BigDecimal netUsd, BigDecimal threshold, Long operatorId, java.time.LocalDateTime createdAt) {}

  /** 最近的风控事件，最新的在前 */
  List<Event> events(int limit);
}
