package com.falconx.lite.common.config;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.Optional;

/**
 * 后台可以改的系统配置（后台方案 G7）。键名和单位、分组和后台原型 {@code web/admin} 的系统配置页一致，另加 3 项提现手续费。
 * 初始值在迁移脚本 V17 里，和 application.yml 的默认值一致。
 */
public enum ConfigKey {
  WITHDRAW_MIN_AMOUNT("withdraw.minAmount", Unit.USDT, "withdraw", BigDecimal.ZERO),
  WITHDRAW_MAX_SINGLE("withdraw.maxSingle", Unit.USDT, "withdraw", BigDecimal.ONE),
  WITHDRAW_DAILY_LIMIT("withdraw.dailyLimit", Unit.USDT, "withdraw", BigDecimal.ONE),
  WITHDRAW_COOLING_HOURS("withdraw.coolingHours", Unit.HOURS, "withdraw", BigDecimal.ZERO),
  WITHDRAW_LARGE_THRESHOLD("withdraw.largeThreshold", Unit.USDT, "withdraw", BigDecimal.ONE),
  WITHDRAW_LARGE_DELAY_HOURS("withdraw.largeDelayHours", Unit.HOURS, "withdraw", BigDecimal.ZERO),
  WITHDRAW_FEE_ERC20("withdraw.fee.ERC20", Unit.USDT, "withdraw", BigDecimal.ZERO),
  WITHDRAW_FEE_TRC20("withdraw.fee.TRC20", Unit.USDT, "withdraw", BigDecimal.ZERO),
  WITHDRAW_FEE_BSC("withdraw.fee.BSC", Unit.USDT, "withdraw", BigDecimal.ZERO),
  WHITELIST_EFFECTIVE_HOURS("whitelist.effectiveHours", Unit.HOURS, "withdraw", BigDecimal.ZERO),
  WHITELIST_MAX_ADDRESSES("whitelist.maxAddresses", Unit.COUNT, "withdraw", BigDecimal.ONE),
  /** 充值确认数只能调高（后台方案 G7）：最小值就是现在的值 */
  DEPOSIT_CONFIRMATIONS_ERC20("deposit.confirmations.ERC20", Unit.COUNT, "deposit", BigDecimal.valueOf(12)),
  DEPOSIT_CONFIRMATIONS_TRC20("deposit.confirmations.TRC20", Unit.COUNT, "deposit", BigDecimal.valueOf(19)),
  DEPOSIT_CONFIRMATIONS_BSC("deposit.confirmations.BSC", Unit.COUNT, "deposit", BigDecimal.valueOf(15)),
  /** 后台管理员的登录锁定（后台方案 G2）；客户的登录锁定沿用现有系统，在 application.yml */
  LOGIN_LOCK_THRESHOLD("login.lockThreshold", Unit.COUNT, "security", BigDecimal.ONE),
  LOGIN_LOCK_MINUTES("login.lockMinutes", Unit.MINUTES, "security", BigDecimal.ONE),
  /** 后台 IP 白名单：逗号分隔的 IP 或网段，为空不限制（后台方案 G3） */
  ADMIN_IP_WHITELIST("admin.ipWhitelist", Unit.TEXT, "security", null),
  ADJUST_SINGLE_LIMIT("adjust.singleLimit", Unit.USDT, "adjust", BigDecimal.ZERO),
  ADJUST_DAILY_LIMIT("adjust.dailyLimit", Unit.USDT, "adjust", BigDecimal.ZERO),
  NOTIFY_MARGIN_CALL_THROTTLE_MINUTES("notify.marginCallThrottleMinutes", Unit.MINUTES, "notify", BigDecimal.ONE),
  /** 单个客户的持仓上限（USD 名义价值，含挂单）：在风控页改（权限 risk:user_limit），不在系统配置页 */
  RISK_PER_USER_LIMIT("risk.perUserLimitUsd", Unit.USDT, "risk", BigDecimal.ONE, false),
  /** 追保线（保证金水平 %，100 即 100%）：在交易参数页改（权限 params:edit），不在系统配置页 */
  TRADING_MARGIN_CALL_LEVEL("trading.marginCallLevel", Unit.PERCENT, "trading", BigDecimal.ONE, false);

  /** 单位，和原型一致 */
  public enum Unit {
    USDT, HOURS, MINUTES, COUNT, TEXT, PERCENT;

    public String api() {
      return name().toLowerCase();
    }
  }

  public final String key;
  public final Unit unit;
  public final String group;
  /** 数值的最小值（含）；文本为空 */
  public final BigDecimal min;
  /**
   * 是否在系统配置页显示和修改。有专门页面和权限点的（风控、交易参数）不在系统配置页，
   * 否则有 config:edit 的人可以绕过 risk:user_limit、params:edit 去改
   */
  public final boolean configPage;

  ConfigKey(String key, Unit unit, String group, BigDecimal min) {
    this(key, unit, group, min, true);
  }

  ConfigKey(String key, Unit unit, String group, BigDecimal min, boolean configPage) {
    this.key = key;
    this.unit = unit;
    this.group = group;
    this.min = min;
    this.configPage = configPage;
  }

  public static Optional<ConfigKey> of(String key) {
    return Arrays.stream(values()).filter(k -> k.key.equals(key)).findFirst();
  }

  /** 校验并规范化新值；不合法返回空。金额最多 8 位小数，小时、分钟、个数是整数 */
  public Optional<String> normalize(String value) {
    if (value == null) return Optional.empty();
    String v = value.strip();
    if (unit == Unit.TEXT) return v.length() <= 1000 ? Optional.of(v) : Optional.empty();
    try {
      BigDecimal d = new BigDecimal(v);
      if (d.compareTo(min) < 0) return Optional.empty();
      if (unit == Unit.USDT || unit == Unit.PERCENT) {
        if (d.scale() > 8 || d.compareTo(new BigDecimal("1000000000")) > 0) return Optional.empty();
        return Optional.of(d.stripTrailingZeros().toPlainString());
      }
      if (d.stripTrailingZeros().scale() > 0 || d.compareTo(BigDecimal.valueOf(100_000)) > 0) return Optional.empty();
      return Optional.of(String.valueOf(d.intValueExact()));
    } catch (NumberFormatException | ArithmeticException e) {
      return Optional.empty();
    }
  }
}
