/**
 * 客户端接口的数据类型。按将来真实后端接口设计：
 * - 金额、价格、数量一律用十进制字符串（后端 BigDecimal 序列化），前端不做浮点累加；
 * - 时间一律用 ISO 8601 字符串（UTC）。
 */

export type Lang = 'zh-CN' | 'en';

// ---------- 账户与认证 ----------
export interface Session {
  /** 只有原型（mock 模式）有；真实环境的令牌在 HttpOnly Cookie 里，前端拿不到 */
  token?: string;
  userId: string;
  email: string;
}

export type EmailCodePurpose = 'register' | 'resetPassword';

export interface RegisterRequest {
  email: string;
  code: string;
  password: string;
  firstName: string;
  middleName: string;
  lastName: string;
  birthDate: string; // YYYY-MM-DD
  nationality: string; // ISO 3166-1 alpha-2
}

export interface Profile {
  userId: string;
  email: string;
  firstName: string;
  middleName: string;
  lastName: string;
  birthDate: string;
  nationality: string;
  registeredAt: string;
}

export type ProfileUpdate = Pick<Profile, 'firstName' | 'middleName' | 'lastName' | 'birthDate' | 'nationality'>;

export type KycStatus = 'none' | 'pending' | 'approved' | 'rejected';
export type KycDocType = 'idCard' | 'passport';

export interface KycInfo {
  status: KycStatus;
  docType?: KycDocType;
  docNumber?: string;
  submittedAt?: string;
  reviewedAt?: string;
  /** 被驳回时的原因（后台审核员填写，中英文由后端按语言返回） */
  rejectReason?: string;
}

export interface KycSubmit {
  docType: KycDocType;
  docNumber: string;
  front: File;
  back: File;
  selfie: File;
}

export interface NotifyPrefs {
  push: boolean;
  email: boolean;
}

// ---------- 行情 ----------
export type SymbolCategory = 'fx' | 'metal' | 'index' | 'energy' | 'crypto' | 'stock';

export interface SymbolInfo {
  code: string;
  nameZh: string;
  nameEn: string;
  category: SymbolCategory;
  /** 价格小数位 */
  digits: number;
  /** 合约大小：1 手 = 多少个基础单位（A-01） */
  contractSize: string;
  /** 合约单位的类型，用于显示"100 盎司/手" */
  unit: 'baseCcy' | 'ounce' | 'barrel' | 'unit' | 'share';
  baseCcy: string;
  quoteCcy: string;
  maxLeverage: number;
  minLots: string;
  maxLots: string;
  lotStep: string;
  /** 开仓手续费率（按名义价值） */
  feeRate: string;
  /** 维持保证金率 */
  maintenanceMarginRate: string;
  hot: boolean;
  /** 暂停开仓（风控暂停，客户只看到状态，看不到原因） */
  openPaused: boolean;
  /** 当前是否在交易时段内 */
  tradingOpen: boolean;
}

