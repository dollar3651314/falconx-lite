/**
 * 后台真实接口：S18a 登录、当前管理员、菜单角标、系统菜单、客户、KYC、资金、通知；S18b 仪表盘、交易监控、风控、品种与行情、交易参数。
 * 路径、参数、字段以后端为准（`backend/src/main/java/com/falconx/lite/admin/`，《项目索引》第 2.8 节）；
 * 和原型字段不同的地方按《技术方案/v1-后台方案.md》第 7、8、9 节在这里转换，页面拿到的仍是 api/types.ts 的类型。
 *
 * Real admin API. Shapes follow the backend; prototype differences are adapted here.
 */
import { API_BASE, request } from './http';
import type {
  AdjustLimits,
  AdminInput,
  AdminSession,
  AdminUser,
  AuditLog,
  AuditQuery,
  CurrentAdmin,
  CustomerDetail,
  CustomerProfileInput,
  CustomerQuery,
  CustomerSummary,
  DashboardStats,
  Deposit,
  DepositQuery,
  FxRate,
  Holiday,
  HolidayInput,
  KycApplication,
  KycQuery,
  ManualNotifyInput,
  MenuBadges,
  MenuNode,
  NotifyRecord,
  NotifyRecordQuery,
  NotifyTemplate,
  Order,
  Page,
  PageQuery,
  PendingOrder,
  PermissionDef,
  Position,
  HotWalletBalance,
  ReconItem,
  ReconQuery,
  RiskEvent,
  RiskOverview,
  RiskSettings,
  Role,
  RoleInput,
  SymbolCreateInput,
  SymbolExposure,
  SymbolPage,
  SymbolPatch,
  SymbolQuery,
  SystemConfig,
  TaskItem,
  TaskQuery,
  TemporaryPassword,
  TradeQuery,
  TradingParams,
  TradingParamsInput,
  TradingSession,
  TradingSymbol,
  Withdrawal,
  WithdrawalDetail,
  WithdrawalQuery,
  WithdrawalSummary,
} from './types';

const enc = encodeURIComponent;

/** 后端的叶子菜单 children 是空数组，表格和菜单按"没有子菜单"处理 */
export function normalizeMenus(nodes: MenuNode[] | null | undefined): MenuNode[] {
  return (nodes ?? []).map((n) => {
    const children = n.children && n.children.length ? normalizeMenus(n.children) : undefined;
    const { children: _c, ...rest } = n;
    void _c;
    return children ? { ...rest, children } : rest;
  });
}

// ---------- 认证 ----------
export function login(username: string, password: string): Promise<AdminSession> {
  return request<AdminSession>('/auth/login', { method: 'POST', body: { username, password }, silentAuth: true });
}

export async function logout(): Promise<void> {
  await request<void>('/auth/logout', { method: 'POST', silentAuth: true });
}

/** 改密码：成功后其他设备退出，当前设备的 Cookie 换新 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await request<void>('/auth/change-password', { method: 'POST', body: { oldPassword, newPassword } });
}

export async function getCurrentAdmin(): Promise<CurrentAdmin> {
  const me = await request<CurrentAdmin>('/me', { silentAuth: true });
  return { ...me, menus: normalizeMenus(me.menus) };
}

export function getMenuBadges(): Promise<MenuBadges> {
  return request<MenuBadges>('/menu-badges');
}

// ---------- 客户 ----------
export function listCustomers(q: CustomerQuery): Promise<Page<CustomerSummary>> {
  return request('/customers', { query: { keyword: q.keyword, status: q.status, kycStatus: q.kycStatus, page: q.page, pageSize: q.pageSize } });
}

export function getCustomer(id: number): Promise<CustomerDetail> {
  return request(`/customers/${id}`);
}

/** 冻结 / 解冻（必须填原因，AC-04） */
export async function setCustomerFrozen(id: number, frozen: boolean, reason: string): Promise<void> {
  await request(`/customers/${id}/freeze`, { method: 'POST', body: { frozen, reason } });
}

/** 编辑客户资料（v2 E1，必须填原因）：姓名、出生日期、国籍；返回更新后的详情 */
export function updateCustomerProfile(id: number, input: CustomerProfileInput, reason: string): Promise<CustomerDetail> {
  return request(`/customers/${id}/profile`, { method: 'PUT', body: { ...input, reason } });
}

export function getAdjustLimits(): Promise<AdjustLimits> {
  return request('/customers/adjust-limits');
}

/** 调余额（必须填原因，G5） */
export async function adjustBalance(id: number, direction: 'credit' | 'debit', amount: string, reason: string): Promise<void> {
  await request(`/customers/${id}/adjust`, { method: 'POST', body: { direction, amount, reason } });
}

/** 发通知时选客户（权限点 notify:send） */
export function searchCustomers(keyword: string): Promise<CustomerSummary[]> {
  return request('/customers/search', { query: { keyword } });
}

