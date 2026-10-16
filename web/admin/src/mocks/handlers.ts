/**
 * 模拟接口实现。函数名和参数与 src/api 一一对应；操作会修改内存数据并写审计日志。
 * 服务端校验（权限、超管分配、余额调整上限等）在这里也模拟一遍，确保前端不是唯一防线。
 */
import {
  ApiError,
  type AdjustLimits,
  type AdminInput,
  type AdminSession,
  type AdminUser,
  type AuditLog,
  type AuditQuery,
  type AuditValue,
  type CurrentAdmin,
  type CustomerDetail,
  type CustomerQuery,
  type CustomerSummary,
  type DashboardStats,
  type DepositQuery,
  type Deposit,
  type Holiday,
  type HolidayInput,
  type KycApplication,
  type KycQuery,
  type LedgerEntry,
  type ManualNotifyInput,
  type MenuBadges,
  type MenuNode,
  type NotifyRecordQuery,
  type NotifyTemplate,
  type Page,
  type PageQuery,
  type ReconQuery,
  type Role,
  type RoleInput,
  type SymbolQuery,
  type TaskQuery,
  type TemporaryPassword,
  type TradeQuery,
  type TradingParams,
  type TradingParamsInput,
  type RiskOverview,
  type SymbolPatch,
  type TradingSymbol,
  type WithdrawalDetail,
  type WithdrawalQuery,
  type WithdrawalSummary,
  type Withdrawal,
} from '../api/types';
import { MENU, type MenuItemDef } from '../config/menu';
import { PERMISSIONS, SUPER_ADMIN_ROLE } from '../config/permissions';
import { sanitizeAuditPayload } from '../utils/audit';
import { compareAmounts, fromScaled, isValidAmountInput, sumAmounts, toScaled, usagePercent } from '../utils/money';
import * as db from './data/db';
import { createRng, minutesAgo, nowString } from './data/seed';
import { emptyPage, matches, mutate, paginate, respond } from './runtime';

// ============ 工具 ============
function currentAdmin(): AdminUser {
  return db.admins.find((a) => a.id === db.session.adminId) ?? db.admins[0];
}

function permissionsOf(admin: AdminUser): Set<string> {
  const set = new Set<string>();
  admin.roleIds.forEach((rid) => db.roles.find((r) => r.id === rid)?.permissions.forEach((p) => set.add(p)));
  return set;
}

function isSuper(admin: AdminUser): boolean {
  return admin.roleIds.some((rid) => db.roles.find((r) => r.id === rid)?.code === SUPER_ADMIN_ROLE);
}

/** 模拟服务端的权限检查（没有权限返回 403） */
function requirePerm(code: string): void {
  if (!permissionsOf(currentAdmin()).has(code)) throw new ApiError('errors.forbidden');
}

function requireReason(reason: string | undefined): string {
  const r = (reason ?? '').trim();
  if (!r) throw new ApiError('errors.reasonRequired');
  return r;
}

/** 审计里不记录任何密码字段（修复 fxsystem S5）：服务端写入前就过滤 */
const scrub = sanitizeAuditPayload;

let auditSeq = 240001;
function audit(action: string, target: string, highRisk: boolean, reason: string | null, before: AuditLog['before'], after: AuditLog['after']): void {
  db.auditLogs.unshift({
    id: `AU-${auditSeq++}`,
    time: nowString(),
    adminName: currentAdmin().displayName,
    ip: '203.0.113.24',
    action,
    target,
    highRisk,
    result: 'success',
    reason,
    before: scrub(before),
    after: scrub(after),
  });
}

const sortDesc = <T,>(arr: T[], key: (x: T) => string) => [...arr].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));

// ============ 认证 / 原型身份 ============
export function login(username: string, password: string): Promise<AdminSession> {
  return respond(
    () => {
      if (!username.trim() || !password) throw new ApiError('errors.loginRequired');
      const admin = db.admins.find((a) => a.username === username.trim());
      if (admin && admin.status === 'disabled') throw new ApiError('errors.accountDisabled');
      // 原型：任意密码可登录；未知账号按超级管理员 Amos 登录
      const target = admin ?? db.admins[0];
      db.session.adminId = target.id;
      return {
        token: `proto-${target.id}-${Date.now()}`,
        adminId: target.id,
        username: target.username,
        displayName: target.displayName,
        mustChangePassword: target.mustChangePassword,
      };
    },
    { bypass: true },
  );
}

export function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  return respond(
    () => {
      if (!oldPassword || !newPassword) throw new ApiError('errors.loginRequired');
      if (oldPassword === newPassword) throw new ApiError('errors.samePassword');
      currentAdmin().mustChangePassword = false;
      audit('admin.change_password', currentAdmin().username, false, null, { mustChangePassword: true }, { mustChangePassword: false });
    },
    { bypass: true },
  );
}

export type { CurrentAdmin };

export function getCurrentAdmin(adminId: number): Promise<CurrentAdmin> {
  return respond(
    () => {
      db.session.adminId = adminId;
      const admin = currentAdmin();
      return {
        admin,
        roles: db.roles.filter((r) => admin.roleIds.includes(r.id)),
        permissions: [...permissionsOf(admin)],
        isSuperAdmin: isSuper(admin),
      };
    },
    { bypass: true },
  );
}

export type ProtoIdentity = 'super' | 'ops' | 'risk';
export function switchIdentity(identity: ProtoIdentity): Promise<AdminSession> {
  return respond(
    () => {
      const admin = db.admins.find((a) => a.id === db.identityAdmin[identity])!;
      db.session.adminId = admin.id;
      return { token: `proto-${admin.id}-${Date.now()}`, adminId: admin.id, username: admin.username, displayName: admin.displayName, mustChangePassword: false };
    },
    { bypass: true },
  );
}

