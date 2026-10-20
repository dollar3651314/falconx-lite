package com.falconx.lite.admin.security;

import java.util.Arrays;
import java.util.Optional;

/**
 * 权限点（后台方案第 2 节）：和后台原型 {@code web/admin/src/config/permissions.ts} 一一对应（测试 {@code PermissionCatalogTest} 核对，不一致 CI 失败）。
 * highRisk 标记高危权限（修复现有系统 S6：高危权限全部登记）。
 */
public enum Permission {
  DASHBOARD_VIEW("dashboard:view", "dashboard", false),

  CUSTOMER_VIEW("customer:view", "customer", false),
  /** v2（E1）：编辑客户资料（姓名、出生日期、国籍） */
  CUSTOMER_EDIT("customer:edit", "customer", true),
  CUSTOMER_FREEZE("customer:freeze", "customer", true),
  CUSTOMER_ADJUST_BALANCE("customer:adjust_balance", "customer", true),

  KYC_VIEW("kyc:view", "kyc", false),
  KYC_REVIEW("kyc:review", "kyc", false),

  DEPOSIT_VIEW("deposit:view", "funds", false),
  WITHDRAWAL_VIEW("withdrawal:view", "funds", false),
  WITHDRAWAL_REVIEW("withdrawal:review", "funds", false),
  WITHDRAWAL_EMERGENCY_CANCEL("withdrawal:emergency_cancel", "funds", true),
  /** v2 提现自动审批：改总开关和 13 条规则（查看用 withdrawal:view）。不放进系统配置页，否则有 config:edit 的人就能绕过去放宽审核 */
  WITHDRAWAL_AUTO_RULE_EDIT("withdrawal:auto_rule_edit", "funds", true),
  RECON_VIEW("recon:view", "funds", false),
  RECON_RESOLVE("recon:resolve", "funds", false),
  /** v2 资金归集（技术方案/v2-半自动归集.md SW-12）：查看归集记录、预览、设置 */
  SWEEP_VIEW("sweep:view", "funds", false),
  /** v2 资金归集：执行归集、重试（高危，原因必填）；TRON 下一阶段的生成清单 / 导入签名 / 广播 / 作废也用它 */
  SWEEP_OPERATE("sweep:operate", "funds", true),
  /** v2 资金归集：改门槛、手续费占比上限、上线初期金额上限、发起账户余额告警下限（高危，原因必填）。以太坊、BSC 的冷钱包写在合约里，后台改不了 */
  SWEEP_CONFIG("sweep:config", "funds", true),
  TASK_VIEW("task:view", "funds", false),
  TASK_RETRY("task:retry", "funds", false),

  ORDER_VIEW("order:view", "trading", false),
  POSITION_VIEW("position:view", "trading", false),
  POSITION_LIQUIDATE("position:liquidate", "trading", true),
  PENDING_VIEW("pending:view", "trading", false),
  PENDING_FORCE_CANCEL("pending:force_cancel", "trading", true),

  RISK_VIEW("risk:view", "risk", false),
  RISK_GLOBAL_PAUSE("risk:global_pause", "risk", true),
  RISK_AUTO_LIQUIDATION("risk:auto_liquidation", "risk", true),
  RISK_SYMBOL_PAUSE("risk:symbol_pause", "risk", true),
  RISK_THRESHOLD("risk:threshold", "risk", true),
  RISK_USER_LIMIT("risk:user_limit", "risk", true),

  SYMBOL_VIEW("symbol:view", "market", false),
  SYMBOL_EDIT("symbol:edit", "market", true),
  /** v2（E3）：新增品种 */
  SYMBOL_CREATE("symbol:create", "market", true),
  SESSION_VIEW("session:view", "market", false),
  SESSION_EDIT("session:edit", "market", false),
  FX_VIEW("fx:view", "market", false),

  PARAMS_VIEW("params:view", "params", false),
  PARAMS_EDIT("params:edit", "params", true),

  NOTIFY_TEMPLATE_VIEW("notify_template:view", "notify", false),
  NOTIFY_TEMPLATE_EDIT("notify_template:edit", "notify", false),
  NOTIFY_SEND("notify:send", "notify", true),
  NOTIFY_RECORD_VIEW("notify_record:view", "notify", false),

  ADMIN_VIEW("admin:view", "system", false),
  ADMIN_EDIT("admin:edit", "system", true),
  ROLE_VIEW("role:view", "system", false),
  ROLE_EDIT("role:edit", "system", true),
  MENU_VIEW("menu:view", "system", false),
  MENU_EDIT("menu:edit", "system", false),
  PERMISSION_VIEW("permission:view", "system", false),
  AUDIT_VIEW("audit:view", "system", false),
  CONFIG_VIEW("config:view", "system", false),
  CONFIG_EDIT("config:edit", "system", true);

  public final String code;
  public final String module;
  public final boolean highRisk;

  Permission(String code, String module, boolean highRisk) {
    this.code = code;
    this.module = module;
    this.highRisk = highRisk;
  }

  public static Optional<Permission> of(String code) {
    return Arrays.stream(values()).filter(p -> p.code.equals(code)).findFirst();
  }
}
