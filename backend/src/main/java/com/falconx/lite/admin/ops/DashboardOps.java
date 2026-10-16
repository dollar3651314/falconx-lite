package com.falconx.lite.admin.ops;

import com.falconx.lite.account.api.CustomerAdminApi;
import com.falconx.lite.admin.security.AdminContext;
import com.falconx.lite.admin.security.AdminNames;
import com.falconx.lite.admin.security.Audit;
import com.falconx.lite.common.config.ConfigKey;
import com.falconx.lite.common.config.SystemConfig;
import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.common.task.TaskService;
import com.falconx.lite.common.task.TaskStatus;
import com.falconx.lite.risk.api.RiskApi;
import com.falconx.lite.trading.api.TradingAdminApi;
import com.falconx.lite.wallet.api.WalletAdminApi;
import com.falconx.lite.wallet.api.WalletReconApi;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 后台仪表盘和交易参数（S16c）。
 * <ul>
 *   <li>"今天"按 UTC；在线客户 = 最近 5 分钟有请求的客户。</li>
 *   <li>平台盈亏 = 今天已实现的：手续费 + 隔夜费收入 − 客户已实现盈亏（对赌模式），不含浮动盈亏。</li>
 *   <li>交易参数只有追保线和追保通知间隔；强平按品种维持保证金率逐仓处理（后台方案 G6），没有账户级强平线。</li>
 * </ul>
 */
@Service
class DashboardOps {

  /** 字段和原型 DashboardStats 一致 */
  record Stats(long todayRegistrations, long onlineCustomers, String todayDeposit, long todayDepositCount, String todayWithdraw, long todayWithdrawCount,
      long openPositions, String platformPnl, String platformNetExposure, String platformThreshold, long pendingKyc, long pendingWithdrawals, long failedTasks,
      long openReconciliations, String updatedAt) {}

  /** 字段和原型 TradingParams 一致；liquidationLevel 总是空（G6：逐仓，没有账户级强平线） */
  record Params(String marginCallLevel, String liquidationLevel, int marginCallThrottleMinutes, String updatedAt, String updatedBy) {}

  record ParamsBody(String marginCallLevel, Integer marginCallThrottleMinutes, String reason) {}

  private final CustomerAdminApi customers;
  private final TradingAdminApi trading;
  private final WalletAdminApi wallet;
  private final WalletReconApi recon;
  private final RiskApi risk;
  private final TaskService tasks;
  private final SystemConfig config;
  private final AdminNames names;
  private final Audit audit;
  private final Clock clock;

  DashboardOps(CustomerAdminApi customers, TradingAdminApi trading, WalletAdminApi wallet, WalletReconApi recon, RiskApi risk, TaskService tasks,
      SystemConfig config, AdminNames names, Audit audit, Clock clock) {
    this.customers = customers;
    this.trading = trading;
    this.wallet = wallet;
    this.recon = recon;
    this.risk = risk;
    this.tasks = tasks;
    this.config = config;
    this.names = names;
    this.audit = audit;
    this.clock = clock;
  }

  @Transactional(readOnly = true)
  Stats stats() {
    LocalDateTime now = LocalDateTime.now(clock);
    LocalDateTime today = now.toLocalDate().atStartOfDay();
    WalletAdminApi.Bucket dep = wallet.creditedSince(today);
    WalletAdminApi.Bucket wd = wallet.summary(today).completedToday();
    RiskApi.Dashboard r = risk.dashboard();
    return new Stats(customers.registeredSince(today), customers.activeSince(now.minus(Duration.ofMinutes(5))), Ops.money(dep.amount()), dep.count(),
        Ops.money(wd.amount()), wd.count(), trading.openPositionTotal(), Ops.money(trading.platformRealizedSince(today)), Ops.money(r.platformNetUsd()),
        Ops.money(r.platformThreshold()), customers.pendingKyc(), wallet.pendingReview(), tasks.count(null, TaskStatus.FAILED), recon.countIssues("OPEN"),
        clock.instant().toString());
  }

  @Transactional(readOnly = true)
  Params params() {
    var entries = config.list();
    var level = entries.stream().filter(e -> e.key() == ConfigKey.TRADING_MARGIN_CALL_LEVEL).findFirst().orElseThrow();
    var throttle = entries.stream().filter(e -> e.key() == ConfigKey.NOTIFY_MARGIN_CALL_THROTTLE_MINUTES).findFirst().orElseThrow();
    // 两项里最后改的那一项的时间和人
    var last = level.updatedAt() == null || (throttle.updatedAt() != null && throttle.updatedAt().isAfter(level.updatedAt())) ? throttle : level;
    String by = last.updatedBy() == null ? null : names.of(List.of(last.updatedBy())).get(last.updatedBy());
    return new Params(level.value().isEmpty() ? "100" : level.value(), null, Integer.parseInt(throttle.value().isEmpty() ? "5" : throttle.value()),
        Ops.time(last.updatedAt()), by);
  }

  /** 改交易参数（高危）：追保线（%）、追保通知间隔（分钟） */
  @Transactional
  Params updateParams(AdminContext actor, ParamsBody body) {
    ParamsBody b = body == null ? new ParamsBody(null, null, null) : body;
    String r = Audit.requireReason(b.reason());
    ValidationException.Collector c = new ValidationException.Collector();
    String level = b.marginCallLevel() == null ? null : ConfigKey.TRADING_MARGIN_CALL_LEVEL.normalize(b.marginCallLevel()).orElse(null);
    if (b.marginCallLevel() != null && (level == null || new BigDecimal(level).compareTo(new BigDecimal("1000")) > 0)) c.add("marginCallLevel", "invalid");
    String throttle = b.marginCallThrottleMinutes() == null ? null
        : ConfigKey.NOTIFY_MARGIN_CALL_THROTTLE_MINUTES.normalize(String.valueOf(b.marginCallThrottleMinutes())).orElse(null);
    if (b.marginCallThrottleMinutes() != null && throttle == null) c.add("marginCallThrottleMinutes", "invalid");
    c.throwIfAny();
    Params before = params();
    audit.run("params.update", "trading", true, r, () -> {
      LocalDateTime now = LocalDateTime.now(clock);
      if (level != null) config.set(ConfigKey.TRADING_MARGIN_CALL_LEVEL, level, actor.adminId(), now);
      if (throttle != null) config.set(ConfigKey.NOTIFY_MARGIN_CALL_THROTTLE_MINUTES, throttle, actor.adminId(), now);
      return Audit.Change.of(null, Map.of("marginCallLevel", before.marginCallLevel(), "marginCallThrottleMinutes", before.marginCallThrottleMinutes()),
          Map.of("marginCallLevel", level == null ? before.marginCallLevel() : level, "marginCallThrottleMinutes",
              throttle == null ? before.marginCallThrottleMinutes() : Integer.parseInt(throttle)));
    });
    return params();
  }
}