// ============ 仪表盘 ============
export function getDashboard(): Promise<DashboardStats> {
  const zero: DashboardStats = {
    todayRegistrations: 0, onlineCustomers: 0, todayDeposit: '0.00', todayDepositCount: 0, todayWithdraw: '0.00', todayWithdrawCount: 0,
    openPositions: 0, platformPnl: '0.00', platformNetExposure: '0', platformThreshold: db.riskSettings.platformThresholdUsd,
    pendingKyc: 0, pendingWithdrawals: 0, failedTasks: 0, openReconciliations: 0, updatedAt: nowString(),
  };
  return respond(
    () => {
      const today = '2026-10-14';
      const todayDeposits = db.deposits.filter((d) => d.status === 'credited' && d.creditedAt?.startsWith(today));
      const todayWd = db.withdrawals.filter((w) => w.status === 'completed' && w.submittedAt.startsWith(today));
      return {
        todayRegistrations: db.customers.filter((c) => c.registeredAt.startsWith(today)).length,
        onlineCustomers: 37,
        todayDeposit: sumAmounts(todayDeposits.map((d) => d.amount)),
        todayDepositCount: todayDeposits.length,
        todayWithdraw: sumAmounts(todayWd.map((w) => w.amount)),
        todayWithdrawCount: todayWd.length,
        openPositions: db.positions.length,
        platformPnl: '28417.36',
        platformNetExposure: db.riskSettings.platformNetUsd,
        platformThreshold: db.riskSettings.platformThresholdUsd,
        pendingKyc: db.kycApplications.filter((k) => k.status === 'pending').length,
        pendingWithdrawals: db.withdrawals.filter((w) => w.status === 'pending').length,
        failedTasks: db.tasks.filter((t) => t.status === 'failed').length,
        openReconciliations: db.reconItems.filter((r) => r.status === 'open').length,
        updatedAt: nowString(),
      };
    },
    { empty: () => zero },
  );
}

export function getMenuBadges(): Promise<MenuBadges> {
  return respond(
    () => ({
      kyc: db.kycApplications.filter((k) => k.status === 'pending').length,
      withdrawals: db.withdrawals.filter((w) => w.status === 'pending').length,
    }),
    { empty: () => ({ kyc: 0, withdrawals: 0 }) },
  );
}

// ============ 客户 ============
export function listCustomers(q: CustomerQuery): Promise<Page<CustomerSummary>> {
  return respond(
    () => {
      const rows = sortDesc(db.customers, (c) => c.registeredAt).filter(
        (c) => matches(q.keyword, c.name, c.email, c.id) && (!q.status || c.status === q.status) && (!q.kycStatus || c.kycStatus === q.kycStatus),
      );
      return paginate(rows, q.page, q.pageSize);
    },
    { empty: () => emptyPage(q.page, q.pageSize) },
  );
}

function ledgerFor(c: CustomerSummary, empty: boolean): LedgerEntry[] {
  if (empty) return [];
  const rng = createRng(c.id);
  const types: LedgerEntry['type'][] = ['pnl', 'fee', 'swap', 'pnl', 'fee', 'withdraw', 'pnl', 'refund', 'swap', 'adjust', 'fee', 'deposit'];
  let bal = toScaled(c.balance) ?? 0n;
  // 单笔金额不超过余额的 1/15（余额为 0 时按 500 计），倒推 11 笔后余额仍为正
  const cap = Number((bal > 50000n ? bal : 50000n) / 15n) / 100;
  return types.map((type, i) => {
    const raw = type === 'deposit' ? rng.amount(500, 12000) : type === 'fee' || type === 'swap' ? rng.amount(0, Math.min(30, cap)) : rng.amount(0, cap);
    const negative = type === 'withdraw' || type === 'fee' || ((type === 'pnl' || type === 'swap') && rng.bool(0.5));
    const amount = (negative ? '-' : '') + raw;
    const entry: LedgerEntry = {
      id: `LG-${c.id}-${12 - i}`,
      type,
      amount,
      balanceAfter: fromScaled(bal),
      ref: type === 'deposit' ? 'DP-20261001-000412' : type === 'withdraw' ? 'WD-20261010-000101' : type === 'adjust' ? 'ADJ-0007' : `PS-${660000 + i}`,
      time: minutesAgo(i * 300 + 15),
    };
    bal -= toScaled(amount) ?? 0n;
    if (bal < 0n) bal = 0n;
    return entry;
  });
}

export function getCustomer(id: number): Promise<CustomerDetail> {
  return mutateRead(() => {
    const c = db.customerById(id);
    if (!c) throw new ApiError('errors.notFound');
    const kyc = db.kycApplications.find((k) => k.customerId === id);
    const positions = db.positions.filter((p) => p.customerId === id);
    const used = sumAmounts(positions.map((p) => p.margin));
    const floating = sumAmounts(positions.map((p) => p.pnl));
    const frozenWd = sumAmounts(db.withdrawals.filter((w) => w.customerId === id && ['cooling', 'pending', 'delayed', 'broadcasting'].includes(w.status)).map((w) => w.amount));
    const avail = fromScaled((toScaled(c.balance) ?? 0n) - (toScaled(used) ?? 0n) - (toScaled(frozenWd) ?? 0n));
    const [first, ...rest] = c.name.split(' ');
    return {
      ...c,
      firstName: rest.length ? first : c.name.slice(1) || c.name,
      middleName: '',
      lastName: rest.length ? rest.join(' ') : c.name.slice(0, 1),
      birthDate: kyc?.birthDate ?? '1990-05-12',
      frozenReason: c.status === 'frozen' ? '客户来电称手机丢失，申请冻结' : null,
      kyc: {
        status: c.kycStatus,
        docType: kyc?.docType ?? null,
        docNumber: kyc?.docNumber ?? null,
        reviewedAt: kyc?.reviewedAt ?? null,
        rejectReason: kyc?.rejectReason ?? null,
      },
      account: { balance: c.balance, usedMargin: used, available: compareAmounts(avail, '0') < 0 ? '0.00' : avail, floatingPnl: floating, frozenWithdraw: frozenWd },
      positions,
      ledger: ledgerFor(c, false),
    };
  });
}

