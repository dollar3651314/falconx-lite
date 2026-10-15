package com.falconx.lite.admin.security;

import java.util.List;

/**
 * 后台菜单结构（后台方案第 2 节）：固定在代码里，和后台原型 {@code web/admin/src/config/menu.tsx} 一致，每个页面都有菜单入口（AC-35，测试核对）。
 * 后台只能改顺序和是否显示（表 {@code admin_menu}）；隐藏菜单不影响权限，权限只看权限点。
 */
public final class Menus {

  /** 一个菜单项：叶子有路径和权限点，分组有子菜单 */
  public record Item(String key, String labelKey, String path, Permission permission, List<Item> children) {}

  public static final List<Item> TREE = List.of(
      leaf("dashboard", "menu.dashboard", "/dashboard", Permission.DASHBOARD_VIEW),
      leaf("customers", "menu.customers", "/customers", Permission.CUSTOMER_VIEW),
      leaf("kyc", "menu.kyc", "/kyc", Permission.KYC_VIEW),
      group("funds", "menu.funds",
          leaf("deposits", "menu.deposits", "/funds/deposits", Permission.DEPOSIT_VIEW),
          leaf("withdrawals", "menu.withdrawals", "/funds/withdrawals", Permission.WITHDRAWAL_VIEW),
          leaf("reconciliation", "menu.reconciliation", "/funds/reconciliation", Permission.RECON_VIEW),
          leaf("tasks", "menu.tasks", "/funds/tasks", Permission.TASK_VIEW)),
      group("trading", "menu.trading",
          leaf("orders", "menu.orders", "/trading/orders", Permission.ORDER_VIEW),
          leaf("positions", "menu.positions", "/trading/positions", Permission.POSITION_VIEW),
          leaf("pending", "menu.pending", "/trading/pending", Permission.PENDING_VIEW)),
      leaf("risk", "menu.risk", "/risk", Permission.RISK_VIEW),
      group("market", "menu.market",
          leaf("symbols", "menu.symbols", "/market/symbols", Permission.SYMBOL_VIEW),
          leaf("sessions", "menu.sessions", "/market/sessions", Permission.SESSION_VIEW),
          leaf("fx", "menu.fx", "/market/fx", Permission.FX_VIEW)),
      leaf("params", "menu.params", "/params", Permission.PARAMS_VIEW),
      group("notify", "menu.notify",
          leaf("templates", "menu.templates", "/notify/templates", Permission.NOTIFY_TEMPLATE_VIEW),
          leaf("send", "menu.send", "/notify/send", Permission.NOTIFY_SEND),
          leaf("records", "menu.records", "/notify/records", Permission.NOTIFY_RECORD_VIEW)),
      group("system", "menu.system",
          leaf("admins", "menu.admins", "/system/admins", Permission.ADMIN_VIEW),
          leaf("roles", "menu.roles", "/system/roles", Permission.ROLE_VIEW),
          leaf("menus", "menu.menus", "/system/menus", Permission.MENU_VIEW),
          leaf("permissions", "menu.permissions", "/system/permissions", Permission.PERMISSION_VIEW),
          leaf("audit", "menu.audit", "/system/audit", Permission.AUDIT_VIEW),
          leaf("config", "menu.config", "/system/config", Permission.CONFIG_VIEW)));

  private Menus() {}

  private static Item leaf(String key, String labelKey, String path, Permission permission) {
    return new Item(key, labelKey, path, permission, List.of());
  }

  private static Item group(String key, String labelKey, Item... children) {
    return new Item(key, labelKey, null, null, List.of(children));
  }
}
