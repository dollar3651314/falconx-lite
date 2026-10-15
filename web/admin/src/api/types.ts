/**
 * 后台接口的数据类型。按将来的真实接口设计：金额一律是十进制字符串，时间是 "YYYY-MM-DD HH:mm:ss"（UTC+8）。
 * Admin API types. Amounts are decimal strings; timestamps are "YYYY-MM-DD HH:mm:ss" strings.
 */

export type Chain = 'ERC20' | 'TRC20' | 'BSC';
export type Side = 'buy' | 'sell';
export type Lang = 'zh-CN' | 'en';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageQuery {
  page: number;
  pageSize: number;
}

/** 接口错误：reasonKey 是翻译键，界面显示具体原因，不显示错误代码 */
export class ApiError extends Error {
  readonly reasonKey: string;
  readonly params?: Record<string, string | number>;
  constructor(reasonKey: string, params?: Record<string, string | number>) {
    super(reasonKey);
    this.name = 'ApiError';
    this.reasonKey = reasonKey;
    this.params = params;
  }
}

// ---------- 认证 / 身份 ----------
export type RoleCode = 'super_admin' | 'operations' | 'risk' | string;

export interface AdminSession {
  token: string;
  adminId: number;
  username: string;
  displayName: string;
  /** 首次登录必须先改密码 */
  mustChangePassword: boolean;
}

// ---------- 仪表盘 ----------
export interface DashboardStats {
  todayRegistrations: number;
  onlineCustomers: number;
  todayDeposit: string;
  todayDepositCount: number;
  todayWithdraw: string;
  todayWithdrawCount: number;
  openPositions: number;
  platformPnl: string;
  platformNetExposure: string;
  platformThreshold: string;
  pendingKyc: number;
  pendingWithdrawals: number;
  failedTasks: number;
  openReconciliations: number;
  updatedAt: string;
}

export interface MenuBadges {
  kyc: number;
  withdrawals: number;
}

// ---------- 客户 ----------
export type CustomerStatus = 'active' | 'frozen';
export type KycStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface CustomerSummary {
  id: number;
  name: string;
  email: string;
  nationality: string;
  status: CustomerStatus;
  kycStatus: KycStatus;
  balance: string;
  openPositions: number;
  registeredAt: string;
  lastLoginAt: string | null;
}

export interface CustomerQuery extends PageQuery {
  keyword?: string;
  status?: CustomerStatus;
  kycStatus?: KycStatus;
}

export type LedgerType = 'deposit' | 'withdraw' | 'fee' | 'pnl' | 'swap' | 'adjust' | 'refund';

export interface LedgerEntry {
  id: string;
  type: LedgerType;
  amount: string;
  balanceAfter: string;
  ref: string;
  time: string;
}

export interface Position {
  id: string;
  customerId: number;
  customerName: string;
  symbol: string;
  side: Side;
  lots: string;
  openPrice: string;
  currentPrice: string;
  leverage: number;
  margin: string;
  pnl: string;
  /** 保证金水平（百分比字符串，如 "182.5"） */
  marginLevel: string;
  liquidationPrice: string;
  stopLoss: string | null;
  takeProfit: string | null;
  openedAt: string;
}

export interface CustomerDetail extends CustomerSummary {
  firstName: string;
  middleName: string;
  lastName: string;
  birthDate: string;
  frozenReason: string | null;
  kyc: {
    status: KycStatus;
    docType: DocType | null;
    docNumber: string | null;
    reviewedAt: string | null;
    rejectReason: string | null;
  };
  account: {
    balance: string;
    usedMargin: string;
    available: string;
    floatingPnl: string;
    frozenWithdraw: string;
  };
  positions: Position[];
  ledger: LedgerEntry[];
}

export interface AdjustLimits {
  singleLimit: string;
  dailyLimit: string;
  usedToday: string;
}

// ---------- KYC ----------
export type DocType = 'id_card' | 'passport';

export interface KycApplication {
  id: string;
  customerId: number;
  name: string;
  email: string;
  nationality: string;
  birthDate: string;
  docType: DocType;
  docNumber: string;
  status: Exclude<KycStatus, 'none'>;
  submittedAt: string;
  reviewer: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
}

export interface KycQuery extends PageQuery {
  status?: KycApplication['status'];
  keyword?: string;
}

// ---------- 资金 ----------
export type DepositStatus = 'confirming' | 'credited' | 'ignored' | 'reversed';

export interface Deposit {
  id: string;
  customerId: number;
  customerName: string;
  email: string;
  chain: Chain;
  txHash: string;
  amount: string;
  confirmations: number;
  requiredConfirmations: number;
  status: DepositStatus;
  detectedAt: string;
  creditedAt: string | null;
}