/** 详情类接口：空数据场景下返回的明细列表为空 */
function mutateRead<T extends object>(produce: () => T): Promise<T> {
  return respond(produce, {
    empty: () => {
      const v = produce() as T & { positions?: unknown[]; ledger?: unknown[]; recentDeposits?: unknown[]; recentWithdrawals?: unknown[] };
      const acc = (v as { account?: CustomerDetail['account'] }).account;
      if (acc) Object.assign(acc, { usedMargin: '0.00', floatingPnl: '0.00', frozenWithdraw: '0.00', available: acc.balance });
      if (v.positions) v.positions = [];
      if (v.ledger) v.ledger = [];
      if (v.recentDeposits) v.recentDeposits = [];
      if (v.recentWithdrawals) v.recentWithdrawals = [];
      return v;
    },
  });
}

export function setCustomerFrozen(id: number, frozen: boolean, reason: string): Promise<void> {
  return mutate(() => {
    requirePerm('customer:freeze');
    const r = requireReason(reason);
    const c = db.customerById(id);
    if (!c) throw new ApiError('errors.notFound');
    const before = c.status;
    c.status = frozen ? 'frozen' : 'active';
    audit(frozen ? 'customer.freeze' : 'customer.unfreeze', String(id), true, r, { status: before }, { status: c.status });
  });
}

export function getAdjustLimits(): Promise<AdjustLimits> {
  return respond(() => ({
    singleLimit: db.systemConfigs.find((c) => c.key === 'adjust.singleLimit')!.value + '.00',
    dailyLimit: db.systemConfigs.find((c) => c.key === 'adjust.dailyLimit')!.value + '.00',
    usedToday: db.adjustState.usedToday,
  }), { bypass: true });
}

export function adjustBalance(id: number, direction: 'credit' | 'debit', amount: string, reason: string): Promise<void> {
  return mutate(() => {
    requirePerm('customer:adjust_balance');
    const r = requireReason(reason);
    if (!isValidAmountInput(amount)) throw new ApiError('errors.invalidAmount');
    const c = db.customerById(id);
    if (!c) throw new ApiError('errors.notFound');
    const single = db.systemConfigs.find((x) => x.key === 'adjust.singleLimit')!.value;
    const daily = db.systemConfigs.find((x) => x.key === 'adjust.dailyLimit')!.value;
    if (compareAmounts(amount, single) > 0) throw new ApiError('errors.overSingleLimit');
    if (compareAmounts(sumAmounts([db.adjustState.usedToday, amount]), daily) > 0) throw new ApiError('errors.overDailyLimit');
    const signed = direction === 'debit' ? '-' + amount : amount;
    const next = sumAmounts([c.balance, signed]);
    if (compareAmounts(next, '0') < 0) throw new ApiError('errors.negativeBalance');
    const before = c.balance;
    c.balance = next;
    db.adjustState.usedToday = sumAmounts([db.adjustState.usedToday, amount]);
    audit('customer.adjust_balance', String(id), true, r, { balance: before }, { balance: next });
  });
}

// ============ KYC ============
export function listKyc(q: KycQuery): Promise<Page<KycApplication>> {
  return respond(
    () => paginate(db.kycApplications.filter((k) => (!q.status || k.status === q.status) && matches(q.keyword, k.name, k.email, k.customerId, k.id)), q.page, q.pageSize),
    { empty: () => emptyPage(q.page, q.pageSize) },
  );
}

export function getKyc(id: string): Promise<KycApplication> {
  return respond(() => {
    const k = db.kycApplications.find((x) => x.id === id);
    if (!k) throw new ApiError('errors.notFound');
    return k;
  });
}

export function reviewKyc(id: string, approve: boolean, reason?: string): Promise<void> {
  return mutate(() => {
    requirePerm('kyc:review');
    const k = db.kycApplications.find((x) => x.id === id);
    if (!k) throw new ApiError('errors.notFound');
    if (k.status !== 'pending') throw new ApiError('errors.stateChanged');
    const r = approve ? null : requireReason(reason);
    k.status = approve ? 'approved' : 'rejected';
    k.reviewer = currentAdmin().displayName;
    k.reviewedAt = nowString();
    k.rejectReason = r;
    const c = db.customerById(k.customerId);
    if (c) c.kycStatus = k.status;
    audit(approve ? 'kyc.approve' : 'kyc.reject', id, false, r, { status: 'pending' }, { status: k.status });
  });
}

// ============ 资金 ============
export function listDeposits(q: DepositQuery): Promise<Page<Deposit>> {
  return respond(
    () => paginate(db.deposits.filter((d) => (!q.chain || d.chain === q.chain) && (!q.status || d.status === q.status) && matches(q.keyword, d.customerName, d.email, d.txHash, d.customerId, d.id)), q.page, q.pageSize),
    { empty: () => emptyPage(q.page, q.pageSize) },
  );
}

