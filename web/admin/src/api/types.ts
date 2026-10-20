/**
 * 后台接口的数据类型，字段和后端 `backend/src/main/java/com/falconx/lite/admin/` 返回的 record 一致。
 * 金额一律是十进制字符串。时间：真实接口是 ISO UTC 字符串（如 "2026-10-14T01:12:33Z"），模拟数据是 "YYYY-MM-DD HH:mm:ss"（UTC+8），
 * 页面统一用 utils/display 的 fullTime / shortTime 显示成 UTC+8。
 * Admin API types. Amounts are decimal strings; real timestamps are ISO UTC, mock ones "YYYY-MM-DD HH:mm:ss".
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

/** 后端字段错误（`{field, code}`，code 如 required、invalid、tooLong、weak） */
export interface FieldError {
  field: string;
  code: string;
}

/**
 * 接口错误：reasonKey 是翻译键，界面显示具体原因，不显示错误代码。
 * 真实接口另带 HTTP 状态、后端错误码和字段错误（字段错误由 utils/errors 翻译成"哪个字段、什么问题"）。
 */
export class ApiError extends Error {
  readonly reasonKey: string;
  readonly params?: Record<string, string | number>;
  readonly status?: number;
  readonly code?: string;
  readonly fields?: FieldError[];
  constructor(reasonKey: string, params?: Record<string, string | number>, extra?: { status?: number; code?: string; fields?: FieldError[] }) {
    super(reasonKey);
    this.name = 'ApiError';
    this.reasonKey = reasonKey;
    this.params = params;
    this.status = extra?.status;
    this.code = extra?.code;
    this.fields = extra?.fields;
  }
}

// ---------- 认证 / 身份 ----------
export type RoleCode = 'super_admin' | 'operations' | 'risk' | string;

/** 登录结果。真实接口不返回令牌（令牌只在 HttpOnly Cookie 里，后台方案第 7 节）；模拟层带一个演示用的 token */
export interface AdminSession {
  token?: string;
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
  /** 为空表示没有设置平台阈值 */
  platformThreshold: string | null;
  pendingKyc: number;
  pendingWithdrawals: number;
  failedTasks: number;
  openReconciliations: number;
  updatedAt: string;
}

/** 当前管理员（GET /api/admin/me）。menus 是后端按权限点和"是否显示"过滤后的菜单；模拟层不返回，按本地菜单配置显示 */
export interface CurrentAdmin {
  admin: AdminUser;
  roles: Role[];
  permissions: string[];
  isSuperAdmin: boolean;
  menus?: MenuNode[];
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

/** 资金流水类型；真实接口里没有对应的账本类型用小写原名（如 order_freeze） */
export type LedgerType = 'deposit' | 'withdraw' | 'fee' | 'pnl' | 'swap' | 'adjust' | 'refund' | string;

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
  /** 真实接口（客户详情）在没有报价时为空，页面用 Amount 显示成"—" */
  pnl: string;
  /** 保证金水平（百分比字符串，如 "182.5"）；真实接口没有报价时为空 */
  marginLevel: string;
  liquidationPrice: string;
  stopLoss: string | null;
  takeProfit: string | null;
  openedAt: string;
}