// ---------- KYC ----------
export function listKyc(q: KycQuery): Promise<Page<KycApplication>> {
  return request('/kyc', { query: { status: q.status, keyword: q.keyword, page: q.page, pageSize: q.pageSize } });
}

export function getKyc(id: string): Promise<KycApplication> {
  return request(`/kyc/${enc(id)}`);
}

/** 通过，或驳回（驳回必须填原因，AC-05） */
export async function reviewKyc(id: string, approve: boolean, reason?: string): Promise<void> {
  await request(`/kyc/${enc(id)}/review`, { method: 'POST', body: approve ? { approve: true } : { approve: false, reason } });
}

/** 证件照片地址（后台方案第 8 节）：同源 Cookie 鉴权，不允许浏览器缓存 */
export function kycImageUrl(id: string, side: 'front' | 'back' | 'selfie'): string | null {
  return `${API_BASE}/kyc/${enc(id)}/images/${side}`;
}

// ---------- 资金 ----------
export function listDeposits(q: DepositQuery): Promise<Page<Deposit>> {
  return request('/deposits', { query: { chain: q.chain, status: q.status, keyword: q.keyword, page: q.page, pageSize: q.pageSize } });
}

export function listWithdrawals(q: WithdrawalQuery): Promise<Page<Withdrawal>> {
  return request('/withdrawals', {
    query: { status: q.status, chain: q.chain, minAmount: q.minAmount, maxAmount: q.maxAmount, keyword: q.keyword, page: q.page, pageSize: q.pageSize },
  });
}

export function getWithdrawalSummary(): Promise<WithdrawalSummary> {
  return request('/withdrawals/summary');
}

/** 后端详情是 {withdrawal: {...}, kycStatus, ...}，原型是平铺的，这里展开 */
export async function getWithdrawal(id: string): Promise<WithdrawalDetail> {
  const d = await request<Omit<WithdrawalDetail, keyof Withdrawal> & { withdrawal: Withdrawal }>(`/withdrawals/${enc(id)}`);
  const { withdrawal, ...rest } = d;
  return { ...withdrawal, ...rest };
}

export function approveWithdrawal(id: string): Promise<Withdrawal> {
  return request(`/withdrawals/${enc(id)}/approve`, { method: 'POST' });
}

export function rejectWithdrawal(id: string, reason: string): Promise<Withdrawal> {
  return request(`/withdrawals/${enc(id)}/reject`, { method: 'POST', body: { reason } });
}

/** 大额延迟期内紧急取消（必须填原因，AC-21） */
export function emergencyCancelWithdrawal(id: string, reason: string): Promise<Withdrawal> {
  return request(`/withdrawals/${enc(id)}/emergency-cancel`, { method: 'POST', body: { reason } });
}

/** 对账问题（字段按后台方案第 8 节）；后端只支持按状态筛选 */
export function listRecon(q: ReconQuery): Promise<Page<ReconItem>> {
  return request('/recon', { query: { status: q.status, page: q.page, pageSize: q.pageSize } });
}

/** 热钱包当前余额和告警下限（对账页上方）；下限在系统配置页改 */
export function listHotWallets(): Promise<HotWalletBalance[]> {
  return request('/hot-wallets');
}

/** 标记已处理：说明字段是 note（F5） */
export async function resolveRecon(id: string, note: string): Promise<void> {
  await request(`/recon/${enc(id)}/resolve`, { method: 'POST', body: { note } });
}

export function listTasks(q: TaskQuery): Promise<Page<TaskItem>> {
  return request('/tasks', { query: { type: q.type, status: q.status, page: q.page, pageSize: q.pageSize } });
}

export async function retryTask(id: string): Promise<void> {
  await request(`/tasks/${enc(id)}/retry`, { method: 'POST' });
}

// ---------- 通知 ----------
export function listTemplates(): Promise<NotifyTemplate[]> {
  return request('/notify/templates');
}

/** id 就是模板编号 */
export async function updateTemplate(id: string, patch: Partial<Pick<NotifyTemplate, 'titleZh' | 'bodyZh' | 'titleEn' | 'bodyEn' | 'enabled'>>): Promise<void> {
  await request(`/notify/templates/${enc(id)}`, { method: 'PUT', body: patch });
}

export async function sendManualNotification(input: ManualNotifyInput): Promise<void> {
  await request('/notify/send', { method: 'POST', body: input });
}

export function listNotifyRecords(q: NotifyRecordQuery): Promise<Page<NotifyRecord>> {
  return request('/notify/records', { query: { channel: q.channel, status: q.status, keyword: q.keyword, page: q.page, pageSize: q.pageSize } });
}