const OPEN_WD = ['cooling', 'pending', 'delayed'];
export function listWithdrawals(q: WithdrawalQuery): Promise<Page<Withdrawal>> {
  return respond(
    () => {
      const rows = db.withdrawals.filter((w) => {
        if (q.status === 'open' ? !OPEN_WD.includes(w.status) : q.status && w.status !== q.status) return false;
        if (q.chain && w.chain !== q.chain) return false;
        if (q.minAmount && compareAmounts(w.amount, q.minAmount) < 0) return false;
        if (q.maxAmount && compareAmounts(w.amount, q.maxAmount) > 0) return false;
        return matches(q.keyword, w.customerName, w.email, w.customerId, w.id);
      });
      // 待审核排在前面，其次按提交时间倒序
      const rank = (w: Withdrawal) => (w.status === 'pending' ? 0 : w.status === 'delayed' ? 1 : w.status === 'cooling' ? 2 : 3);
      rows.sort((a, b) => rank(a) - rank(b) || (a.submittedAt < b.submittedAt ? 1 : -1));
      return paginate(rows, q.page, q.pageSize);
    },
    { empty: () => emptyPage(q.page, q.pageSize) },
  );
}

export function getWithdrawalSummary(): Promise<WithdrawalSummary> {
  const group = (pred: (w: Withdrawal) => boolean) => {
    const rows = db.withdrawals.filter(pred);
    return { count: rows.length, amount: sumAmounts(rows.map((w) => w.amount)) };
  };
  const zero = { count: 0, amount: '0.00' };
  return respond(
    () => ({
      pending: group((w) => w.status === 'pending'),
      delayed: group((w) => w.status === 'delayed'),
      cooling: group((w) => w.status === 'cooling'),
      completedToday: group((w) => w.status === 'completed' && w.submittedAt.startsWith('2026-10-14')),
    }),
    { empty: () => ({ pending: zero, delayed: zero, cooling: zero, completedToday: zero }) },
  );
}

export function getWithdrawal(id: string): Promise<WithdrawalDetail> {
  return mutateRead(() => {
    const w = db.withdrawals.find((x) => x.id === id);
    if (!w) throw new ApiError('errors.notFound');
    const c = db.customerById(w.customerId)!;
    const deps = db.deposits.filter((d) => d.customerId === c.id && d.status === 'credited').slice(0, 3);
    const prevWd = db.withdrawals.filter((x) => x.customerId === c.id && x.id !== id && x.status === 'completed').slice(0, 3);
    const regDays = Math.max(1, Math.round((Date.UTC(2026, 9, 14) - Date.parse(c.registeredAt.replace(' ', 'T') + 'Z')) / 86_400_000));
    return {
      ...w,
      kycStatus: c.kycStatus,
      registeredDays: w.customerId === 100482 ? 30 : regDays,
      totalDeposit: w.customerId === 100482 ? '20000.00' : sumAmounts(db.deposits.filter((d) => d.customerId === c.id && d.status === 'credited').map((d) => d.amount)),
      balance: c.balance,
      openPositions: db.positions.filter((p) => p.customerId === c.id).length,
      recentDeposits:
        w.customerId === 100482
          ? [
              { time: '2026-10-13 20:14:00', chain: 'TRC20', amount: '12000.00' },
              { time: '2026-09-28 11:02:00', chain: 'TRC20', amount: '8000.00' },
            ]
          : deps.map((d) => ({ time: d.creditedAt ?? d.detectedAt, chain: d.chain, amount: d.amount })),
      recentWithdrawals: prevWd.map((x) => ({ time: x.submittedAt, chain: x.chain, amount: x.amount })),
    };
  });
}

export function approveWithdrawal(id: string): Promise<Withdrawal> {
  return mutate(() => {
    requirePerm('withdrawal:review');
    const w = db.withdrawals.find((x) => x.id === id);
    if (!w) throw new ApiError('errors.notFound');
    if (w.status !== 'pending') throw new ApiError('errors.stateChanged');
    const large = compareAmounts(w.amount, db.systemConfigs.find((c) => c.key === 'withdraw.largeThreshold')!.value) >= 0;
    w.status = large ? 'delayed' : 'broadcasting';
    w.delayRemainingMinutes = large ? 360 : null;
    w.reviewer = currentAdmin().displayName;
    audit('withdrawal.approve', id, false, null, { status: 'pending' }, { status: w.status });
    return w;
  });
}

export function rejectWithdrawal(id: string, reason: string): Promise<Withdrawal> {
  return mutate(() => {
    requirePerm('withdrawal:review');
    const r = requireReason(reason);
    const w = db.withdrawals.find((x) => x.id === id);
    if (!w) throw new ApiError('errors.notFound');
    if (w.status !== 'pending') throw new ApiError('errors.stateChanged');
    w.status = 'rejected';
    w.reason = r;
    w.reviewer = currentAdmin().displayName;
    audit('withdrawal.reject', id, false, r, { status: 'pending' }, { status: 'rejected' });
    return w;
  });
}

export function emergencyCancelWithdrawal(id: string, reason: string): Promise<Withdrawal> {
  return mutate(() => {
    requirePerm('withdrawal:emergency_cancel');
    const r = requireReason(reason);
    const w = db.withdrawals.find((x) => x.id === id);
    if (!w) throw new ApiError('errors.notFound');
    if (w.status !== 'delayed') throw new ApiError('errors.stateChanged');
    w.status = 'cancelled';
    w.reason = r;
    w.delayRemainingMinutes = null;
    audit('withdrawal.emergency_cancel', id, true, r, { status: 'delayed' }, { status: 'cancelled' });
    return w;
  });
}

export function listRecon(q: ReconQuery) {
  return respond(
    () => paginate(sortDesc(db.reconItems, (r) => r.detectedAt).filter((r) => !q.status || r.status === q.status), q.page, q.pageSize),
    { empty: () => emptyPage<(typeof db.reconItems)[number]>(q.page, q.pageSize) },
  );
}

