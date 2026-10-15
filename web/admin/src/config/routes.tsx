/**
 * 路由表（basename = /admin）。menuKey 表示该页面从哪个菜单进入：详情页归到列表菜单（AC-35 由单元测试检查）。
 */
import type { ReactNode } from 'react';
import { DashboardPage } from '../pages/DashboardPage';
import { CustomerListPage } from '../pages/customers/CustomerListPage';
import { CustomerDetailPage } from '../pages/customers/CustomerDetailPage';
import { KycListPage } from '../pages/kyc/KycListPage';
import { KycDetailPage } from '../pages/kyc/KycDetailPage';
import { DepositsPage } from '../pages/funds/DepositsPage';
import { WithdrawalsPage } from '../pages/funds/WithdrawalsPage';
import { ReconPage } from '../pages/funds/ReconPage';
import { TasksPage } from '../pages/funds/TasksPage';
import { OrdersPage } from '../pages/trading/OrdersPage';
import { PositionsPage } from '../pages/trading/PositionsPage';
import { PendingPage } from '../pages/trading/PendingPage';
import { RiskPage } from '../pages/risk/RiskPage';
import { SymbolsPage } from '../pages/market/SymbolsPage';
import { SessionsPage } from '../pages/market/SessionsPage';
import { FxPage } from '../pages/market/FxPage';
import { ParamsPage } from '../pages/params/ParamsPage';
import { TemplatesPage } from '../pages/notify/TemplatesPage';
import { SendPage } from '../pages/notify/SendPage';
import { RecordsPage } from '../pages/notify/RecordsPage';
import { AdminsPage } from '../pages/system/AdminsPage';
import { RolesPage } from '../pages/system/RolesPage';
import { MenusPage } from '../pages/system/MenusPage';
import { PermissionsPage } from '../pages/system/PermissionsPage';
import { AuditPage } from '../pages/system/AuditPage';
import { ConfigPage } from '../pages/system/ConfigPage';

export interface RouteDef {
  path: string;
  menuKey: string;
  element: ReactNode;
}

export const APP_ROUTES: RouteDef[] = [
  { path: '/dashboard', menuKey: 'dashboard', element: <DashboardPage /> },
  { path: '/customers', menuKey: 'customers', element: <CustomerListPage /> },
  { path: '/customers/:id', menuKey: 'customers', element: <CustomerDetailPage /> },
  { path: '/kyc', menuKey: 'kyc', element: <KycListPage /> },
  { path: '/kyc/:id', menuKey: 'kyc', element: <KycDetailPage /> },
  { path: '/funds/deposits', menuKey: 'deposits', element: <DepositsPage /> },
  { path: '/funds/withdrawals', menuKey: 'withdrawals', element: <WithdrawalsPage /> },
  { path: '/funds/reconciliation', menuKey: 'reconciliation', element: <ReconPage /> },
  { path: '/funds/tasks', menuKey: 'tasks', element: <TasksPage /> },
  { path: '/trading/orders', menuKey: 'orders', element: <OrdersPage /> },
  { path: '/trading/positions', menuKey: 'positions', element: <PositionsPage /> },
  { path: '/trading/pending', menuKey: 'pending', element: <PendingPage /> },
  { path: '/risk', menuKey: 'risk', element: <RiskPage /> },
  { path: '/market/symbols', menuKey: 'symbols', element: <SymbolsPage /> },
  { path: '/market/sessions', menuKey: 'sessions', element: <SessionsPage /> },
  { path: '/market/fx', menuKey: 'fx', element: <FxPage /> },
  { path: '/params', menuKey: 'params', element: <ParamsPage /> },
  { path: '/notify/templates', menuKey: 'templates', element: <TemplatesPage /> },
  { path: '/notify/send', menuKey: 'send', element: <SendPage /> },
  { path: '/notify/records', menuKey: 'records', element: <RecordsPage /> },
  { path: '/system/admins', menuKey: 'admins', element: <AdminsPage /> },
  { path: '/system/roles', menuKey: 'roles', element: <RolesPage /> },
  { path: '/system/menus', menuKey: 'menus', element: <MenusPage /> },
  { path: '/system/permissions', menuKey: 'permissions', element: <PermissionsPage /> },
  { path: '/system/audit', menuKey: 'audit', element: <AuditPage /> },
  { path: '/system/config', menuKey: 'config', element: <ConfigPage /> },
];
