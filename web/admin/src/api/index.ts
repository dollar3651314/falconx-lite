/**
 * 后台数据接口（页面只能通过这里取数据）。
 * 原型阶段由 src/mocks 的内存实现提供；正式开发时把下面每个函数换成对后端的 HTTP 调用即可，签名不变。
 * 注释里是计划中的真实接口路径（以《技术方案》为准）。
 *
 * Admin data API. Pages import from here only; the prototype is backed by in-memory mocks.
 */
import * as mock from '../mocks/handlers';
import * as runtime from '../mocks/runtime';

export type { CurrentAdmin, ProtoIdentity } from '../mocks/handlers';
export type { Scenario } from '../mocks/runtime';

// ---- 认证 ----
/** POST /admin/api/auth/login */
export const login = mock.login;
/** POST /admin/api/auth/password */
export const changePassword = mock.changePassword;
/** GET /admin/api/me（当前管理员、角色、权限点） */
export const getCurrentAdmin = mock.getCurrentAdmin;
/** 原型专用：切换演示身份（正式版没有这个接口） */
export const switchIdentity = mock.switchIdentity;

// ---- 仪表盘 ----
/** GET /admin/api/dashboard */
export const getDashboard = mock.getDashboard;
/** GET /admin/api/menu-badges */
export const getMenuBadges = mock.getMenuBadges;

// ---- 客户 ----
/** GET /admin/api/customers */
export const listCustomers = mock.listCustomers;
/** GET /admin/api/customers/{id} */
export const getCustomer = mock.getCustomer;
/** POST /admin/api/customers/{id}/freeze | /unfreeze（高危） */
export const setCustomerFrozen = mock.setCustomerFrozen;
/** GET /admin/api/customers/balance-adjust-limits */
export const getAdjustLimits = mock.getAdjustLimits;
/** POST /admin/api/customers/{id}/balance-adjustments（高危） */
export const adjustBalance = mock.adjustBalance;
/** GET /admin/api/customers?keyword=（下拉搜索用） */
export const searchCustomers = mock.searchCustomers;

// ---- KYC ----
/** GET /admin/api/kyc */
export const listKyc = mock.listKyc;
/** GET /admin/api/kyc/{id} */
export const getKyc = mock.getKyc;
/** POST /admin/api/kyc/{id}/approve | /reject */
export const reviewKyc = mock.reviewKyc;

// ---- 资金 ----
/** GET /admin/api/deposits */
export const listDeposits = mock.listDeposits;
/** GET /admin/api/withdrawals */
export const listWithdrawals = mock.listWithdrawals;
/** GET /admin/api/withdrawals/summary */
export const getWithdrawalSummary = mock.getWithdrawalSummary;
/** GET /admin/api/withdrawals/{id} */
export const getWithdrawal = mock.getWithdrawal;
/** POST /admin/api/withdrawals/{id}/approve */
export const approveWithdrawal = mock.approveWithdrawal;
/** POST /admin/api/withdrawals/{id}/reject */
export const rejectWithdrawal = mock.rejectWithdrawal;
/** POST /admin/api/withdrawals/{id}/emergency-cancel（高危） */
export const emergencyCancelWithdrawal = mock.emergencyCancelWithdrawal;
/** GET /admin/api/reconciliations */
export const listRecon = mock.listRecon;
/** POST /admin/api/reconciliations/{id}/resolve */
export const resolveRecon = mock.resolveRecon;
/** GET /admin/api/tasks */
export const listTasks = mock.listTasks;
/** POST /admin/api/tasks/{id}/retry */
export const retryTask = mock.retryTask;

// ---- 交易监控 ----
/** GET /admin/api/orders */
export const listOrders = mock.listOrders;
/** GET /admin/api/positions */
export const listPositions = mock.listPositions;
/** POST /admin/api/positions/{id}/liquidate（高危） */
export const liquidatePosition = mock.liquidatePosition;
/** GET /admin/api/pending-orders */
export const listPendingOrders = mock.listPendingOrders;
/** POST /admin/api/pending-orders/{id}/force-cancel（高危） */
export const forceCancelPending = mock.forceCancelPending;
/** GET /admin/api/symbols/codes */
export const listTradeSymbols = mock.listTradeSymbols;