export function resolveRecon(id: string, note: string): Promise<void> {
  return mutate(() => {
    requirePerm('recon:resolve');
    const n = requireReason(note);
    const r = db.reconItems.find((x) => x.id === id);
    if (!r) throw new ApiError('errors.notFound');
    if (r.status !== 'open') throw new ApiError('errors.issueNotOpen');
    r.status = 'resolved';
    r.resolvedAt = nowString();
    r.note = n;
    r.handler = currentAdmin().displayName;
    audit('recon.resolve', id, false, n, { status: 'open' }, { status: 'resolved' });
  });
}

export function listTasks(q: TaskQuery) {
  return respond(
    () => paginate(db.tasks.filter((t) => (!q.type || t.type === q.type) && (!q.status || t.status === q.status)), q.page, q.pageSize),
    { empty: () => emptyPage<(typeof db.tasks)[number]>(q.page, q.pageSize) },
  );
}

export function retryTask(id: string): Promise<void> {
  return mutate(() => {
    requirePerm('task:retry');
    const t = db.tasks.find((x) => x.id === id);
    if (!t) throw new ApiError('errors.notFound');
    if (t.status !== 'failed') throw new ApiError('errors.stateChanged');
    t.status = 'pending';
    t.nextRetryAt = nowString();
    t.updatedAt = nowString();
    audit('task.retry', id, false, null, { status: 'failed', attempts: t.attempts }, { status: 'pending', attempts: t.attempts });
  });
}

// ============ 交易监控 ============
function tradeFilter<T extends { symbol: string; side: string; customerName: string; customerId: number; id: string }>(rows: T[], q: TradeQuery): T[] {
  return rows.filter((r) => (!q.symbol || r.symbol === q.symbol) && (!q.side || r.side === q.side) && matches(q.keyword, r.customerName, r.customerId, r.id));
}

export function listOrders(q: TradeQuery) {
  return respond(
    () => paginate(tradeFilter(db.orders, q).filter((o) => !q.status || o.status === q.status), q.page, q.pageSize),
    { empty: () => emptyPage<(typeof db.orders)[number]>(q.page, q.pageSize) },
  );
}

export function listPositions(q: TradeQuery) {
  return respond(() => paginate(tradeFilter(db.positions, q), q.page, q.pageSize), { empty: () => emptyPage<(typeof db.positions)[number]>(q.page, q.pageSize) });
}

export function liquidatePosition(id: string, reason: string): Promise<void> {
  return mutate(() => {
    requirePerm('position:liquidate');
    const r = requireReason(reason);
    const idx = db.positions.findIndex((p) => p.id === id);
    if (idx < 0) throw new ApiError('errors.stateChanged');
    db.positions.splice(idx, 1);
    audit('position.liquidate', id, true, r, { status: 'open' }, { status: 'closed' });
  });
}

export function listPendingOrders(q: TradeQuery) {
  return respond(() => paginate(tradeFilter(db.pendingOrders, q), q.page, q.pageSize), { empty: () => emptyPage<(typeof db.pendingOrders)[number]>(q.page, q.pageSize) });
}

export function forceCancelPending(id: string, reason: string): Promise<void> {
  return mutate(() => {
    requirePerm('pending:force_cancel');
    const r = requireReason(reason);
    const idx = db.pendingOrders.findIndex((p) => p.id === id);
    if (idx < 0) throw new ApiError('errors.stateChanged');
    db.pendingOrders.splice(idx, 1);
    audit('pending.force_cancel', id, true, r, { status: 'pending' }, { status: 'cancelled' });
  });
}

export function listTradeSymbols(): Promise<string[]> {
  return respond(() => [...new Set(db.orders.map((o) => o.symbol))].sort(), { bypass: true });
}

// ============ 风控 ============
export function getRiskOverview(): Promise<RiskOverview> {
  return respond<RiskOverview>(
    () => ({ settings: db.riskSettings, exposures: db.exposures, events: db.riskEvents.slice(0, 8) }),
    { empty: () => ({ settings: { ...db.riskSettings, platformNetUsd: '0' }, exposures: [], events: [] }) },
  );
}

function riskEvent(type: (typeof db.riskEvents)[number]['type'], symbol: string | null, reason: string | null, value: string | null = null, threshold: string | null = null) {
  db.riskEvents.unshift({ id: `RE-${db.riskEvents.length + 10}`, time: nowString(), actorType: 'admin', actorName: currentAdmin().displayName, type, symbol, value, threshold, reason });
}

export function setGlobalPause(on: boolean, reason: string): Promise<void> {
  return mutate(() => {
    requirePerm('risk:global_pause');
    const r = requireReason(reason);
    db.riskSettings.globalPause = on;
    riskEvent(on ? 'global_pause_on' : 'global_pause_off', null, r);
    audit(on ? 'risk.global_pause_on' : 'risk.global_pause_off', '全局', true, r, { globalPause: !on }, { globalPause: on });
  });
}

export function setAutoLiquidation(on: boolean, reason: string): Promise<void> {
  return mutate(() => {
    requirePerm('risk:auto_liquidation');
    const r = requireReason(reason);
    db.riskSettings.autoLiquidation = on;
    riskEvent(on ? 'auto_liq_on' : 'auto_liq_off', null, r);
    audit(on ? 'risk.auto_liquidation_on' : 'risk.auto_liquidation_off', '全局', true, r, { autoLiquidation: !on }, { autoLiquidation: on });
  });
}