export interface Quote {
  symbol: string;
  bid: string;
  ask: string;
  /** 今日开盘价，用于算涨跌 */
  open: string;
  high: string;
  low: string;
  /** 报价对 USD 的折算率（非美元报价品种用实时汇率） */
  quoteToUsd: string;
  time: string;
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface Kline {
  /** 秒级 Unix 时间戳（UTC） */
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

// ---------- 交易 ----------
export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';

export interface Account {
  currency: 'USDT';
  /** 余额（不含提现冻结） */
  balance: string;
  /** 提现冻结 */
  withdrawFrozen: string;
  /** 挂单冻结保证金 */
  orderFrozen: string;
}

export interface Position {
  id: string;
  symbol: string;
  side: Side;
  lots: string;
  leverage: number;
  openPrice: string;
  margin: string;
  /** 开仓时的维持保证金率（追加保证金后按它重算强平价） */
  maintenanceMarginRate: string;
  liquidationPrice: string;
  takeProfit?: string;
  stopLoss?: string;
  openedAt: string;
}

export interface PendingOrder {
  id: string;
  symbol: string;
  side: Side;
  lots: string;
  leverage: number;
  limitPrice: string;
  takeProfit?: string;
  stopLoss?: string;
  frozenMargin: string;
  createdAt: string;
}

export type HistoryKind = 'closed' | 'tp' | 'sl' | 'liquidated' | 'cancelled';

export interface HistoryItem {
  id: string;
  symbol: string;
  side: Side;
  lots: string;
  openPrice: string;
  closePrice?: string;
  pnl?: string;
  fee: string;
  kind: HistoryKind;
  closedAt: string;
}

export interface PlaceOrderRequest {
  symbol: string;
  type: OrderType;
  side: Side;
  lots: string;
  leverage: number;
  limitPrice?: string;
  takeProfit?: string;
  stopLoss?: string;
  /** 幂等键：同一次提交重试时不变 */
  clientOrderId: string;
}

export interface PlaceOrderResult {
  kind: 'filled' | 'pending';
  id: string;
  price?: string;
}

/** 下单被拒原因（AC-12） */
export type OrderRejectReason =
  | 'tradingClosed'
  | 'symbolPaused'
  | 'globalPaused'
  | 'rateStale'
  | 'leverageExceeded'
  | 'positionLimit'
  | 'insufficientBalance';

// ---------- 资金 ----------
export type Network = 'ERC20' | 'TRC20' | 'BSC';

export interface DepositAddress {
  network: Network;
  address: string;
  confirmations: number;
  etaMinutes: number;
  /** 最小充值金额（低于它不入账，AC-41） */
  minDeposit: string;
}

/** 充值记录状态：待确认 / 已到账 / 已作废（链上回滚）/ 低于最小充值金额 / 已冲正 */
export type DepositStatus = 'pending' | 'credited' | 'dropped' | 'belowMin' | 'reversed';

export interface DepositRecord {
  id: string;
  network: Network;
  txHash: string;
  amount: string;
  status: DepositStatus;
  /** 当前确认数（待确认时显示进度） */
  confirmations: number;
  requiredConfirmations: number;
  time: string;
}

export type LedgerType = 'deposit' | 'withdraw' | 'withdrawRefund' | 'margin' | 'pnl' | 'fee' | 'swap' | 'adjust';

export interface LedgerItem {
  id: string;
  type: LedgerType;
  amount: string;
  /** 附加说明，如品种代码或网络 */
  ref: string;
  time: string;
}

export interface LedgerQuery {
  type: LedgerType | 'all';
  range: '7d' | '30d' | '90d' | 'all';
  page: number;
  pageSize: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface WhitelistAddress {
  id: string;
  network: Network;
  address: string;
  label: string;
  createdAt: string;
  /** 新地址 24 小时后生效 */
  activeAt: string;
}

export type WithdrawStatus =
  | 'cooling'
  | 'reviewing'
  | 'approved'
  | 'delayed'
  | 'broadcasting'
  | 'completed'
  | 'failedRefunded'
  | 'rejected'
  | 'cancelled';

export interface Withdrawal {
  id: string;
  amount: string;
  fee: string;
  network: Network;
  address: string;
  status: WithdrawStatus;
  createdAt: string;
  /** 冷静期结束时间（冷静期内可撤销） */
  coolingEndsAt: string;
  /** 大额延迟上链的结束时间 */
  delayEndsAt?: string;
  txHash?: string;
  rejectReason?: string;
}

export interface WithdrawInfo {
  kycStatus: KycStatus;
  available: string;
  usedToday: string;
  minAmount: string;
  maxPerTx: string;
  dailyLimit: string;
  /** ≥ 该金额审核后延迟上链 */
  largeAmount: string;
  largeDelayHours: number;
  coolingHours: number;
  fees: Record<Network, string>;
  maxWhitelist: number;
}

export interface WithdrawRequest {
  whitelistId: string;
  amount: string;
}

// ---------- 通知 ----------
export type NotificationKind = 'deposit' | 'withdraw' | 'fill' | 'tpsl' | 'marginCall' | 'liquidation' | 'kyc' | 'system';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

/** 服务端推送事件（将来走 WebSocket / Web Push） */
export type ServerEvent =
  | { type: 'account' }
  | { type: 'positions' }
  | { type: 'orders' }
  | { type: 'notification'; item: NotificationItem }
  | { type: 'trade'; kind: 'fill' | 'tp' | 'sl' | 'liquidation'; symbol: string; pnl?: string; price?: string }
  | { type: 'withdraw'; status: WithdrawStatus; amount: string };