// ---------- 系统 ----------
export function listAdmins(q: PageQuery & { keyword?: string }): Promise<Page<AdminUser>> {
  return request('/admins', { query: { keyword: q.keyword, page: q.page, pageSize: q.pageSize } });
}

/** 新建管理员：返回临时密码（只返回这一次） */
export function createAdmin(input: AdminInput): Promise<TemporaryPassword> {
  return request('/admins', { method: 'POST', body: input });
}

export async function updateAdmin(id: number, input: AdminInput): Promise<void> {
  await request(`/admins/${id}`, { method: 'PUT', body: input });
}

export async function setAdminStatus(id: number, active: boolean, reason: string): Promise<void> {
  await request(`/admins/${id}/status`, { method: 'POST', body: { active, reason } });
}

/** 重置密码：返回新的临时密码（只返回这一次） */
export function resetAdminPassword(id: number, reason: string): Promise<TemporaryPassword> {
  return request(`/admins/${id}/reset-password`, { method: 'POST', body: { reason } });
}

export function listRoles(): Promise<Role[]> {
  return request('/roles');
}

export async function saveRole(id: string | null, input: RoleInput): Promise<void> {
  if (id) await request(`/roles/${enc(id)}`, { method: 'PUT', body: input });
  else await request('/roles', { method: 'POST', body: input });
}

export async function deleteRole(id: string): Promise<void> {
  await request(`/roles/${enc(id)}`, { method: 'DELETE' });
}

export async function listMenus(): Promise<MenuNode[]> {
  return normalizeMenus(await request<MenuNode[]>('/menus'));
}

/** 菜单只能改顺序和是否显示（后台方案第 7 节）；后端要求每次都带 order */
export async function updateMenu(key: string, patch: Pick<MenuNode, 'order'> & Partial<Pick<MenuNode, 'visible'>>): Promise<void> {
  await request(`/menus/${enc(key)}`, { method: 'PUT', body: { order: patch.order, visible: patch.visible } });
}

export function listPermissions(): Promise<PermissionDef[]> {
  return request('/permissions');
}

export function listAuditLogs(q: AuditQuery): Promise<Page<AuditLog>> {
  return request('/audit-logs', {
    query: { action: q.action, admin: q.admin, highRiskOnly: q.highRiskOnly ? true : undefined, keyword: q.keyword, page: q.page, pageSize: q.pageSize },
  });
}

export function listAuditActions(): Promise<string[]> {
  return request('/audit-logs/actions');
}

export function listSystemConfigs(): Promise<SystemConfig[]> {
  return request('/configs');
}

export async function updateSystemConfig(key: string, value: string, reason: string): Promise<void> {
  await request(`/configs/${enc(key)}`, { method: 'PUT', body: { value, reason } });
}

// ================= S18b：仪表盘、交易监控、风控、品种与行情、交易参数（后台方案第 9 节） =================

/** 仪表盘（平台盈亏口径：今天已实现的手续费 + 隔夜费 − 客户已实现盈亏，不含浮动） */
export function getDashboard(): Promise<DashboardStats> {
  return request('/dashboard');
}

// ---------- 交易监控 ----------
/** 筛选用的品种代码（启用的） */
export function listTradeSymbols(): Promise<string[]> {
  return request('/trade-symbols');
}

/** 订单：没有 rejected 状态（被拒绝的下单请求不保存） */
export function listOrders(q: TradeQuery): Promise<Page<Order>> {
  return request('/orders', { query: { symbol: q.symbol, side: q.side, status: q.status, keyword: q.keyword, page: q.page, pageSize: q.pageSize } });
}

export function listPositions(q: TradeQuery): Promise<Page<Position>> {
  return request('/positions', { query: { symbol: q.symbol, side: q.side, keyword: q.keyword, page: q.page, pageSize: q.pageSize } });
}

/** 手动强平（必须填原因）：按当前市价平仓 */
export async function liquidatePosition(id: string, reason: string): Promise<void> {
  await request(`/positions/${enc(id)}/liquidate`, { method: 'POST', body: { reason } });
}

export function listPendingOrders(q: TradeQuery): Promise<Page<PendingOrder>> {
  return request('/pending', { query: { symbol: q.symbol, side: q.side, keyword: q.keyword, page: q.page, pageSize: q.pageSize } });
}

/** 强制撤单（必须填原因）：释放冻结 */
export async function forceCancelPending(id: string, reason: string): Promise<void> {
  await request(`/pending/${enc(id)}/cancel`, { method: 'POST', body: { reason } });
}

// ---------- 风控 ----------
/** 风控看板：后端字段 symbols 对应原型的 exposures；后端不返回刷新时间，用取数的时间 */
export async function getRiskOverview(): Promise<RiskOverview> {
  const r = await request<{ symbols: SymbolExposure[]; settings: Omit<RiskSettings, 'updatedAt'> & { updatedAt: string | null }; events: RiskEvent[] }>('/risk');
  return { exposures: r.symbols ?? [], settings: { ...r.settings, updatedAt: r.settings.updatedAt ?? new Date().toISOString() }, events: r.events ?? [] };
}