export function setSymbolPaused(symbol: string, paused: boolean, reason: string): Promise<void> {
  return mutate(() => {
    requirePerm('risk:symbol_pause');
    const r = requireReason(reason);
    const e = db.exposures.find((x) => x.symbol === symbol);
    if (!e) throw new ApiError('errors.notFound');
    const before = e.status;
    if (paused) e.status = 'manual_paused';
    else {
      const u = usagePercent(e.netUsd, e.thresholdUsd);
      e.status = u >= 80 ? 'near' : 'normal';
    }
    riskEvent(paused ? 'manual_pause' : 'manual_resume', symbol, r);
    audit(paused ? 'risk.symbol_pause' : 'risk.symbol_resume', symbol, true, r, { status: before }, { status: e.status });
  });
}

export function setSymbolThreshold(symbol: string, threshold: string, reason: string): Promise<void> {
  return mutate(() => {
    requirePerm('risk:threshold');
    const r = requireReason(reason);
    const e = db.exposures.find((x) => x.symbol === symbol);
    if (!e) throw new ApiError('errors.notFound');
    const before = e.thresholdUsd;
    e.thresholdUsd = threshold;
    riskEvent('threshold_change', symbol, r, threshold, before);
    audit('risk.threshold', symbol, true, r, { thresholdUsd: before }, { thresholdUsd: threshold });
  });
}

export function setPlatformThreshold(threshold: string, reason: string): Promise<void> {
  return mutate(() => {
    requirePerm('risk:threshold');
    const r = requireReason(reason);
    const before = db.riskSettings.platformThresholdUsd;
    db.riskSettings.platformThresholdUsd = threshold;
    riskEvent('threshold_change', null, r, threshold, before);
    audit('risk.platform_threshold', '平台', true, r, { thresholdUsd: before }, { thresholdUsd: threshold });
  });
}

export function setPerUserLimit(limit: string, reason: string): Promise<void> {
  return mutate(() => {
    requirePerm('risk:user_limit');
    const r = requireReason(reason);
    const before = db.riskSettings.perUserLimitUsd;
    db.riskSettings.perUserLimitUsd = limit;
    audit('risk.user_limit', '单用户持仓上限', true, r, { perUserLimitUsd: before }, { perUserLimitUsd: limit });
  });
}

// ============ 品种与行情 ============
export function listSymbols(q: SymbolQuery): Promise<Page<TradingSymbol>> {
  return respond(
    () =>
      paginate(
        db.symbols.filter(
          (s) =>
            (!q.category || s.category === q.category) &&
            (q.enabled === undefined || s.enabled === q.enabled) &&
            (!q.missingSwap || s.swapLong === null || s.swapShort === null) &&
            matches(q.keyword, s.code, s.nameZh, s.nameEn),
        ),
        q.page,
        q.pageSize,
      ),
    { empty: () => emptyPage(q.page, q.pageSize) },
  );
}

export function updateSymbol(code: string, patch: SymbolPatch, reason: string): Promise<void> {
  return mutate(() => {
    requirePerm('symbol:edit');
    const r = requireReason(reason);
    const s = db.symbols.find((x) => x.code === code);
    if (!s) throw new ApiError('errors.notFound');
    const before: Record<string, AuditValue> = {};
    const after: Record<string, AuditValue> = {};
    (Object.keys(patch) as (keyof SymbolPatch)[]).forEach((k) => {
      if (patch[k] !== s[k]) {
        before[k] = s[k] as AuditValue;
        after[k] = patch[k] as AuditValue;
      }
    });
    Object.assign(s, patch, { updatedAt: nowString() });
    audit('symbol.update', code, true, r, before, after);
  });
}

export function setSymbolEnabled(code: string, enabled: boolean, reason: string): Promise<void> {
  return mutate(() => {
    requirePerm('symbol:edit');
    const r = requireReason(reason);
    const s = db.symbols.find((x) => x.code === code);
    if (!s) throw new ApiError('errors.notFound');
    // 还有持仓或挂单的品种不能停用（后台方案第 9 节）
    if (!enabled && (db.positions.some((p) => p.symbol === code) || db.pendingOrders.some((p) => p.symbol === code))) throw new ApiError('errors.symbolInUse');
    const before = s.enabled;
    s.enabled = enabled;
    s.updatedAt = nowString();
    audit(enabled ? 'symbol.enable' : 'symbol.disable', code, true, r, { enabled: before }, { enabled });
  });
}

export function listSessions() {
  return respond(() => db.sessions, { empty: () => [] as typeof db.sessions });
}

export function listHolidays() {
  return respond(() => [...db.holidays].sort((a, b) => (a.date < b.date ? -1 : 1)), { empty: () => [] as Holiday[] });
}

export function addHoliday(h: HolidayInput): Promise<void> {
  return mutate(() => {
    requirePerm('session:edit');
    if (db.holidays.some((x) => x.symbol === h.symbol && x.date === h.date)) throw new ApiError('errors.holidayExists');
    db.holidays.push({ id: String(db.holidays.length + 10), date: h.date, symbol: h.symbol, reason: h.reason?.trim() || null });
    audit('holiday.add', `${h.symbol} ${h.date}`, false, h.reason?.trim() || null, null, { symbol: h.symbol, date: h.date });
  });
}

export function deleteHoliday(id: string): Promise<void> {
  return mutate(() => {
    requirePerm('session:edit');
    const idx = db.holidays.findIndex((h) => h.id === id);
    if (idx >= 0) {
      const [h] = db.holidays.splice(idx, 1);
      audit('holiday.delete', h.id, false, null, { symbol: h.symbol, date: h.date }, null);
    }
  });
}

export function listFxRates() {
  return respond(() => db.fxRates, { empty: () => [] as typeof db.fxRates });
}

// ============ 交易参数 ============
export function getTradingParams(): Promise<TradingParams> {
  return respond(() => db.tradingParams);
}