export interface DepositQuery extends PageQuery {
  chain?: Chain;
  status?: DepositStatus;
  keyword?: string;
}

export type WithdrawalStatus =
  | 'cooling'
  | 'pending'
  | 'delayed'
  | 'broadcasting'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'failed';

export interface Withdrawal {
  id: string;
  customerId: number;
  customerName: string;
  email: string;
  amount: string;
  fee: string;
  chain: Chain;
  address: string;
  firstUse: boolean;
  whitelistAddedAt: string;
  status: WithdrawalStatus;
  /** 延迟期剩余分钟数（仅 delayed） */
  delayRemainingMinutes: number | null;
  submittedAt: string;
  reviewer: string | null;
  reason: string | null;
  txHash: string | null;
}

export interface WithdrawalDetail extends Withdrawal {
  kycStatus: KycStatus;
  registeredDays: number;
  totalDeposit: string;
  balance: string;
  openPositions: number;
  recentDeposits: { time: string; chain: Chain; amount: string }[];
  recentWithdrawals: { time: string; chain: Chain; amount: string }[];
}

/** 筛选：open = 待处理（全部：冷静期 + 待审核 + 延迟期） */
export interface WithdrawalQuery extends PageQuery {
  status?: WithdrawalStatus | 'open';
  chain?: Chain;
  minAmount?: string;
  maxAmount?: string;
  keyword?: string;
}

export interface WithdrawalSummary {
  pending: { count: number; amount: string };
  delayed: { count: number; amount: string };
  cooling: { count: number; amount: string };
  completedToday: { count: number; amount: string };
}

export type ReconType = 'missing_credit' | 'amount_mismatch' | 'reversal_shortfall' | 'unknown_tx';

export interface ReconItem {
  id: string;
  chain: Chain;
  txHash: string;
  customerId: number | null;
  customerName: string | null;
  type: ReconType;
  chainAmount: string;
  ledgerAmount: string;
  diff: string;
  status: 'open' | 'resolved';
  note: string | null;
  handler: string | null;
  detectedAt: string;
}

export interface ReconQuery extends PageQuery {
  status?: ReconItem['status'];
  chain?: Chain;
}

export type TaskType = 'withdraw_broadcast' | 'withdraw_confirm' | 'email' | 'push';
export type TaskStatus = 'pending' | 'processing' | 'success' | 'failed';