// ---- 风控 ----
/** GET /admin/api/risk/overview */
export const getRiskOverview = mock.getRiskOverview;
/** PUT /admin/api/risk/global-pause（高危） */
export const setGlobalPause = mock.setGlobalPause;
/** PUT /admin/api/risk/auto-liquidation（高危） */
export const setAutoLiquidation = mock.setAutoLiquidation;
/** PUT /admin/api/risk/symbols/{symbol}/pause（高危） */
export const setSymbolPaused = mock.setSymbolPaused;
/** PUT /admin/api/risk/symbols/{symbol}/threshold（高危） */
export const setSymbolThreshold = mock.setSymbolThreshold;
/** PUT /admin/api/risk/platform-threshold（高危） */
export const setPlatformThreshold = mock.setPlatformThreshold;
/** PUT /admin/api/risk/user-limit（高危） */
export const setPerUserLimit = mock.setPerUserLimit;

// ---- 品种与行情 ----
/** GET /admin/api/symbols */
export const listSymbols = mock.listSymbols;
/** PUT /admin/api/symbols/{code}（高危） */
export const updateSymbol = mock.updateSymbol;
/** PUT /admin/api/symbols/{code}/enabled（高危） */
export const setSymbolEnabled = mock.setSymbolEnabled;
/** GET /admin/api/sessions */
export const listSessions = mock.listSessions;
/** GET /admin/api/holidays */
export const listHolidays = mock.listHolidays;
/** POST /admin/api/holidays */
export const addHoliday = mock.addHoliday;
/** DELETE /admin/api/holidays/{id} */
export const deleteHoliday = mock.deleteHoliday;
/** GET /admin/api/fx-rates */
export const listFxRates = mock.listFxRates;

// ---- 交易参数 ----
/** GET /admin/api/trading-params */
export const getTradingParams = mock.getTradingParams;
/** PUT /admin/api/trading-params（高危） */
export const updateTradingParams = mock.updateTradingParams;

// ---- 通知 ----
/** GET /admin/api/notify/templates */
export const listTemplates = mock.listTemplates;
/** PUT /admin/api/notify/templates/{id} */
export const updateTemplate = mock.updateTemplate;
/** POST /admin/api/notify/manual（高危） */
export const sendManualNotification = mock.sendManualNotification;
/** GET /admin/api/notify/records */
export const listNotifyRecords = mock.listNotifyRecords;

// ---- 系统 ----
/** GET /admin/api/admins */
export const listAdmins = mock.listAdmins;
/** POST /admin/api/admins（高危） */
export const createAdmin = mock.createAdmin;
/** PUT /admin/api/admins/{id}（高危） */
export const updateAdmin = mock.updateAdmin;
/** PUT /admin/api/admins/{id}/status（高危） */
export const setAdminStatus = mock.setAdminStatus;
/** POST /admin/api/admins/{id}/reset-password（高危；临时密码通过邮件发给本人） */
export const resetAdminPassword = mock.resetAdminPassword;
/** GET /admin/api/roles */
export const listRoles = mock.listRoles;
/** POST /admin/api/roles | PUT /admin/api/roles/{id}（高危） */
export const saveRole = mock.saveRole;
/** DELETE /admin/api/roles/{id}（高危） */
export const deleteRole = mock.deleteRole;
/** GET /admin/api/menus */
export const listMenus = mock.listMenus;
/** PUT /admin/api/menus/{key} */
export const updateMenu = mock.updateMenu;
/** GET /admin/api/permissions */
export const listPermissions = mock.listPermissions;
/** GET /admin/api/audit-logs */
export const listAuditLogs = mock.listAuditLogs;
/** GET /admin/api/audit-logs/actions */
export const listAuditActions = mock.listAuditActions;
/** GET /admin/api/configs */
export const listSystemConfigs = mock.listSystemConfigs;
/** PUT /admin/api/configs/{key}（高危） */
export const updateSystemConfig = mock.updateSystemConfig;

// ---- 原型场景（只在原型里存在） ----
export const proto = {
  getScenario: runtime.getScenario,
  setScenario: runtime.setScenario,
  subscribeScenario: runtime.subscribeScenario,
  getScenarioVersion: runtime.getScenarioVersion,
};