export function updateTradingParams(p: TradingParamsInput, reason: string): Promise<void> {
  return mutate(() => {
    requirePerm('params:edit');
    const r = requireReason(reason);
    const before = { marginCallLevel: db.tradingParams.marginCallLevel, marginCallThrottleMinutes: db.tradingParams.marginCallThrottleMinutes };
    Object.assign(db.tradingParams, p, { updatedAt: nowString(), updatedBy: currentAdmin().displayName });
    audit('params.update', 'trading', true, r, before, { ...p });
  });
}

// ============ 通知 ============
export function listTemplates() {
  return respond(() => db.templates, { empty: () => [] as NotifyTemplate[] });
}

export function updateTemplate(id: string, patch: Partial<Pick<NotifyTemplate, 'titleZh' | 'bodyZh' | 'titleEn' | 'bodyEn' | 'enabled'>>): Promise<void> {
  return mutate(() => {
    requirePerm('notify_template:edit');
    const t = db.templates.find((x) => x.id === id);
    if (!t) throw new ApiError('errors.notFound');
    // 内置模板不能禁用（禁用会导致出金结算等流程失败）
    if (t.builtIn && patch.enabled === false) throw new ApiError('errors.builtInCannotDisable');
    const before = { titleZh: t.titleZh, bodyZh: t.bodyZh, titleEn: t.titleEn, bodyEn: t.bodyEn, enabled: t.enabled };
    Object.assign(t, patch, { updatedAt: nowString() });
    audit('notify.template_update', t.code, false, null, before, { titleZh: t.titleZh, bodyZh: t.bodyZh, titleEn: t.titleEn, bodyEn: t.bodyEn, enabled: t.enabled });
  });
}

export function searchCustomers(keyword: string): Promise<CustomerSummary[]> {
  return respond(() => db.customers.filter((c) => matches(keyword, c.name, c.email, c.id)).slice(0, 20), { bypass: true });
}

export function sendManualNotification(input: ManualNotifyInput): Promise<void> {
  return mutate(() => {
    requirePerm('notify:send');
    const r = requireReason(input.reason);
    const c = db.customerById(input.customerId);
    if (!c) throw new ApiError('errors.notFound');
    input.channels.forEach((ch) =>
      db.notifyRecords.unshift({
        id: `NT-${553200 + db.notifyRecords.length}`,
        customerId: c.id,
        customerName: c.name,
        source: 'manual',
        templateCode: null,
        channel: ch,
        title: input.title,
        status: 'sent',
        error: null,
        operator: currentAdmin().displayName,
        time: nowString(),
      }),
    );
    audit('notify.manual_send', String(c.id), true, r, null, { channels: input.channels, title: input.title });
  });
}

export function listNotifyRecords(q: NotifyRecordQuery) {
  return respond(
    () => paginate(db.notifyRecords.filter((n) => (!q.channel || n.channel === q.channel) && (!q.status || n.status === q.status) && matches(q.keyword, n.customerName, n.customerId, n.title)), q.page, q.pageSize),
    { empty: () => emptyPage<(typeof db.notifyRecords)[number]>(q.page, q.pageSize) },
  );
}

// ============ 系统：管理员 ============
export function listAdmins(q: PageQuery & { keyword?: string }) {
  return respond(() => paginate(db.admins.filter((a) => matches(q.keyword, a.username, a.displayName, a.email)), q.page, q.pageSize), {
    empty: () => emptyPage<AdminUser>(q.page, q.pageSize),
  });
}

function guardSuperAssignment(roleIds: string[], existing?: AdminUser): void {
  const superRole = db.roles.find((r) => r.code === SUPER_ADMIN_ROLE)!;
  const addsSuper = roleIds.includes(superRole.id) && !(existing?.roleIds.includes(superRole.id) ?? false);
  // 修复 fxsystem S4：只有超级管理员能分配超级管理员角色（包括给自己）
  if (addsSuper && !isSuper(currentAdmin())) throw new ApiError('errors.cannotAssignSuper');
}

/** 原型演示用的临时密码（真实接口由后端生成，只返回一次） */
function demoTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out + '7k';
}

export function createAdmin(input: AdminInput): Promise<TemporaryPassword> {
  return mutate(() => {
    requirePerm('admin:edit');
    if (db.admins.some((a) => a.username === input.username)) throw new ApiError('errors.usernameTaken');
    guardSuperAssignment(input.roleIds);
    const a: AdminUser = { id: Math.max(...db.admins.map((x) => x.id)) + 1, ...input, status: 'active', mustChangePassword: true, lastLoginAt: null, createdAt: nowString() };
    db.admins.push(a);
    audit('admin.create', input.username, true, null, null, { username: input.username, roleIds: input.roleIds, password: '(临时密码)' });
    return { id: a.id, temporaryPassword: demoTempPassword() };
  });
}

export function updateAdmin(id: number, input: AdminInput): Promise<void> {
  return mutate(() => {
    requirePerm('admin:edit');
    const a = db.admins.find((x) => x.id === id);
    if (!a) throw new ApiError('errors.notFound');
    guardSuperAssignment(input.roleIds, a);
    const before = { displayName: a.displayName, email: a.email, roleIds: a.roleIds };
    Object.assign(a, { displayName: input.displayName, email: input.email, roleIds: input.roleIds });
    audit('admin.update', a.username, true, null, before, { displayName: a.displayName, email: a.email, roleIds: a.roleIds });
  });
}