export interface TaskItem {
  id: string;
  type: TaskType;
  bizRef: string;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskQuery extends PageQuery {
  type?: TaskType;
  status?: TaskStatus;
}

// ---------- 交易监控 ----------
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'filled' | 'pending' | 'cancelled' | 'rejected';
export type RejectReason =
  | 'outside_session'
  | 'symbol_paused'
  | 'global_paused'
  | 'fx_stale'
  | 'leverage_exceeded'
  | 'position_limit'
  | 'insufficient_balance';

export interface Order {
  id: string;
  customerId: number;
  customerName: string;
  symbol: string;
  side: Side;
  type: OrderType;
  lots: string;
  price: string;
  leverage: number;
  fee: string;
  status: OrderStatus;
  rejectReason: RejectReason | null;
  createdAt: string;
}

export interface TradeQuery extends PageQuery {
  symbol?: string;
  side?: Side;
  status?: OrderStatus;
  keyword?: string;
}

export interface PendingOrder {
  id: string;
  customerId: number;
  customerName: string;
  symbol: string;
  side: Side;
  lots: string;
  limitPrice: string;
  currentPrice: string;
  leverage: number;
  frozenMargin: string;
  stopLoss: string | null;
  takeProfit: string | null;
  createdAt: string;
}

// ---------- 风控 ----------
export type ExposureStatus = 'normal' | 'near' | 'auto_blocked' | 'manual_paused';

export interface SymbolExposure {
  symbol: string;
  nameZh: string;
  nameEn: string;
  longUsd: string;
  shortUsd: string;
  netUsd: string;
  thresholdUsd: string;
  status: ExposureStatus;
}

export interface RiskSettings {
  globalPause: boolean;
  autoLiquidation: boolean;
  platformNetUsd: string;
  platformThresholdUsd: string;
  /** 平台总净敞口超过阈值后自动禁止全部新开仓 */
  platformBlocked: boolean;
  perUserLimitUsd: string;
  updatedAt: string;
}

export type RiskEventType =
  | 'auto_block_symbol'
  | 'auto_block_platform'
  | 'manual_pause'
  | 'manual_resume'
  | 'global_pause_on'
  | 'global_pause_off'
  | 'auto_liq_on'
  | 'auto_liq_off'
  | 'threshold_change'
  | 'fx_stale_block';

export interface RiskEvent {
  id: string;
  time: string;
  actorType: 'system' | 'admin';
  actorName: string | null;
  type: RiskEventType;
  symbol: string | null;
  value: string | null;
  threshold: string | null;
  reason: string | null;
}

// ---------- 品种与行情 ----------
export type SymbolCategory = 'forex_major' | 'forex_cross' | 'cnh' | 'metal' | 'index' | 'energy' | 'crypto' | 'stock';

export interface TradingSymbol {
  code: string;
  nameZh: string;
  nameEn: string;
  category: SymbolCategory;
  quoteCurrency: string;
  lpSymbol: string;
  contractSize: string;
  minLots: string;
  maxLeverage: number;
  maintenanceMarginRate: string;
  openFeeRate: string;
  /** 隔夜费率（每日，按名义价值），null 表示未配置：不收隔夜费，后台标红 */
  swapLong: string | null;
  swapShort: string | null;
  spreadPoints: number;
  digits: number;
  hot: boolean;
  enabled: boolean;
  sessionId: string;
  updatedAt: string;
}

export interface SymbolQuery extends PageQuery {
  category?: SymbolCategory;
  keyword?: string;
  enabled?: boolean;
  missingSwap?: boolean;
}

export interface TradingSession {
  id: string;
  nameZh: string;
  nameEn: string;
  /** 每行一个时段描述，如 "周日 22:00 – 周五 22:00" 由前端翻译星期 */
  ranges: { fromDay: number; fromTime: string; toDay: number; toTime: string }[];
  dailyBreak: string | null;
  symbolCount: number;
}

export interface Holiday {
  id: string;
  date: string;
  sessionId: string;
  nameZh: string;
  nameEn: string;
  closure: 'full' | 'early';
  closeTime: string | null;
}

export interface FxRate {
  pair: string;
  rate: string;
  source: string;
  updatedAt: string;
  ageSeconds: number;
  status: 'ok' | 'stale';
  affectedSymbols: string[];
}

// ---------- 交易参数 ----------
export interface TradingParams {
  /** 追保线（保证金水平 %） */
  marginCallLevel: string;
  /** 强平线（保证金水平 %） */
  liquidationLevel: string;
  marginCallThrottleMinutes: number;
  updatedAt: string;
  updatedBy: string;
}

// ---------- 通知 ----------
export type NotifyChannel = 'inbox' | 'push' | 'email';

export interface NotifyTemplate {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string;
  builtIn: boolean;
  enabled: boolean;
  channels: NotifyChannel[];
  titleZh: string;
  bodyZh: string;
  titleEn: string;
  bodyEn: string;
  variables: string[];
  updatedAt: string;
}

export interface NotifyRecord {
  id: string;
  customerId: number;
  customerName: string;
  source: 'template' | 'manual';
  templateCode: string | null;
  channel: NotifyChannel;
  title: string;
  status: 'sent' | 'failed' | 'skipped';
  error: string | null;
  operator: string | null;
  time: string;
}

export interface NotifyRecordQuery extends PageQuery {
  channel?: NotifyChannel;
  status?: NotifyRecord['status'];
  keyword?: string;
}

export interface ManualNotifyInput {
  customerId: number;
  channels: NotifyChannel[];
  title: string;
  body: string;
  reason: string;
}

// ---------- 系统 ----------
export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  email: string;
  roleIds: string[];
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminInput {
  username: string;
  displayName: string;
  email: string;
  roleIds: string[];
}

export interface Role {
  id: string;
  code: RoleCode;
  nameZh: string;
  nameEn: string;
  description: string;
  permissions: string[];
  builtIn: boolean;
  memberCount: number;
}

export interface RoleInput {
  code: string;
  nameZh: string;
  nameEn: string;
  description: string;
  permissions: string[];
}

export interface MenuNode {
  key: string;
  path: string | null;
  labelKey: string;
  permission: string | null;
  order: number;
  visible: boolean;
  children?: MenuNode[];
}

export interface PermissionDef {
  code: string;
  module: string;
  highRisk: boolean;
}

export type AuditValue = string | number | boolean | null | string[];

export interface AuditLog {
  id: string;
  time: string;
  adminName: string;
  ip: string;
  action: string;
  target: string;
  highRisk: boolean;
  result: 'success' | 'failure';
  reason: string | null;
  before: Record<string, AuditValue> | null;
  after: Record<string, AuditValue> | null;
}

export interface AuditQuery extends PageQuery {
  action?: string;
  admin?: string;
  highRiskOnly?: boolean;
  keyword?: string;
}

export interface SystemConfig {
  key: string;
  value: string;
  unit: 'usdt' | 'hours' | 'minutes' | 'count' | 'percent' | 'text';
  group: 'withdraw' | 'deposit' | 'security' | 'adjust' | 'notify';
  updatedAt: string;
}
