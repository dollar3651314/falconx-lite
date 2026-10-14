/**
 * 后台菜单（需求说明书 5.2：10 个一级菜单）。每个页面都必须在这里有入口（AC-35，由单元测试检查）。
 * Admin menu tree: 10 top-level entries; every routed page must be reachable from here.
 */
import type { ReactNode } from 'react';
import {
  AppstoreOutlined,
  TeamOutlined,
  IdcardOutlined,
  WalletOutlined,
  LineChartOutlined,
  SafetyOutlined,
  StockOutlined,
  SlidersOutlined,
  BellOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { PermissionCode } from './permissions';

export interface MenuItemDef {
  key: string;
  labelKey: string;
  icon?: ReactNode;
  /** 叶子菜单的路径（不含 /admin 前缀） */
  path?: string;
  /** 查看该页面需要的权限点 */
  permission?: PermissionCode;
  /** 菜单角标：对应 MenuBadges 的字段 */
  badge?: 'kyc' | 'withdrawals';
  children?: MenuItemDef[];
}

export const MENU: MenuItemDef[] = [
  { key: 'dashboard', labelKey: 'menu.dashboard', icon: <AppstoreOutlined />, path: '/dashboard', permission: 'dashboard:view' },
  { key: 'customers', labelKey: 'menu.customers', icon: <TeamOutlined />, path: '/customers', permission: 'customer:view' },
  { key: 'kyc', labelKey: 'menu.kyc', icon: <IdcardOutlined />, path: '/kyc', permission: 'kyc:view', badge: 'kyc' },
  {
    key: 'funds',
    labelKey: 'menu.funds',
    icon: <WalletOutlined />,
    children: [
      { key: 'deposits', labelKey: 'menu.deposits', path: '/funds/deposits', permission: 'deposit:view' },
      { key: 'withdrawals', labelKey: 'menu.withdrawals', path: '/funds/withdrawals', permission: 'withdrawal:view', badge: 'withdrawals' },
      { key: 'reconciliation', labelKey: 'menu.reconciliation', path: '/funds/reconciliation', permission: 'recon:view' },
      { key: 'tasks', labelKey: 'menu.tasks', path: '/funds/tasks', permission: 'task:view' },
    ],
  },
  {
    key: 'trading',
    labelKey: 'menu.trading',
    icon: <LineChartOutlined />,
    children: [
      { key: 'orders', labelKey: 'menu.orders', path: '/trading/orders', permission: 'order:view' },
      { key: 'positions', labelKey: 'menu.positions', path: '/trading/positions', permission: 'position:view' },
      { key: 'pending', labelKey: 'menu.pending', path: '/trading/pending', permission: 'pending:view' },
    ],
  },
  { key: 'risk', labelKey: 'menu.risk', icon: <SafetyOutlined />, path: '/risk', permission: 'risk:view' },
  {
    key: 'market',
    labelKey: 'menu.market',
    icon: <StockOutlined />,
    children: [
      { key: 'symbols', labelKey: 'menu.symbols', path: '/market/symbols', permission: 'symbol:view' },
      { key: 'sessions', labelKey: 'menu.sessions', path: '/market/sessions', permission: 'session:view' },
      { key: 'fx', labelKey: 'menu.fx', path: '/market/fx', permission: 'fx:view' },
    ],
  },
  { key: 'params', labelKey: 'menu.params', icon: <SlidersOutlined />, path: '/params', permission: 'params:view' },
  {
    key: 'notify',
    labelKey: 'menu.notify',
    icon: <BellOutlined />,
    children: [
      { key: 'templates', labelKey: 'menu.templates', path: '/notify/templates', permission: 'notify_template:view' },
      { key: 'send', labelKey: 'menu.send', path: '/notify/send', permission: 'notify:send' },
      { key: 'records', labelKey: 'menu.records', path: '/notify/records', permission: 'notify_record:view' },
    ],
  },
  {
    key: 'system',
    labelKey: 'menu.system',
    icon: <SettingOutlined />,
    children: [
      { key: 'admins', labelKey: 'menu.admins', path: '/system/admins', permission: 'admin:view' },
      { key: 'roles', labelKey: 'menu.roles', path: '/system/roles', permission: 'role:view' },
      { key: 'menus', labelKey: 'menu.menus', path: '/system/menus', permission: 'menu:view' },
      { key: 'permissions', labelKey: 'menu.permissions', path: '/system/permissions', permission: 'permission:view' },
      { key: 'audit', labelKey: 'menu.audit', path: '/system/audit', permission: 'audit:view' },
      { key: 'config', labelKey: 'menu.config', path: '/system/config', permission: 'config:view' },
    ],
  },
];

/** 所有叶子菜单（带路径） */
export function flattenMenu(items: MenuItemDef[] = MENU, parent?: MenuItemDef): (MenuItemDef & { parent?: MenuItemDef })[] {
  return items.flatMap((item) => (item.children ? flattenMenu(item.children, item) : [{ ...item, parent }]));
}

/** 根据当前路径找到对应菜单（详情页按前缀归到列表菜单） */
export function findMenuByPath(pathname: string): (MenuItemDef & { parent?: MenuItemDef }) | undefined {
  const leaves = flattenMenu();
  return leaves
    .filter((m) => m.path && (pathname === m.path || pathname.startsWith(m.path + '/')))
    .sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))[0];
}