export function setAdminStatus(id: number, active: boolean, reason: string): Promise<void> {
  return mutate(() => {
    requirePerm('admin:edit');
    const r = requireReason(reason);
    const a = db.admins.find((x) => x.id === id);
    if (!a) throw new ApiError('errors.notFound');
    if (a.id === currentAdmin().id) throw new ApiError('errors.cannotDisableSelf');
    if (isSuper(a) && !isSuper(currentAdmin())) throw new ApiError('errors.forbidden');
    a.status = active ? 'active' : 'disabled';
    audit(active ? 'admin.enable' : 'admin.disable', a.username, true, r, { status: active ? 'disabled' : 'active' }, { status: a.status });
  });
}

export function resetAdminPassword(id: number, reason: string): Promise<TemporaryPassword> {
  return mutate(() => {
    requirePerm('admin:edit');
    const r = requireReason(reason);
    const a = db.admins.find((x) => x.id === id);
    if (!a) throw new ApiError('errors.notFound');
    if (isSuper(a) && !isSuper(currentAdmin())) throw new ApiError('errors.forbidden');
    a.mustChangePassword = true;
    // 临时密码只在结果里返回一次（后台方案第 7 节），审计里不出现密码
    audit('admin.reset_password', a.username, true, r, { mustChangePassword: false, password: '***' }, { mustChangePassword: true, password: '***' });
    return { id: a.id, temporaryPassword: demoTempPassword() };
  });
}

// ============ 系统：角色 / 菜单 / 权限 ============
export function listRoles() {
  return respond(
    () => db.roles.map((r) => ({ ...r, memberCount: db.admins.filter((a) => a.roleIds.includes(r.id)).length })),
    { empty: () => [] as Role[] },
  );
}

export function saveRole(id: string | null, input: RoleInput): Promise<void> {
  return mutate(() => {
    requirePerm('role:edit');
    if (id) {
      const r = db.roles.find((x) => x.id === id);
      if (!r) throw new ApiError('errors.notFound');
      if (r.builtIn) throw new ApiError('errors.builtInRole');
      const before = { nameZh: r.nameZh, permissions: r.permissions };
      Object.assign(r, input);
      audit('role.update', r.nameZh, true, null, before, { nameZh: r.nameZh, permissions: r.permissions });
    } else {
      if (input.code === SUPER_ADMIN_ROLE || db.roles.some((r) => r.code === input.code)) throw new ApiError('errors.roleCodeTaken');
      db.roles.push({ id: `R-${db.roles.length + 10}`, ...input, builtIn: false, memberCount: 0 });
      audit('role.create', input.nameZh, true, null, null, { code: input.code, permissions: input.permissions });
    }
  });
}

export function deleteRole(id: string): Promise<void> {
  return mutate(() => {
    requirePerm('role:edit');
    const r = db.roles.find((x) => x.id === id);
    if (!r) throw new ApiError('errors.notFound');
    if (r.builtIn) throw new ApiError('errors.builtInRole');
    if (db.admins.some((a) => a.roleIds.includes(id))) throw new ApiError('errors.roleInUse');
    db.roles.splice(db.roles.indexOf(r), 1);
    audit('role.delete', r.nameZh, true, null, { code: r.code }, null);
  });
}

function toMenuNodes(items: MenuItemDef[]): MenuNode[] {
  return items.map((m, i) => ({
    key: m.key,
    path: m.path ?? null,
    labelKey: m.labelKey,
    permission: m.permission ?? null,
    order: (i + 1) * 10,
    visible: true,
    children: m.children ? toMenuNodes(m.children) : undefined,
  }));
}
const menuTree: MenuNode[] = toMenuNodes(MENU);

export function listMenus() {
  return respond(() => menuTree, { empty: () => [] as MenuNode[] });
}

export function updateMenu(key: string, patch: Pick<MenuNode, 'order'> & Partial<Pick<MenuNode, 'visible'>>): Promise<void> {
  return mutate(() => {
    requirePerm('menu:edit');
    const walk = (nodes: MenuNode[]): MenuNode | undefined => nodes.reduce<MenuNode | undefined>((f, n) => f ?? (n.key === key ? n : walk(n.children ?? [])), undefined);
    const n = walk(menuTree);
    if (!n) throw new ApiError('errors.notFound');
    const before = { order: n.order, visible: n.visible };
    n.order = patch.order;
    if (patch.visible !== undefined) n.visible = patch.visible;
    audit('menu.update', key, false, null, before, { order: n.order, visible: n.visible });
  });
}

export function listPermissions() {
  return respond(() => [...PERMISSIONS], { empty: () => [] });
}

// ============ 系统：审计、配置 ============
export function listAuditLogs(q: AuditQuery) {
  return respond(
    () =>
      paginate(
        db.auditLogs
          .filter((l) => (!q.action || l.action === q.action) && (!q.admin || l.adminName === q.admin) && (!q.highRiskOnly || l.highRisk) && matches(q.keyword, l.target, l.adminName, l.reason))
          .map((l) => ({ ...l, before: scrub(l.before), after: scrub(l.after) })),
        q.page,
        q.pageSize,
      ),
    { empty: () => emptyPage<AuditLog>(q.page, q.pageSize) },
  );
}

export function listAuditActions(): Promise<string[]> {
  return respond(() => [...new Set(db.auditLogs.map((l) => l.action))].sort(), { bypass: true });
}

export function listSystemConfigs() {
  return respond(() => db.systemConfigs, { empty: () => [] as typeof db.systemConfigs });
}

export function updateSystemConfig(key: string, value: string, reason: string): Promise<void> {
  return mutate(() => {
    requirePerm('config:edit');
    const r = requireReason(reason);
    const c = db.systemConfigs.find((x) => x.key === key);
    if (!c) throw new ApiError('errors.notFound');
    const before = c.value;
    c.value = value;
    c.updatedAt = nowString();
    audit('config.update', key, true, r, { value: before }, { value });
  });
}
