package com.falconx.lite.admin.ops;

import com.falconx.lite.admin.security.AdminContext;
import com.falconx.lite.admin.security.AdminNames;
import com.falconx.lite.admin.security.Audit;
import com.falconx.lite.common.config.ConfigKey;
import com.falconx.lite.common.config.SystemConfig;
import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.risk.api.RiskApi;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 后台"风控"（S16c）：看板（品种敞口、平台设置、风控事件）和操作（全局暂停、自动强平开关、品种暂停、阈值、单客户持仓上限）。
 * 操作都是高危，必须填原因；风控事件在风控模块里记，审计在这里记。风控数据不发给客户（约定 4）。
 */
@Service
class RiskOps {

  /** 达到阈值的 80% 显示为"接近" */
  private static final BigDecimal NEAR = new BigDecimal("0.8");

  /** 字段和原型 SymbolExposure 一致；thresholdUsd 为空表示不监控 */
  record ExposureView(String symbol, String nameZh, String nameEn, String longUsd, String shortUsd, String netUsd, String thresholdUsd, String status) {}

  /** 字段和原型 RiskSettings 一致 */
  record Settings(boolean globalPause, boolean autoLiquidation, String platformNetUsd, String platformThresholdUsd, boolean platformBlocked,
      String perUserLimitUsd, String updatedAt) {}

  /** 字段和原型 RiskEvent 一致；value 是当时的净敞口 */
  record EventView(String id, String time, String actorType, String actorName, String type, String symbol, String value, String threshold, String reason) {}

  record Overview(List<ExposureView> symbols, Settings settings, List<EventView> events) {}

  private final RiskApi risk;
  private final MarketApi market;
  private final SystemConfig config;
  private final AdminNames names;
  private final Audit audit;
  private final Clock clock;
  private final BigDecimal defaultLimit;

  RiskOps(RiskApi risk, MarketApi market, SystemConfig config, AdminNames names, Audit audit, Clock clock,
      @org.springframework.beans.factory.annotation.Value("${falconx.trading.position-limit-usd:3000000}") BigDecimal defaultLimit) {
    this.risk = risk;
    this.market = market;
    this.config = config;
    this.names = names;
    this.audit = audit;
    this.clock = clock;
    this.defaultLimit = defaultLimit;
  }

  static String status(RiskApi.SymbolExposure e) {
    if (e.manualPaused()) return "manual_paused";
    if (e.autoPaused()) return "auto_blocked";
    if (e.threshold() != null && e.threshold().signum() > 0 && e.netUsd().abs().compareTo(e.threshold().multiply(NEAR)) >= 0) return "near";
    return "normal";
  }

  static String eventType(String kind) {
    return switch (kind) {
      case "AUTO_PAUSE_SYMBOL" -> "auto_block_symbol";
      case "AUTO_PAUSE_GLOBAL" -> "auto_block_platform";
      case "PAUSE_SYMBOL" -> "manual_pause";
      case "RESUME_SYMBOL" -> "manual_resume";
      case "PAUSE_GLOBAL" -> "global_pause_on";
      case "RESUME_GLOBAL" -> "global_pause_off";
      case "AUTO_LIQUIDATION_ON" -> "auto_liq_on";
      case "AUTO_LIQUIDATION_OFF" -> "auto_liq_off";
      case "THRESHOLD" -> "threshold_change";
      default -> kind.toLowerCase();
    };
  }

  BigDecimal perUserLimit() {
    return config.decimal(ConfigKey.RISK_PER_USER_LIMIT, defaultLimit);
  }

  @Transactional(readOnly = true)
  Overview overview() {
    RiskApi.Dashboard d = risk.dashboard();
    Map<String, SymbolSpec> specs = new HashMap<>();
    for (SymbolSpec s : market.symbols()) specs.put(s.code(), s);
    List<ExposureView> symbols = d.symbols().stream().map(e -> {
      SymbolSpec s = specs.get(e.symbol());
      return new ExposureView(e.symbol(), s == null ? e.symbol() : s.nameZh(), s == null ? e.symbol() : s.nameEn(), Ops.money(e.longUsd()), Ops.money(e.shortUsd()),
          Ops.money(e.netUsd()), Ops.money(e.threshold()), status(e));
    }).toList();
    Settings settings = new Settings(d.globalManualPaused(), d.autoLiquidation(), Ops.money(d.platformNetUsd()), Ops.money(d.platformThreshold()),
        d.globalAutoPaused(), Ops.money(perUserLimit()), null);
    List<RiskApi.Event> events = risk.events(50);
    Map<Long, String> ops = names.of(events.stream().map(RiskApi.Event::operatorId).filter(Objects::nonNull).toList());
    List<EventView> ev = events.stream().map(e -> new EventView(String.valueOf(e.id()), Ops.time(e.createdAt()), e.operatorId() == null ? "system" : "admin",
        e.operatorId() == null ? null : ops.get(e.operatorId()), eventType(e.kind()), e.symbol(), Ops.money(e.netUsd()), Ops.money(e.threshold()), null)).toList();
    return new Overview(symbols, settings, ev);
  }