/** 开关类操作的请求体是 {value, reason} */
export async function setGlobalPause(on: boolean, reason: string): Promise<void> {
  await request('/risk/global-pause', { method: 'POST', body: { value: on, reason } });
}

export async function setAutoLiquidation(on: boolean, reason: string): Promise<void> {
  await request('/risk/auto-liquidation', { method: 'POST', body: { value: on, reason } });
}

export async function setSymbolPaused(symbol: string, paused: boolean, reason: string): Promise<void> {
  await request(`/risk/symbols/${enc(symbol)}/pause`, { method: 'POST', body: { value: paused, reason } });
}

/** 品种阈值：空字符串表示不监控 */
export async function setSymbolThreshold(symbol: string, threshold: string, reason: string): Promise<void> {
  await request(`/risk/symbols/${enc(symbol)}/threshold`, { method: 'PUT', body: { value: threshold, reason } });
}

export async function setPlatformThreshold(threshold: string, reason: string): Promise<void> {
  await request('/risk/platform-threshold', { method: 'PUT', body: { value: threshold, reason } });
}

/** 单客户持仓上限（USD 名义价值，含挂单）：只能在风控页改，系统配置页不显示 */
export async function setPerUserLimit(limit: string, reason: string): Promise<void> {
  await request('/risk/per-user-limit', { method: 'PUT', body: { value: limit, reason } });
}

// ---------- 品种与行情 ----------
const isZero = (v: string | null) => v !== null && /^-?0(\.0*)?$/.test(v);

/** 后端隔夜费率没配置时多空都是 0（不收隔夜费），转成原型的 null（后台标红） */
export function normalizeSymbol(s: TradingSymbol): TradingSymbol {
  return isZero(s.swapLong) && isZero(s.swapShort) ? { ...s, swapLong: null, swapShort: null } : s;
}

/** 品种列表；simulatedQuotes：当前报价源是不是模拟源（后端没返回时按不是） */
export async function listSymbols(q: SymbolQuery): Promise<SymbolPage> {
  const p = await request<SymbolPage>('/symbols', {
    query: { category: q.category, keyword: q.keyword, enabled: q.enabled, missingSwap: q.missingSwap ? true : undefined, page: q.page, pageSize: q.pageSize },
  });
  return { ...p, items: p.items.map(normalizeSymbol), simulatedQuotes: p.simulatedQuotes === true };
}

/** 改品种参数（必须填原因）：只影响以后开的仓。隔夜费率清空（null）按"未配置"发 0 */
export async function updateSymbol(code: string, patch: SymbolPatch, reason: string): Promise<void> {
  const body: Record<string, unknown> = { ...patch, reason };
  if (patch.swapLong === null) body.swapLong = '0';
  if (patch.swapShort === null) body.swapShort = '0';
  await request(`/symbols/${enc(code)}`, { method: 'PUT', body });
}

/** 新增品种（v2 E3，必须填原因）：新增后默认暂停开仓 */
export async function createSymbol(input: SymbolCreateInput, reason: string): Promise<TradingSymbol> {
  return normalizeSymbol(await request<TradingSymbol>('/symbols', { method: 'POST', body: { ...input, reason } }));
}

/** 启用 / 停用（必须填原因）；有持仓或挂单的品种不能停用 */
export async function setSymbolEnabled(code: string, enabled: boolean, reason: string): Promise<void> {
  await request(`/symbols/${enc(code)}/enabled`, { method: 'POST', body: { value: enabled, reason } });
}

/** 交易时段：按品种列出，只读 */
export function listSessions(): Promise<TradingSession[]> {
  return request('/sessions');
}

/** 今天（UTC）起的休市日 */
export function listHolidays(): Promise<Holiday[]> {
  return request('/holidays');
}

export async function addHoliday(h: HolidayInput): Promise<void> {
  await request('/holidays', { method: 'POST', body: { symbol: h.symbol, date: h.date, reason: h.reason } });
}

export async function deleteHoliday(id: string): Promise<void> {
  await request(`/holidays/${enc(id)}`, { method: 'DELETE' });
}

export function listFxRates(): Promise<FxRate[]> {
  return request('/fx-rates');
}

// ---------- 交易参数 ----------
export function getTradingParams(): Promise<TradingParams> {
  return request('/params');
}

/** 只能改追保线和追保通知间隔（G6：没有账户级强平线） */
export async function updateTradingParams(p: TradingParamsInput, reason: string): Promise<void> {
  await request('/params', { method: 'PUT', body: { marginCallLevel: p.marginCallLevel, marginCallThrottleMinutes: p.marginCallThrottleMinutes, reason } });
}