export interface CustomerDetail extends CustomerSummary {
  /** 最近一次登录的 IP 和时间（v2 E6，取最近一个登录会话）；从没登录过为空 */
  lastLoginIp?: string | null;
  lastLoginIpAt?: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  birthDate: string | null;
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

/** 后台编辑客户资料（v2 E1）：只有这 5 项；邮箱不能改，状态只能用冻结 / 解冻改 */
export interface CustomerProfileInput {
  firstName: string;
  middleName: string;
  lastName: string;
  /** YYYY-MM-DD */
  birthDate: string;
  /** ISO 3166-1 两位大写字母 */
  nationality: string;
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
  /** v2 自动审批（技术方案/v2-提现自动审批.md）：最近一次规则判定的摘要；没有判定记录（功能上线前的提现）时为空 */
  autoReview?: AutoReviewSummary | null;
}

// ---------- v2 提现自动审批（技术方案/v2-提现自动审批.md 第 7.2 节；后端 admin/ops/AutoApproveOps.java） ----------
export type AutoRuleCode = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11' | 'R12' | 'R13';
/** 判定结果：自动通过 / 转人工（有规则没通过）/ 总开关关闭（全部人工，规则照常判定做参考）/ 判定出错（按转人工处理） */
export type AutoReviewOutcome = 'auto_approved' | 'manual' | 'master_off' | 'error';
/** 判定时机：提交时预判（只做参考，不占额度）/ 冷静期结束时复判（以这次为准） */
export type AutoReviewPhase = 'precheck' | 'final';

export interface AutoReviewSummary {
  phase: AutoReviewPhase;
  outcome: AutoReviewOutcome;
  /** 没通过的规则（含无法判定的），按编号排序；全部通过时为空 */
  failed: AutoRuleCode[];
  decidedAt: string;
}

/** 一条规则的判定结果。values 是判定时刻的实际数值和阈值（快照），前端按规则的模板显示，以后改规则不影响 */
export interface AutoRuleResult {
  code: AutoRuleCode;
  status: 'passed' | 'failed' | 'disabled' | 'unknown';
  values: Record<string, string>;
}

export interface AutoReviewDetail extends AutoReviewSummary {
  /** 判定时总开关的状态（快照） */
  masterEnabled: boolean;
  rules: AutoRuleResult[];
  /** 判定时用的规则配置版本和这一版的修改人、时间 */
  configVersion: number;
  configChangedAt: string | null;
  configChangedBy: string | null;
  /** 复判记录上附带提交时的预判摘要（冷静期中的提现只有预判） */
  precheck: AutoReviewSummary | null;
}

/** 出金列表的"规则判定"筛选：判定结果，或触发了某条规则 */
export type AutoReviewFilter = 'auto_approved' | 'manual' | 'master_off' | 'none' | AutoRuleCode;

export interface AutoRuleSetting {
  code: AutoRuleCode;
  enabled: boolean;
  /** 数值参数（字符串，和系统配置一样）；没有数值的规则为空对象 */
  params: Record<string, string>;
}

export interface AutoApproveSettings {
  /** 总开关，默认关闭（= 全部人工审核） */
  masterEnabled: boolean;
  rules: AutoRuleSetting[];
  /** 配置版本：每次保存 +1，判定记录里记这个号 */
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface AutoApproveSettingsInput {
  masterEnabled: boolean;
  rules: AutoRuleSetting[];
  reason: string;
  /** 页面打开时读到的版本；后端发现版本变了返回 409 CONFIG_CHANGED（防止两个人同时改互相覆盖） */
  expectedVersion: number;
}

/** 一次保存的修改记录（同时写审计日志 withdrawal.auto_rule_update） */
export interface AutoApproveChange {
  id: string;
  version: number;
  time: string;
  adminName: string;
  reason: string;
  /** field：master，或 R1.enabled、R1.maxAmount 这样的"规则.参数" */
  changes: { field: string; before: string; after: string }[];
}

export interface WithdrawalDetail extends Withdrawal {
  /** v2 自动审批：规则判定卡片的数据（逐条结果；判定时有几条就是几条，R13 上线前的记录只有 12 条） */
  autoReviewDetail?: AutoReviewDetail | null;
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
  /** v2 自动审批：按最近一次判定的结果或触发的规则筛选 */
  autoReview?: AutoReviewFilter;
}

export interface WithdrawalSummary {
  pending: { count: number; amount: string };
  delayed: { count: number; amount: string };
  cooling: { count: number; amount: string };
  completedToday: { count: number; amount: string };
}

/** 对账问题类型：按后端的 7 种（数据库设计第 16 节、后台方案第 8 节），不再用原型的 4 种；v2 资金归集加 3 种（方案第 4.8 节） */
export type ReconType =
  | 'sweep_unknown_outflow'
  | 'sweep_dest_mismatch'
  | 'sweep_amount_mismatch'
  | 'deposit_ledger_mismatch'
  | 'deposit_unknown_credit'
  | 'deposit_reversal_mismatch'
  | 'deposit_not_on_chain'
  | 'suspense_open'
  | 'withdraw_ledger_mismatch'
  | 'withdraw_frozen_mismatch';

/** 对账问题（后台方案第 8 节）：ref 是关联的业务编号，expected 应有、actual 实际、diff = actual - expected */
export interface ReconItem {
  id: string;
  type: ReconType | string;
  ref: string;
  customerId: number | null;
  customerName: string | null;
  expected: string | null;
  actual: string | null;
  diff: string | null;
  /** 后端生成的说明（中文） */
  detail: string | null;
  status: 'open' | 'resolved';
  note: string | null;
  handler: string | null;
  detectedAt: string;
  resolvedAt: string | null;
}

/**
 * 热钱包余额（对账页上方，GET /api/admin/hot-wallets）。status：ok 正常、low 低于告警下限、off 下限为 0 不告警、unknown 还没查到余额。
 * threshold 是系统配置页的下限（hotWallet.*）；error 是最近一次查询失败的原因
 */
export interface HotWalletBalance {
  chain: 'ERC20' | 'BSC' | 'TRC20';
  asset: 'USDT' | 'ETH' | 'BNB' | 'TRX';
  gas: boolean;
  address: string;
  balance: string | null;
  threshold: string;
  status: 'ok' | 'low' | 'off' | 'unknown';
  checkedAt: string | null;
  error: string | null;
}

export interface ReconQuery extends PageQuery {
  status?: ReconItem['status'];
}

/** 任务类型：只有邮件和推送（提现的广播和确认不走任务表，后台方案第 8 节） */
export type TaskType = 'email' | 'push';
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
/** 订单状态：被拒绝的下单请求后端不保存，所以没有 rejected（后台方案第 9 节） */
export type OrderStatus = 'filled' | 'pending' | 'cancelled';
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
  /** 为空表示这个品种不监控净敞口 */
  thresholdUsd: string | null;
  status: ExposureStatus;
}

export interface RiskSettings {
  globalPause: boolean;
  autoLiquidation: boolean;
  platformNetUsd: string;
  /** 为空表示不监控平台总净敞口 */
  platformThresholdUsd: string | null;
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

/** 风控看板（后端字段是 symbols，这里叫 exposures，在 api/real.ts 转换） */
export interface RiskOverview {
  settings: RiskSettings;
  exposures: SymbolExposure[];
  events: RiskEvent[];
}

// ---------- 品种与行情 ----------
/** 原型用细分的外汇类别；后端（真实接口）外汇只有一个 fx */
export type SymbolCategory = 'fx' | 'forex_major' | 'forex_cross' | 'cnh' | 'metal' | 'index' | 'energy' | 'crypto' | 'stock';

/**
 * 品种（字段按后端，后台方案第 9 节）：没有原型的 lpSymbol、spreadPoints、sessionId；
 * 有 markup（统一加点，价格单位）、maxLots、lotStep、openPaused（风控暂停开仓）、sortOrder。
 */
export interface TradingSymbol {
  code: string;
  nameZh: string;
  nameEn: string;
  category: SymbolCategory;
  quoteCurrency: string;
  contractSize: string;
  minLots: string;
  maxLots: string;
  lotStep: string;
  maxLeverage: number;
  maintenanceMarginRate: string;
  openFeeRate: string;
  /** 隔夜费率（每日，按名义价值），null 表示未配置：不收隔夜费，后台标红（真实接口里多空都是 0 即未配置） */
  swapLong: string | null;
  swapShort: string | null;
  /** 统一加点（价格单位），只在行情入口加一次 */
  markup: string;
  digits: number;
  hot: boolean;
  enabled: boolean;
  /** 风控暂停开仓（在风控页操作） */
  openPaused: boolean;
  sortOrder: number;
  updatedAt: string | null;
  /** 最后一条正常报价的时间（v2 E6）；从没收到过为空（显示"暂无报价"） */
  lastQuoteAt?: string | null;
  /** 现在是否在交易时段内：休市时没有报价是正常的，不标红 */
  tradingOpen?: boolean;
  /** 模拟起始价（只在模拟报价源下使用，见 SymbolPage.simulatedQuotes）；没填为空 */
  simStartPrice?: string | null;
  /** 当前报价源：alltick / itick / binance / simulated；没有报价源为空（技术方案/v2-报价源接入.md 第 5.5 节） */
  quoteSource?: string | null;
  /** primary 主源 / backup 正在用备源 / deviation 两家偏差过大、暂停开仓（平仓照常，用主源价格）；模拟为空 */
  quoteSourceState?: 'primary' | 'backup' | 'deviation' | null;
}

/** 品种列表：多一个 simulatedQuotes（当前报价源是不是模拟源，是的话新增和编辑里显示"模拟起始价"） */
export interface SymbolPage extends Page<TradingSymbol> {
  simulatedQuotes: boolean;
}

/**
 * 改品种参数：合约大小、报价货币、小数位不能改；openPaused 是品种自己的"暂停开仓"（新增的品种默认暂停，在这里打开）；
 * simStartPrice 给已建好的品种补模拟起始价（只在模拟报价源下生效，否则后端忽略；不传表示不改）。
 */
export type SymbolPatch = Partial<
  Pick<
    TradingSymbol,
    'nameZh' | 'nameEn' | 'maxLeverage' | 'minLots' | 'maxLots' | 'lotStep' | 'openFeeRate' | 'maintenanceMarginRate' | 'markup' | 'swapLong' | 'swapShort' | 'hot' | 'sortOrder' | 'openPaused'
  >
> & { simStartPrice?: string };

/** 新增品种的交易时段模板（UTC）：fx 周日 22:00–周五 21:00；crypto 全天候；us_stock 周一至周五 13:30–20:00 */
export type SessionTemplate = 'fx' | 'crypto' | 'us_stock';

/**
 * 新增品种（v2 E3）。新增后默认暂停开仓；隔夜费率未配置（标红）。
 * 交易时段二选一：copySessionsFrom（从已有品种复制）或 sessionTemplate（模板）。
 */
export interface SymbolCreateInput {
  code: string;
  nameZh: string;
  nameEn: string;
  category: SymbolCategory;
  digits: number;
  contractSize: string;
  quoteCurrency: string;
  maxLeverage: number;
  maintenanceMarginRate: string;
  openFeeRate: string;
  minLots: string;
  maxLots: string;
  lotStep: string;
  markup: string;
  hot: boolean;
  copySessionsFrom?: string;
  sessionTemplate?: SessionTemplate;
  /** 模拟起始价（可选，正数，小数位不超过 digits）：只在模拟报价源下生效，否则后端忽略 */
  simStartPrice?: string;
}

export interface SymbolQuery extends PageQuery {
  category?: SymbolCategory;
  keyword?: string;
  enabled?: boolean;
  missingSwap?: boolean;
}

/** 一个品种一周的交易时段（UTC，只读，后台方案第 9 节）；day 1 = 周一 … 7 = 周日 */
export interface TradingSession {
  symbol: string;
  ranges: { day: number; open: string; close: string }[];
}

/** 休市日：按品种（"*" 表示全部品种），只有全天休市 */
export interface Holiday {
  id: string;
  date: string;
  symbol: string;
  reason: string | null;
}

export interface HolidayInput {
  symbol: string;
  date: string;
  reason?: string;
}

export interface FxRate {
  /** 后端另带货币代码 */
  currency?: string;
  pair: string;
  rate: string;
  source: string;
  updatedAt: string | null;
  ageSeconds: number | null;
  status: 'ok' | 'stale';
  affectedSymbols: string[];
}

// ---------- 交易参数 ----------
/** 交易参数：追保线和追保通知间隔；强平按品种维持保证金率逐仓处理，没有账户级强平线（G6），liquidationLevel 总是空 */
export interface TradingParams {
  /** 追保线（保证金水平 %） */
  marginCallLevel: string;
  liquidationLevel: string | null;
  marginCallThrottleMinutes: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface TradingParamsInput {
  marginCallLevel: string;
  marginCallThrottleMinutes: number;
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
  /** 按邮箱发的（风控人员等）没有客户号，customerName 是收件人 */
  customerId: number | null;
  customerName: string;
  source: 'template' | 'manual';
  templateCode: string | null;
  channel: NotifyChannel;
  title: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
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

/** 新建管理员、重置密码的结果：临时密码只返回这一次（后台方案第 7 节），页面在弹窗里显示一次 */
export interface TemporaryPassword {
  id: number;
  temporaryPassword: string;
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
  /** eth / bnb / trx：热钱包手续费币的告警下限 */
  unit: 'usdt' | 'hours' | 'minutes' | 'count' | 'percent' | 'text' | 'eth' | 'bnb' | 'trx';
  /** hotWallet：热钱包余额告警下限（0 = 不告警） */
  group: 'withdraw' | 'deposit' | 'security' | 'adjust' | 'notify' | 'hotWallet';
  /** 从没改过时为空 */
  updatedAt: string | null;
}

// ---------- v2 资金归集（原型，技术方案/v2-半自动归集.md 路线 (b)；真实接口上线前只有模拟层提供） ----------
export type SweepChain = 'ERC20' | 'BSC' | 'TRC20';
/** 归集方式：以太坊、BSC 是合约转发地址 + 服务器自动归集；TRON 是普通地址 + Amos 离线签名 */
export type SweepMode = 'contract' | 'offline';
export type SweepBatchStatus =
  /** 真实接口：已建批次、交易还没发出 */
  | 'pending'
  | 'sent'
  | 'confirmed'
  | 'partial'
  | 'failed'
  | 'deferred'
  | 'topping_up'
  | 'awaiting_signature'
  | 'signed'
  | 'broadcasting'
  | 'cancelled'
  | 'expired';
export type SweepItemStatus = 'pending' | 'swept' | 'failed' | 'topup_sent' | 'ready' | 'signed' | 'sign_rejected' | 'broadcast' | 'expired' | 'cancelled';
/** 预览里这个地址这次为什么不归集 */
export type SweepSkipReason =
  | 'pendingDeposit'
  | 'recentCredit'
  | 'inBatch'
  | 'feeRatio'
  | 'belowThreshold'
  | 'overAddressCap'
  | 'overBatchCap'
  /** 真实接口：超过每批地址数（100） */
  | 'batchFull'
  /** 真实接口：旧一套合约参数的地址（换过工厂 / parent / 批量合约），这一批不处理 */
  | 'otherScheme';
/** TRON 租能量的状态（方案 v1.1 第 4.3 节）：广播前给每个充值地址租能量，确认到账再广播 */
export type SweepRentStatus = 'none' | 'ordered' | 'delivered' | 'fallbackBurn' | 'notDelivered' | 'expired';
export interface SweepRent {
  status: SweepRentStatus;
  /** 租的能量 */
  energy: number;
  /** 租金（TRX）；回退烧 TRX 时是热钱包补的 TRX */
  trx: string;
  /** 租赁到期时间 */
  expiresAt: string | null;
}

export interface SweepOverview {
  chain: SweepChain;
  mode: SweepMode;
  /** 达到门槛的地址的 USDT 合计 */
  pendingUsdt: string;
  eligibleCount: number;
  /** 有余额但没到门槛的地址数 */
  belowCount: number;
  /** 冷钱包地址（以太坊、BSC 是合约里的 parent，TRON 是后台配置的） */
  destination: string | null;
  /** 以太坊、BSC 发起账户的手续费币余额；TRON 为空 */
  operatorBalance: string | null;
  gasAsset: string;
  lastSweepAt: string | null;
  /** 进行中的批次号 */
  activeBatch: string | null;
  /** 真实接口：这条链现在能不能执行归集；不能时 unavailable 是原因（例如没配合约地址、TRON 下一阶段） */
  available?: boolean;
  unavailable?: string | null;
  /** 真实接口：待归集金额的查询时间（每 5 分钟或打开预览时） */
  checkedAt?: string | null;
}

export interface SweepCandidate {
  userId: number;
  customerName: string;
  address: string;
  /** TRON：派生序号（= 用户 ID） */
  index: number;
  usdt: string;
  /** 以太坊、BSC：这次是否要顺便部署转发合约 */
  deploy: boolean;
  /** TRON：热钱包转入的 TRX（只有没激活的地址要转 1 TRX 激活）；以太坊、BSC 为 "0" */
  topup: string;
  /** TRON：这个地址还没激活（只收过 TRC20 不会激活账户），要先转 TRX */
  activate: boolean;
  /** TRON：预计租金（TRX）；以太坊、BSC 为 "0" */
  rentTrx: string;
  /** 预估手续费（手续费币） */
  estFee: string;
  estFeeUsd: string;
  skip: SweepSkipReason | null;
}

export interface SweepPreview {
  chain: SweepChain;
  mode: SweepMode;
  destination: string | null;
  threshold: string;
  maxFeeRatioPct: string;
  /** 当前 gas 价格（显示用文字） */
  gasPrice: string;
  gasAsset: string;
  candidates: SweepCandidate[];
  totals: { count: number; usdt: string; fee: string; feeUsd: string; feePct: string; topup: string; rent: string; skipped: number };
  /** TRON：租能量的报价（以太坊、BSC 为空） */
  tronRent: { mode: SweepTronEnergyMode; provider: string; priceSun: string; energyPerItem: number; durationMin: number; burnSun: string } | null;
  /** 真实接口：提示，例如 priceMissing（查不到 ETH / BNB 价格，没有检查手续费占比） */
  warnings?: string[];
}

export interface SweepBatch {
  no: string;
  chain: SweepChain;
  mode: SweepMode;
  status: SweepBatchStatus;
  trigger: 'manual' | 'auto';
  addressCount: number;
  expectedUsdt: string;
  sweptUsdt: string;
  fee: string;
  gasAsset: string;
  destination: string;
  createdBy: string;
  createdAt: string;
  finishedAt: string | null;
  /** TRON：待签名清单的有效期 */
  expiresAt: string | null;
  /** 以太坊、BSC：批量交易的哈希 */
  txHash: string | null;
}

export interface SweepItem {
  itemNo: number;
  userId: number;
  customerName: string;
  address: string;
  amount: string;
  deploy: boolean;
  topup: string;
  status: SweepItemStatus;
  txHash: string | null;
  /** 失败或核对不通过的原因：原型是翻译键 sweepFail.* 的后缀；真实接口是后端给的中文说明 */
  failReason: string | null;
  /** 真实接口：执行前查到的余额（amount 是链上实际转走的金额） */
  balanceBefore?: string;
  /** TRON：这个地址的能量租赁（以太坊、BSC 为空） */
  rent: SweepRent | null;
}

export interface SweepBatchDetail extends SweepBatch {
  reason: string;
  /** 真实接口：批次失败或部分成功的原因 */
  failReason?: string | null;
  items: SweepItem[];
  unsignedSha256: string | null;
  signedSha256: string | null;
  events: { time: string; actor: string; text: string }[];
}

export interface SweepImportResult {
  accepted: number;
  rejected: { itemNo: number; reason: string }[];
}

export interface SweepTronTarget {
  address: string | null;
  pending: { address: string; requestedAt: string; effectiveAt: string; requestedBy: string; reason: string } | null;
}

export interface SweepSettings {
  thresholds: Record<SweepChain, string>;
  maxFeeRatioPct: string;
  autoEnabled: boolean;
  autoHourUtc: number;
  ethMaxBaseFeeGwei: string;
  operatorMin: { ERC20: string; BSC: string };
  remind: Record<SweepChain, string>;
  tronTopupPerItem: string;
  tronTopupPerDay: string;
  tronExpireHours: number;
  tronTargetDelayHours: number;
  /** TRON 能量（Amos 10-20：直接租能量） */
  tronEnergy: SweepTronEnergy;
  /** 以太坊、BSC 上线初期的金额上限（SW-4 不审计的替代措施）；"0" = 不限 */
  evmCaps: { perAddress: string; perBatch: string };
  /** 以太坊、BSC 的合约和冷钱包（从链上读，只读） */
  evm: {
    parent: string;
    safeThreshold: string;
    factory: string;
    implementation: string;
    batcher: string;
    operator: string;
    operatorBalances: { ERC20: string; BSC: string };
    readAt: string;
    /** 真实接口：合约地址参数配齐并检查通过；problem 是配置问题 */
    configured?: boolean;
    problem?: string | null;
    /** 真实接口：发起账户私钥和地址都配了并且对得上；operatorProblem 是原因 */
    operatorReady?: boolean;
    operatorProblem?: string | null;
  };
  tronTarget: SweepTronTarget;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type SweepSettingsInput = Pick<
  SweepSettings,
  'thresholds' | 'maxFeeRatioPct' | 'autoEnabled' | 'autoHourUtc' | 'ethMaxBaseFeeGwei' | 'operatorMin' | 'remind' | 'tronTopupPerItem' | 'tronTopupPerDay' | 'tronExpireHours' | 'evmCaps'
> & { tronEnergy: SweepTronEnergyInput; reason: string; expectedVersion: number };

export type SweepTronEnergyMode = 'rent' | 'burn';

export interface SweepTronEnergy {
  /** rent = 租能量（默认）；burn = 热钱包补 TRX、烧 TRX */
  mode: SweepTronEnergyMode;
  /** 租赁平台（显示用，平台本身在服务器配置） */
  provider: string;
  /** 最高单价（sun / 能量），报价高于它就不租 */
  maxPriceSun: string;
  /** 每天租金上限（TRX） */
  perDayTrx: string;
  /** 租不到 / 没到账时回退到烧 TRX（热钱包补 TRX） */
  fallbackBurn: boolean;
  /** 每笔租多少分钟 */
  durationMin: number;
  /** 平台账户余额（只读，从平台接口读） */
  providerBalance: string;
  /** 平台余额告警下限，0 = 不告警 */
  providerBalanceMin: string;
  /** 今天已花的租金（只读） */
  spentTodayTrx: string;
}

export type SweepTronEnergyInput = Pick<SweepTronEnergy, 'mode' | 'maxPriceSun' | 'perDayTrx' | 'fallbackBurn' | 'durationMin' | 'providerBalanceMin'>;

export interface SweepBatchQuery extends PageQuery {
  chain?: SweepChain;
}