  /** 全局暂停开仓 / 恢复（恢复同时清除自动禁开） */
  void setGlobalPause(AdminContext actor, boolean paused, String reason) {
    String r = Audit.requireReason(reason);
    audit.run(paused ? "risk.global_pause" : "risk.global_resume", "*", true, r, () -> {
      boolean before = risk.dashboard().globalManualPaused();
      if (paused) risk.pauseGlobal(actor.adminId());
      else risk.resumeGlobal(actor.adminId());
      return Audit.Change.of(null, Map.of("globalPause", before), Map.of("globalPause", paused));
    });
  }

  void setAutoLiquidation(AdminContext actor, boolean enabled, String reason) {
    String r = Audit.requireReason(reason);
    audit.run("risk.auto_liquidation", "*", true, r, () -> {
      boolean before = risk.autoLiquidationEnabled();
      risk.setAutoLiquidation(enabled, actor.adminId());
      return Audit.Change.of(null, Map.of("autoLiquidation", before), Map.of("autoLiquidation", enabled));
    });
  }

  private String requireSymbol(String symbol) {
    String s = symbol == null ? "" : symbol.strip().toUpperCase();
    if (market.symbol(s).isEmpty()) throw new BizException("NOT_FOUND", "品种不存在");
    return s;
  }

  /** 暂停品种开仓 / 恢复（恢复同时清除自动禁开） */
  void setSymbolPaused(AdminContext actor, String symbol, boolean paused, String reason) {
    String r = Audit.requireReason(reason);
    audit.run(paused ? "risk.symbol_pause" : "risk.symbol_resume", symbol, true, r, () -> {
      String s = requireSymbol(symbol);
      if (paused) risk.pauseSymbol(s, actor.adminId());
      else risk.resumeSymbol(s, actor.adminId());
      return Audit.Change.of(null, null, Map.of("paused", paused));
    });
  }

  /** 阈值：空表示不监控；不能为负 */
  private static BigDecimal threshold(String v) {
    if (v == null || v.isBlank()) return null;
    try {
      BigDecimal d = new BigDecimal(v.strip());
      if (d.signum() > 0 && d.stripTrailingZeros().scale() <= 2) return d;
    } catch (NumberFormatException e) {
      // 落到下面
    }
    throw new ValidationException(List.of(new ValidationException.Field("threshold", "invalid")));
  }

  void setSymbolThreshold(AdminContext actor, String symbol, String value, String reason) {
    String r = Audit.requireReason(reason);
    BigDecimal t = threshold(value);
    audit.run("risk.symbol_threshold", symbol, true, r, () -> {
      String s = requireSymbol(symbol);
      BigDecimal before = null;
      for (RiskApi.SymbolExposure e : risk.dashboard().symbols()) if (e.symbol().equals(s)) before = e.threshold();
      BigDecimal old = before;
      risk.setSymbolThreshold(s, t, actor.adminId());
      return Audit.Change.of(null, map("threshold", Ops.money(old)), map("threshold", Ops.money(t)));
    });
  }

  void setPlatformThreshold(AdminContext actor, String value, String reason) {
    String r = Audit.requireReason(reason);
    BigDecimal t = threshold(value);
    audit.run("risk.platform_threshold", "*", true, r, () -> {
      BigDecimal before = risk.dashboard().platformThreshold();
      risk.setPlatformThreshold(t, actor.adminId());
      return Audit.Change.of(null, map("threshold", Ops.money(before)), map("threshold", Ops.money(t)));
    });
  }

  /** 单个客户的持仓上限（USD 名义价值，含挂单） */
  void setPerUserLimit(AdminContext actor, String value, String reason) {
    String r = Audit.requireReason(reason);
    String v = ConfigKey.RISK_PER_USER_LIMIT.normalize(value)
        .orElseThrow(() -> new ValidationException(List.of(new ValidationException.Field("limit", "invalid"))));
    audit.run("risk.per_user_limit", "*", true, r, () -> {
      BigDecimal before = perUserLimit();
      config.set(ConfigKey.RISK_PER_USER_LIMIT, v, actor.adminId(), LocalDateTime.now(clock));
      return Audit.Change.of(null, Map.of("limit", Ops.money(before)), Map.of("limit", v));
    });
  }

  /** Map.of 不能放空值 */
  private static Map<String, Object> map(String k, Object v) {
    Map<String, Object> m = new HashMap<>();
    m.put(k, v);
    return m;
  }
}
