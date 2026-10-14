/**
 * 内存模拟数据库：页面上的操作会真实修改这里的数据（刷新浏览器后恢复初始值）。
 * 数据刻意包含：超过一页的数量、大额和多位小数、超长名称、中文名、含 <b> 的名称（规则 C50）。
 */
import type {
  AdminUser,
  AuditLog,
  Chain,
  CustomerSummary,
  Deposit,
  FxRate,
  Holiday,
  KycApplication,
  NotifyRecord,
  NotifyTemplate,
  Order,
  PendingOrder,
  Position,
  ReconItem,
  RiskEvent,
  RiskSettings,
  Role,
  SymbolExposure,
  SystemConfig,
  TaskItem,
  TradingParams,
  TradingSession,
  TradingSymbol,
  Withdrawal,
} from '../../api/types';
import { ALL_PERMISSION_CODES, type PermissionCode } from '../../config/permissions';
import { subtractAmounts } from '../../utils/money';
import { buildSymbols } from './symbols';
import {
  CHINESE_NAMES,
  EMAIL_DOMAINS,
  NATIONALITIES,
  createRng,
  evmAddress,
  minutesAgo,
  tronAddress,
} from './seed';

const rng = createRng(20261014);

const pinyin = [
  'zhangsan', 'liwei88', 'wangwu', 'chenxiao', 'zhaomin', 'liuyang', 'sunlei', 'zhouting', 'wuhaotian', 'zhengshuang',
  'ouyang.nana', 'test.b', 'alexandria.kw', 'huangxm', 'mali', 'yangyang', 'linzq', 'hejing', 'gaofeng', 'luolin',
  'liangsc', 'xiett', 'hanxue', 'tangyr', 'fengcc', 'caoyu', 'pengyy', 'zengxx', 'lvym', 'sufei',
  'lucas.martin', 'jiangxin', 'caiwj', 'jiabaoyu', 'dingyi', 'weilai', 'xuebing', 'yezi', 'simacf', 'yuhuanshui',
  'panduola', 'duziteng', 'diana.p', 'xiayu', 'zhongnan', 'wangyang', 'tiantian', 'renyy', 'jiangzy', 'fanbb',
  'fangyuan', 'shilei', 'yaochen', 'tanyl', 'liaofan', 'xiongda', 'jinlili',
];

// ---------------- 客户 ----------------
export const customers: CustomerSummary[] = CHINESE_NAMES.map((name, i) => {
  const kycCycle: CustomerSummary['kycStatus'][] = ['approved', 'approved', 'pending', 'none', 'approved', 'rejected', 'approved'];
  return {
    id: 100482 + i * 7,
    name,
    email: `${pinyin[i] ?? 'user' + i}@${i < 8 ? ['qq.com', '163.com', 'foxmail.com', '126.com', 'outlook.com', 'sina.com', 'qq.com', '163.com'][i] : rng.pick(EMAIL_DOMAINS)}`,
    nationality: rng.pick(NATIONALITIES),
    status: i === 6 || i === 21 || i === 40 ? 'frozen' : 'active',
    kycStatus: i < 3 ? 'approved' : kycCycle[i % kycCycle.length],
    balance: i === 0 ? '6820.40' : i === 12 ? '1250000.75' : i === 35 ? '0.00' : rng.amount(0, 48000),
    openPositions: i === 0 ? 1 : rng.int(0, 6),
    registeredAt: minutesAgo(60 * 24 * (i === 0 ? 30 : rng.int(1, 300)) + rng.int(0, 600)),
    lastLoginAt: i % 9 === 8 ? null : minutesAgo(rng.int(5, 60 * 24 * 7)),
  };
});

// 今天注册的 6 个（仪表盘"今日注册"）
customers.slice(-6).forEach((c, i) => {
  c.registeredAt = minutesAgo(30 + i * 85);
  c.kycStatus = 'none';
  c.openPositions = 0;
});

export const customerById = (id: number) => customers.find((c) => c.id === id);

// ---------------- KYC ----------------
export const kycApplications: KycApplication[] = customers
  .filter((c) => c.kycStatus !== 'none')
  .map((c, i) => {
    const status = c.kycStatus as KycApplication['status'];
    const passport = c.nationality !== 'CN';
    return {
      id: `KYC-${String(20261000 + i * 13)}`,
      customerId: c.id,
      name: c.name,
      email: c.email,
      nationality: c.nationality,
      birthDate: `19${rng.int(70, 99)}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`,
      docType: passport ? 'passport' : 'id_card',
      docNumber: passport ? `E${rng.int(1000, 9999)}****${rng.int(10, 99)}` : `4403${rng.int(10, 99)}**********${rng.int(1000, 9999)}`.slice(0, 18),
      status,
      submittedAt: minutesAgo(status === 'pending' ? rng.int(20, 60 * 20) : rng.int(60 * 24, 60 * 24 * 60)),
      reviewer: status === 'pending' ? null : rng.pick(['李娜', '赵强']),
      reviewedAt: status === 'pending' ? null : minutesAgo(rng.int(60 * 2, 60 * 24 * 20)),
      rejectReason: status === 'rejected' ? rng.pick(['证件照片模糊，无法辨认证件号', '手持自拍与证件照不是同一人', '证件已过期']) : null,
    };
  })
  .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));

// ---------------- 入金 ----------------
const chains: Chain[] = ['TRC20', 'TRC20', 'TRC20', 'ERC20', 'BSC'];
const requiredConf: Record<Chain, number> = { ERC20: 12, TRC20: 19, BSC: 15 };

export const deposits: Deposit[] = Array.from({ length: 46 }, (_, i) => {
  const c = customers[(i * 5) % (customers.length - 6)];
  const chain = rng.pick(chains);
  const status: Deposit['status'] = i < 3 ? 'confirming' : i === 7 ? 'ignored' : i === 15 ? 'reversed' : 'credited';
  const req = requiredConf[chain];
  const detected = rng.int(10 + i * 50, 60 + i * 60);
  return {
    id: `DP-${20261014 - Math.floor(i / 8)}-${String(900 - i).padStart(6, '0')}`,
    customerId: c.id,
    customerName: c.name,
    email: c.email,
    chain,
    txHash: chain === 'TRC20' ? rng.hex(64) : '0x' + rng.hex(64),
    amount: i === 4 ? '120000.000000' : i === 0 ? '12000.00' : rng.amount(50, 30000, rng.bool(0.3) ? 6 : 2),
    confirmations: status === 'confirming' ? rng.int(1, req - 1) : req + rng.int(0, 400),
    requiredConfirmations: req,
    status,
    detectedAt: minutesAgo(detected),
    creditedAt: status === 'credited' || status === 'reversed' ? minutesAgo(detected - 3) : null,
  };
});

// ---------------- 出金 ----------------
interface WdSeed {
  ci: number;
  amount: string;
  chain: Chain;
  status: Withdrawal['status'];
  ago: number;
  first?: boolean;
  delay?: number;
}

const wdSeeds: WdSeed[] = [
  { ci: 0, amount: '5000.00', chain: 'TRC20', status: 'pending', ago: 428, first: true },
  { ci: 1, amount: '800.00', chain: 'BSC', status: 'pending', ago: 435 },
  { ci: 2, amount: '12000.00', chain: 'ERC20', status: 'delayed', ago: 939, delay: 135 },
  { ci: 3, amount: '2350.00', chain: 'TRC20', status: 'pending', ago: 453 },
  { ci: 4, amount: '1200.00', chain: 'TRC20', status: 'pending', ago: 470 },
  { ci: 5, amount: '4500.00', chain: 'BSC', status: 'delayed', ago: 742, delay: 292 },
  { ci: 6, amount: '680.00', chain: 'TRC20', status: 'pending', ago: 544 },
  { ci: 7, amount: '3000.00', chain: 'ERC20', status: 'pending', ago: 568 },
  { ci: 8, amount: '1500.00', chain: 'TRC20', status: 'pending', ago: 590, first: true },
  { ci: 9, amount: '920.00', chain: 'BSC', status: 'pending', ago: 612 },
  { ci: 10, amount: '1100.00', chain: 'TRC20', status: 'pending', ago: 640 },
  { ci: 11, amount: '600.00', chain: 'TRC20', status: 'pending', ago: 700 },
  { ci: 12, amount: '880.00', chain: 'ERC20', status: 'pending', ago: 760 },
  { ci: 13, amount: '400.00', chain: 'TRC20', status: 'pending', ago: 790 },
  { ci: 14, amount: '4500.00', chain: 'TRC20', status: 'delayed', ago: 520, delay: 318 },
  { ci: 15, amount: '1260.00', chain: 'TRC20', status: 'cooling', ago: 35 },
  { ci: 16, amount: '500.00', chain: 'BSC', status: 'cooling', ago: 48 },
  { ci: 17, amount: '1000.00', chain: 'TRC20', status: 'cooling', ago: 66 },
  { ci: 18, amount: '700.00', chain: 'ERC20', status: 'cooling', ago: 80 },
  { ci: 19, amount: '800.00', chain: 'TRC20', status: 'cooling', ago: 102 },
  { ci: 20, amount: '9800.00', chain: 'TRC20', status: 'completed', ago: 300 },
  { ci: 22, amount: '2000.00', chain: 'BSC', status: 'completed', ago: 330 },
  { ci: 23, amount: '3500.00', chain: 'ERC20', status: 'completed', ago: 360 },
  { ci: 24, amount: '1550.00', chain: 'TRC20', status: 'completed', ago: 380 },
  { ci: 25, amount: '3000.00', chain: 'TRC20', status: 'completed', ago: 420 },
  { ci: 26, amount: '2000.00', chain: 'TRC20', status: 'completed', ago: 455 },
  { ci: 27, amount: '1000.00', chain: 'BSC', status: 'completed', ago: 480 },
  { ci: 28, amount: '2500.00', chain: 'ERC20', status: 'completed', ago: 500 },
  { ci: 29, amount: '1500.00', chain: 'TRC20', status: 'completed', ago: 560 },
  { ci: 30, amount: '660.00', chain: 'TRC20', status: 'broadcasting', ago: 210 },
  { ci: 31, amount: '15.00', chain: 'TRC20', status: 'rejected', ago: 1600 },
  { ci: 32, amount: '7000.00', chain: 'ERC20', status: 'cancelled', ago: 2100 },
  { ci: 33, amount: '250.00', chain: 'BSC', status: 'failed', ago: 1900 },
];

export const withdrawals: Withdrawal[] = wdSeeds.map((s, i) => {
  const c = customers[s.ci];
  const addr = s.chain === 'TRC20' ? tronAddress(rng) : evmAddress(rng);
  return {
    id: `WD-20261014-${String(318 - i).padStart(6, '0')}`,
    customerId: c.id,
    customerName: c.name,
    email: c.email,
    amount: s.amount,
    fee: s.chain === 'ERC20' ? '5.00' : '1.00',
    chain: s.chain,
    address: addr,
    firstUse: !!s.first,
    whitelistAddedAt: s.first ? '2026-10-12 08:30:00' : minutesAgo(60 * 24 * rng.int(5, 90)),
    status: s.status,
    delayRemainingMinutes: s.delay ?? null,
    submittedAt: minutesAgo(s.ago),
    reviewer: ['delayed', 'completed', 'broadcasting', 'rejected', 'cancelled', 'failed'].includes(s.status) ? '李娜' : null,
    reason:
      s.status === 'rejected'
        ? '提现地址与入金来源不一致，请客户补充说明'
        : s.status === 'cancelled'
          ? '客户来电称账户被盗，紧急取消'
          : s.status === 'failed'
            ? '广播失败：节点返回 nonce too low，已自动退款'
            : null,
    txHash: s.status === 'completed' ? (s.chain === 'TRC20' ? rng.hex(64) : '0x' + rng.hex(64)) : null,
  };
});

// ---------------- 对账 ----------------
export const reconItems: ReconItem[] = [
  { type: 'missing_credit', chainAmount: '1500.00', ledgerAmount: '0.00', status: 'open' },
  { type: 'amount_mismatch', chainAmount: '2000.000000', ledgerAmount: '1999.990000', status: 'open' },
  { type: 'reversal_shortfall', chainAmount: '-3200.00', ledgerAmount: '-1180.55', status: 'open' },
  { type: 'unknown_tx', chainAmount: '88.00', ledgerAmount: '0.00', status: 'open' },
  { type: 'missing_credit', chainAmount: '300.00', ledgerAmount: '0.00', status: 'resolved' },
  { type: 'amount_mismatch', chainAmount: '45000.123456', ledgerAmount: '45000.12', status: 'resolved' },
  { type: 'missing_credit', chainAmount: '760.00', ledgerAmount: '0.00', status: 'open' },
].map((r, i) => {
  const c = r.type === 'unknown_tx' ? null : customers[(i * 3 + 2) % 40];
  const chain = rng.pick(chains);
  return {
    id: `RC-${String(1001 + i)}`,
    chain,
    txHash: chain === 'TRC20' ? rng.hex(64) : '0x' + rng.hex(64),
    customerId: c?.id ?? null,
    customerName: c?.name ?? null,
    type: r.type as ReconItem['type'],
    chainAmount: r.chainAmount,
    ledgerAmount: r.ledgerAmount,
    diff: subtractAmounts(r.chainAmount, r.ledgerAmount, 6),
    status: r.status as ReconItem['status'],
    note: r.status === 'resolved' ? '已与链上核对，人工补记入账' : null,
    handler: r.status === 'resolved' ? '李娜' : null,
    detectedAt: minutesAgo(rng.int(60, 60 * 24 * 5)),
  };
});

// ---------------- 任务表 ----------------
const taskTypes: TaskItem['type'][] = ['withdraw_broadcast', 'withdraw_confirm', 'email', 'push', 'email', 'push'];
export const tasks: TaskItem[] = Array.from({ length: 34 }, (_, i) => {
  const type = taskTypes[i % taskTypes.length];
  const status: TaskItem['status'] =
    i === 1 || i === 9 || i === 16 || i === 22 ? 'failed' : i === 3 || i === 11 ? 'processing' : i === 5 || i === 18 ? 'pending' : 'success';
  const maxAttempts = type.startsWith('withdraw') ? 8 : 5;
  const attempts = status === 'failed' ? maxAttempts : status === 'pending' ? rng.int(1, 3) : status === 'processing' ? rng.int(1, 2) : rng.int(1, 2);
  const errors: Record<TaskItem['type'], string> = {
    withdraw_broadcast: 'BSC 节点超时：eth_sendRawTransaction 30 秒无响应',
    withdraw_confirm: 'TRON 节点返回交易不存在，等待下一轮检查',
    email: 'SMTP 550：收件邮箱不存在（noreply 退信）',
    push: '推送服务返回 410：订阅已失效',
  };
  return {
    id: `TK-${String(78000 + 34 - i)}`,
    type,
    bizRef: type.startsWith('withdraw') ? `WD-20261014-${String(300 - i).padStart(6, '0')}` : `NT-${String(553000 + i)}`,
    status,
    attempts,
    maxAttempts,
    nextRetryAt: status === 'pending' ? minutesAgo(-rng.int(1, 30)) : null,
    lastError: status === 'failed' || status === 'pending' ? errors[type] : null,
    createdAt: minutesAgo(i * 23 + 5),
    updatedAt: minutesAgo(i * 23),
  };
});

// ---------------- 品种 ----------------
export const symbols: TradingSymbol[] = buildSymbols();

const priceOf: Record<string, string> = {
  XAUUSD: '4026.35', XAGUSD: '48.912', BTCUSD: '112430.50', ETHUSD: '4182.27', EURUSD: '1.16342', USDJPY: '151.284',
  GBPUSD: '1.33718', NAS100: '24518.6', US30: '46302.1', XTIUSD: '61.84', USDCNH: '7.13420', NVDA: '188.42', AAPL: '247.65',
  TSLA: '432.10', SOLUSD: '196.338', GER40: '24210.4',
};
const tradeSymbols = Object.keys(priceOf);

// ---------------- 持仓、订单、挂单 ----------------
export const positions: Position[] = Array.from({ length: 38 }, (_, i) => {
  const c = customers[(i * 7) % (customers.length - 6)];
  const sym = i === 0 ? 'XAUUSD' : rng.pick(tradeSymbols);
  const side = rng.bool() ? 'buy' : 'sell';
  const lev = rng.pick([10, 20, 50, 100]);
  const pnlNeg = rng.bool(0.45);
  const level = i === 3 ? '62.40' : i === 8 ? '98.15' : rng.amount(120, 2600);
  return {
    id: `PS-${String(660000 + 38 - i)}`,
    customerId: c.id,
    customerName: c.name,
    symbol: sym,
    side,
    lots: i === 5 ? '12.50' : rng.pick(['0.01', '0.05', '0.10', '0.50', '1.00', '2.00']),
    openPrice: priceOf[sym],
    currentPrice: priceOf[sym],
    leverage: lev,
    margin: rng.amount(20, 8000),
    pnl: (pnlNeg ? '-' : '') + rng.amount(0, 2400),
    marginLevel: level,
    liquidationPrice: priceOf[sym],
    stopLoss: rng.bool(0.4) ? priceOf[sym] : null,
    takeProfit: rng.bool(0.4) ? priceOf[sym] : null,
    openedAt: minutesAgo(rng.int(5, 60 * 24 * 10)),
  };
});

const rejectReasons: Order['rejectReason'][] = [
  'outside_session', 'symbol_paused', 'global_paused', 'fx_stale', 'leverage_exceeded', 'position_limit', 'insufficient_balance',
];
export const orders: Order[] = Array.from({ length: 64 }, (_, i) => {
  const c = customers[(i * 3) % (customers.length - 6)];
  const sym = rng.pick(tradeSymbols);
  const status: Order['status'] = i % 9 === 4 ? 'rejected' : i % 11 === 6 ? 'cancelled' : i % 13 === 2 ? 'pending' : 'filled';
  return {
    id: `OD-${String(8812000 + 64 - i)}`,
    customerId: c.id,
    customerName: c.name,
    symbol: sym,
    side: rng.bool() ? 'buy' : 'sell',
    type: status === 'pending' ? 'limit' : rng.bool(0.7) ? 'market' : 'limit',
    lots: rng.pick(['0.01', '0.02', '0.10', '0.50', '1.00', '3.00']),
    price: priceOf[sym],
    leverage: rng.pick([10, 20, 50, 100]),
    fee: status === 'filled' ? rng.amount(0, 60) : '0.00',
    status,
    rejectReason: status === 'rejected' ? rejectReasons[Math.floor(i / 9) % rejectReasons.length] : null,
    createdAt: minutesAgo(i * 17 + rng.int(0, 10)),
  };
});

export const pendingOrders: PendingOrder[] = Array.from({ length: 27 }, (_, i) => {
  const c = customers[(i * 11) % (customers.length - 6)];
  const sym = rng.pick(tradeSymbols);
  return {
    id: `PO-${String(330000 + 27 - i)}`,
    customerId: c.id,
    customerName: c.name,
    symbol: sym,
    side: rng.bool() ? 'buy' : 'sell',
    lots: rng.pick(['0.01', '0.10', '0.30', '1.00']),
    limitPrice: priceOf[sym],
    currentPrice: priceOf[sym],
    leverage: rng.pick([10, 20, 50]),
    frozenMargin: rng.amount(10, 3000),
    stopLoss: rng.bool(0.5) ? priceOf[sym] : null,
    takeProfit: rng.bool(0.5) ? priceOf[sym] : null,
    createdAt: minutesAgo(rng.int(10, 60 * 24 * 3)),
  };
});

// ---------------- 风控 ----------------
const exposureSeed: [string, number, number, number, SymbolExposure['status']?][] = [
  ['XAUUSD', 320000, 90000, 250000],
  ['BTCUSD', 150000, 40000, 100000, 'auto_blocked'],
  ['EURUSD', 80000, 120000, 300000],
  ['USDJPY', 54600, 120000, 300000],
  ['NAS100', 96200, 58000, 200000],
  ['GBPUSD', 41200, 94000, 250000],
  ['ETHUSD', 61500, 34000, 80000],
  ['XAGUSD', 12400, 31000, 60000, 'manual_paused'],
  ['US30', 22400, 69000, 200000],
  ['XTIUSD', 18800, 9600, 120000],
  ['USDCNH', 30500, 12000, 150000],
  ['NVDA', 8800, 2400, 50000],
  ['TSLA', 4100, 9900, 50000],
  ['GER40', 15200, 31000, 150000],
];

export const exposures: SymbolExposure[] = exposureSeed.map(([code, long, short, threshold, status]) => {
  const s = symbols.find((x) => x.code === code)!;
  const net = long - short;
  const usage = (Math.abs(net) * 100) / threshold;
  return {
    symbol: code,
    nameZh: s.nameZh,
    nameEn: s.nameEn,
    longUsd: String(long),
    shortUsd: String(short),
    netUsd: String(net),
    thresholdUsd: String(threshold),
    status: status ?? (usage >= 100 ? 'auto_blocked' : usage >= 80 ? 'near' : 'normal'),
  };
});

export const riskSettings: RiskSettings = {
  globalPause: false,
  autoLiquidation: true,
  platformNetUsd: '182300',
  platformThresholdUsd: '500000',
  platformBlocked: false,
  perUserLimitUsd: '2000000',
  updatedAt: '2026-10-14 16:20:35',
};

export const riskEvents: RiskEvent[] = [
  { id: 'RE-9', time: '2026-10-14 16:02:11', actorType: 'system', actorName: null, type: 'auto_block_symbol', symbol: 'BTCUSD', value: '110000', threshold: '100000', reason: null },
  { id: 'RE-8', time: '2026-10-14 14:47:30', actorType: 'admin', actorName: '李娜', type: 'manual_pause', symbol: 'XAGUSD', value: null, threshold: null, reason: '流动性不足' },
  { id: 'RE-7', time: '2026-10-14 09:30:02', actorType: 'admin', actorName: '王五', type: 'manual_resume', symbol: 'XAUUSD', value: null, threshold: null, reason: '敞口已回落，LP 确认可承接' },
  { id: 'RE-6', time: '2026-10-13 22:15:40', actorType: 'system', actorName: null, type: 'auto_block_symbol', symbol: 'XAUUSD', value: '256400', threshold: '250000', reason: null },
  { id: 'RE-5', time: '2026-10-13 18:01:12', actorType: 'system', actorName: null, type: 'fx_stale_block', symbol: 'HK50', value: 'USDHKD', threshold: null, reason: null },
  { id: 'RE-4', time: '2026-10-13 10:12:00', actorType: 'admin', actorName: '王五', type: 'threshold_change', symbol: 'ETHUSD', value: '80000', threshold: '100000', reason: '波动加大，下调阈值' },
  { id: 'RE-3', time: '2026-10-12 21:00:00', actorType: 'admin', actorName: 'Amos', type: 'global_pause_off', symbol: null, value: null, threshold: null, reason: '非农数据公布后行情平稳' },
  { id: 'RE-2', time: '2026-10-12 20:25:00', actorType: 'admin', actorName: 'Amos', type: 'global_pause_on', symbol: null, value: null, threshold: null, reason: '非农数据公布前暂停新开仓' },
];

// ---------------- 交易时段、假期、汇率 ----------------
export const sessions: TradingSession[] = [
  { id: 'S-FX', nameZh: '外汇', nameEn: 'Forex', ranges: [{ fromDay: 0, fromTime: '22:00', toDay: 5, toTime: '22:00' }], dailyBreak: '21:59–22:05', symbolCount: 21 },
  { id: 'S-METAL', nameZh: '贵金属', nameEn: 'Metals', ranges: [{ fromDay: 0, fromTime: '23:00', toDay: 5, toTime: '21:58' }], dailyBreak: '21:58–23:01', symbolCount: 2 },
  { id: 'S-ENERGY', nameZh: '能源', nameEn: 'Energy', ranges: [{ fromDay: 0, fromTime: '23:00', toDay: 5, toTime: '21:58' }], dailyBreak: '21:58–23:01', symbolCount: 2 },
  { id: 'S-INDEX', nameZh: '指数', nameEn: 'Indices', ranges: [{ fromDay: 0, fromTime: '23:00', toDay: 5, toTime: '21:15' }], dailyBreak: '21:15–21:30', symbolCount: 10 },
  { id: 'S-CRYPTO', nameZh: '加密货币（7×24）', nameEn: 'Crypto (24/7)', ranges: [{ fromDay: 0, fromTime: '00:00', toDay: 6, toTime: '23:59' }], dailyBreak: null, symbolCount: 10 },
  { id: 'S-USSTOCK', nameZh: '美股', nameEn: 'US Stocks', ranges: [{ fromDay: 1, fromTime: '13:30', toDay: 1, toTime: '20:00' }, { fromDay: 2, fromTime: '13:30', toDay: 2, toTime: '20:00' }, { fromDay: 3, fromTime: '13:30', toDay: 3, toTime: '20:00' }, { fromDay: 4, fromTime: '13:30', toDay: 4, toTime: '20:00' }, { fromDay: 5, fromTime: '13:30', toDay: 5, toTime: '20:00' }], dailyBreak: null, symbolCount: 5 },
];

export const holidays: Holiday[] = [
  { id: 'H-1', date: '2026-11-26', sessionId: 'S-USSTOCK', nameZh: '感恩节', nameEn: 'Thanksgiving Day', closure: 'full', closeTime: null },
  { id: 'H-2', date: '2026-11-27', sessionId: 'S-USSTOCK', nameZh: '感恩节次日（提前收盘）', nameEn: 'Day after Thanksgiving (early close)', closure: 'early', closeTime: '18:00' },
  { id: 'H-3', date: '2026-12-24', sessionId: 'S-INDEX', nameZh: '平安夜（提前收盘）', nameEn: 'Christmas Eve (early close)', closure: 'early', closeTime: '18:00' },
  { id: 'H-4', date: '2026-12-25', sessionId: 'S-FX', nameZh: '圣诞节', nameEn: 'Christmas Day', closure: 'full', closeTime: null },
  { id: 'H-5', date: '2026-12-25', sessionId: 'S-METAL', nameZh: '圣诞节', nameEn: 'Christmas Day', closure: 'full', closeTime: null },
  { id: 'H-6', date: '2027-01-01', sessionId: 'S-FX', nameZh: '元旦', nameEn: "New Year's Day", closure: 'full', closeTime: null },
];

export const fxRates: FxRate[] = [
  { pair: 'USDJPY', rate: '151.284', source: 'LP', updatedAt: '2026-10-14 16:20:33', ageSeconds: 2, status: 'ok', affectedSymbols: ['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'JPN225'] },
  { pair: 'EURUSD', rate: '1.16342', source: 'LP', updatedAt: '2026-10-14 16:20:34', ageSeconds: 1, status: 'ok', affectedSymbols: ['EURGBP', 'EURCHF', 'GER40', 'FRA40'] },
  { pair: 'GBPUSD', rate: '1.33718', source: 'LP', updatedAt: '2026-10-14 16:20:34', ageSeconds: 1, status: 'ok', affectedSymbols: ['UK100', 'EURGBP'] },
  { pair: 'USDCHF', rate: '0.79812', source: 'LP', updatedAt: '2026-10-14 16:20:31', ageSeconds: 4, status: 'ok', affectedSymbols: ['USDCHF', 'EURCHF', 'GBPCHF'] },
  { pair: 'USDCAD', rate: '1.40115', source: 'LP', updatedAt: '2026-10-14 16:20:30', ageSeconds: 5, status: 'ok', affectedSymbols: ['USDCAD', 'EURCAD', 'AUDCAD'] },
  { pair: 'AUDUSD', rate: '0.65307', source: 'LP', updatedAt: '2026-10-14 16:20:33', ageSeconds: 2, status: 'ok', affectedSymbols: ['EURAUD', 'GBPAUD', 'AUS200'] },
  { pair: 'NZDUSD', rate: '0.57214', source: 'LP', updatedAt: '2026-10-14 16:20:29', ageSeconds: 6, status: 'ok', affectedSymbols: ['AUDNZD'] },
  { pair: 'USDCNH', rate: '7.13420', source: 'LP', updatedAt: '2026-10-14 16:20:32', ageSeconds: 3, status: 'ok', affectedSymbols: ['USDCNH'] },
  { pair: 'USDHKD', rate: '7.77650', source: 'LP', updatedAt: '2026-10-14 16:12:05', ageSeconds: 510, status: 'stale', affectedSymbols: ['HK50'] },
];

// ---------------- 交易参数 ----------------
export const tradingParams: TradingParams = {
  marginCallLevel: '100',
  liquidationLevel: '50',
  marginCallThrottleMinutes: 30,
  updatedAt: '2026-10-10 11:20:00',
  updatedBy: 'Amos',
};

// ---------------- 通知 ----------------
interface TplSeed {
  code: string;
  zh: string;
  en: string;
  tZh: string;
  tEn: string;
  bZh: string;
  bEn: string;
  vars: string[];
  builtIn?: boolean;
  channels?: NotifyTemplate['channels'];
}
const tplSeeds: TplSeed[] = [
  { code: 'deposit_credited', zh: '入金到账', en: 'Deposit credited', tZh: '充值已到账', tEn: 'Deposit credited', bZh: '您通过 {chain} 充值的 {amount} USDT 已到账。', bEn: 'Your deposit of {amount} USDT via {chain} has been credited.', vars: ['amount', 'chain'] },
  { code: 'withdraw_status', zh: '出金状态变化', en: 'Withdrawal status', tZh: '提现状态更新', tEn: 'Withdrawal update', bZh: '您的提现 {orderId} 状态已更新为：{status}。', bEn: 'Your withdrawal {orderId} is now: {status}.', vars: ['orderId', 'status'] },
  { code: 'order_filled', zh: '挂单成交', en: 'Limit order filled', tZh: '挂单已成交', tEn: 'Order filled', bZh: '{symbol} {side} {lots} 手已按 {price} 成交。', bEn: '{symbol} {side} {lots} lots filled at {price}.', vars: ['symbol', 'side', 'lots', 'price'] },
  { code: 'tp_sl_triggered', zh: '止盈止损触发', en: 'TP / SL triggered', tZh: '止盈止损已触发', tEn: 'TP/SL triggered', bZh: '{symbol} 持仓已按 {price} 平仓，盈亏 {pnl} USDT。', bEn: 'Your {symbol} position closed at {price}, P/L {pnl} USDT.', vars: ['symbol', 'price', 'pnl'] },
  { code: 'margin_call', zh: '追保预警', en: 'Margin call', tZh: '保证金不足提醒', tEn: 'Margin call', bZh: '{symbol} 持仓保证金水平已降至 {level}%，请及时追加保证金。', bEn: 'Margin level of your {symbol} position fell to {level}%. Please add margin.', vars: ['symbol', 'level'] },
  { code: 'liquidated', zh: '强平通知', en: 'Liquidation', tZh: '持仓已被强平', tEn: 'Position liquidated', bZh: '{symbol} 持仓已于 {price} 强制平仓。', bEn: 'Your {symbol} position was liquidated at {price}.', vars: ['symbol', 'price'] },
  { code: 'kyc_result', zh: 'KYC 结果', en: 'KYC result', tZh: '身份认证结果', tEn: 'Verification result', bZh: '您的身份认证{result}。{reason}', bEn: 'Your identity verification was {result}. {reason}', vars: ['result', 'reason'] },
  { code: 'email_code', zh: '邮箱验证码', en: 'Email code', tZh: 'FalconX 验证码', tEn: 'FalconX verification code', bZh: '您的验证码是 {code}，10 分钟内有效。', bEn: 'Your code is {code}. It expires in 10 minutes.', vars: ['code'], channels: ['email'] },
  { code: 'risk_auto_block', zh: '风控：自动禁开（发给风控人员）', en: 'Risk: auto block (to risk staff)', tZh: '品种已自动禁止新开仓', tEn: 'Symbol auto-blocked', bZh: '{symbol} 净敞口 {net} USD 超过阈值 {threshold} USD，已自动禁止新开仓。', bEn: '{symbol} net exposure {net} USD exceeded {threshold} USD; new positions blocked.', vars: ['symbol', 'net', 'threshold'] },
  { code: 'reversal_shortfall', zh: '冲正挂账（发给风控人员）', en: 'Reversal shortfall (to risk staff)', tZh: '冲正余额不足，已挂账', tEn: 'Reversal shortfall recorded', bZh: '客户 {customerId} 的入金 {txHash} 被链上回滚，余额不足，已生成挂账。', bEn: 'Deposit {txHash} of customer {customerId} was reversed; shortfall recorded.', vars: ['customerId', 'txHash'] },
  { code: 'promo_weekend', zh: '周末行情提醒', en: 'Weekend market notice', tZh: '周末休市提醒', tEn: 'Weekend market closure', bZh: '外汇和贵金属将于周六 05:00 休市，请留意持仓风险。', bEn: 'Forex and metals close at 05:00 Saturday. Please mind your positions.', vars: [], builtIn: false, channels: ['inbox'] },
];

export const templates: NotifyTemplate[] = tplSeeds.map((t, i) => ({
  id: `TPL-${String(i + 1).padStart(2, '0')}`,
  code: t.code,
  nameZh: t.zh,
  nameEn: t.en,
  builtIn: t.builtIn ?? true,
  enabled: true,
  channels: t.channels ?? ['inbox', 'push', 'email'],
  titleZh: t.tZh,
  bodyZh: t.bZh,
  titleEn: t.tEn,
  bodyEn: t.bEn,
  variables: t.vars,
  updatedAt: minutesAgo(60 * 24 * (i + 1)),
}));

export const notifyRecords: NotifyRecord[] = Array.from({ length: 52 }, (_, i) => {
  const c = customers[(i * 5 + 1) % customers.length];
  const tpl = templates[i % 8];
  const channel = (['inbox', 'push', 'email'] as const)[i % 3];
  const status: NotifyRecord['status'] = i % 10 === 3 ? 'failed' : i % 7 === 5 && channel !== 'inbox' ? 'skipped' : 'sent';
  const manual = i === 6 || i === 20;
  return {
    id: `NT-${String(553100 - i)}`,
    customerId: c.id,
    customerName: c.name,
    source: manual ? 'manual' : 'template',
    templateCode: manual ? null : tpl.code,
    channel,
    title: manual ? '关于您账户安全的提醒' : tpl.titleZh,
    status,
    error: status === 'failed' ? (channel === 'push' ? '推送服务返回 410：订阅已失效' : channel === 'email' ? 'SMTP 550：邮箱不存在' : '写入失败') : status === 'skipped' ? '客户已关闭该渠道' : null,
    operator: manual ? '李娜' : null,
    time: minutesAgo(i * 29 + 3),
  };
});

// ---------------- 角色、管理员 ----------------
const opsPerms: PermissionCode[] = [
  'dashboard:view', 'customer:view', 'customer:freeze', 'kyc:view', 'kyc:review',
  'deposit:view', 'withdrawal:view', 'withdrawal:review', 'recon:view', 'recon:resolve', 'task:view', 'task:retry',
  'order:view', 'notify_template:view', 'notify:send', 'notify_record:view', 'admin:view', 'admin:edit', 'audit:view',
];
const riskPerms: PermissionCode[] = [
  'dashboard:view', 'customer:view', 'withdrawal:view', 'withdrawal:emergency_cancel',
  'order:view', 'position:view', 'position:liquidate', 'pending:view', 'pending:force_cancel',
  'risk:view', 'risk:global_pause', 'risk:auto_liquidation', 'risk:symbol_pause', 'risk:threshold', 'risk:user_limit',
  'symbol:view', 'session:view', 'fx:view', 'params:view', 'audit:view',
];

export const roles: Role[] = [
  { id: 'R-1', code: 'super_admin', nameZh: '超级管理员', nameEn: 'Super admin', description: '拥有全部权限；只有超级管理员能分配本角色', permissions: [...ALL_PERMISSION_CODES], builtIn: true, memberCount: 1 },
  { id: 'R-2', code: 'operations', nameZh: '运营', nameEn: 'Operations', description: 'KYC 审核、出金审核、客户服务、通知', permissions: opsPerms, builtIn: false, memberCount: 4 },
  { id: 'R-3', code: 'risk', nameZh: '风控', nameEn: 'Risk', description: '风控看板、手动强平、强制撤单、紧急取消出金', permissions: riskPerms, builtIn: false, memberCount: 2 },
  { id: 'R-4', code: 'finance_viewer', nameZh: '财务只读', nameEn: 'Finance (read-only)', description: '只能查看入金、出金和对账', permissions: ['dashboard:view', 'deposit:view', 'withdrawal:view', 'recon:view'], builtIn: false, memberCount: 1 },
];

export const admins: AdminUser[] = [
  { id: 1, username: 'amos', displayName: 'Amos', email: 'amos@falconx.example', roleIds: ['R-1'], status: 'active', mustChangePassword: false, lastLoginAt: minutesAgo(3), createdAt: '2026-09-01 10:00:00' },
  { id: 2, username: 'lina', displayName: '李娜', email: 'lina@falconx.example', roleIds: ['R-2'], status: 'active', mustChangePassword: false, lastLoginAt: minutesAgo(12), createdAt: '2026-09-03 09:12:00' },
  { id: 3, username: 'wangwu', displayName: '王五', email: 'wangwu@falconx.example', roleIds: ['R-3'], status: 'active', mustChangePassword: false, lastLoginAt: minutesAgo(40), createdAt: '2026-09-03 09:20:00' },
  { id: 4, username: 'zhaoqiang', displayName: '赵强', email: 'zhaoqiang@falconx.example', roleIds: ['R-2'], status: 'active', mustChangePassword: false, lastLoginAt: minutesAgo(300), createdAt: '2026-09-05 14:00:00' },
  { id: 5, username: 'chen.finance', displayName: '陈会计', email: 'chen.finance@falconx.example', roleIds: ['R-4'], status: 'active', mustChangePassword: false, lastLoginAt: minutesAgo(60 * 26), createdAt: '2026-09-08 11:00:00' },
  { id: 6, username: 'newbie', displayName: '新同事', email: 'newbie@falconx.example', roleIds: ['R-2'], status: 'active', mustChangePassword: true, lastLoginAt: null, createdAt: '2026-10-14 09:00:00' },
  { id: 7, username: 'liu.risk', displayName: '刘风控', email: 'liu.risk@falconx.example', roleIds: ['R-3'], status: 'active', mustChangePassword: false, lastLoginAt: minutesAgo(60 * 5), createdAt: '2026-09-10 10:00:00' },
  { id: 8, username: 'old.ops', displayName: '离职运营（已禁用）', email: 'old.ops@falconx.example', roleIds: ['R-2'], status: 'disabled', mustChangePassword: false, lastLoginAt: '2026-09-28 18:00:00', createdAt: '2026-09-02 10:00:00' },
  { id: 9, username: 'sunny.ops.with.a.very.long.username', displayName: 'Sunny Wong-Featherstonehaugh', email: 'sunny.ops@falconx.example', roleIds: ['R-2'], status: 'active', mustChangePassword: false, lastLoginAt: minutesAgo(60 * 50), createdAt: '2026-09-15 10:00:00' },
];

// ---------------- 审计日志 ----------------
interface AuditSeed {
  action: string;
  target: string;
  highRisk: boolean;
  admin: string;
  reason?: string;
  before?: AuditLog['before'];
  after?: AuditLog['after'];
  result?: AuditLog['result'];
}
const auditSeeds: AuditSeed[] = [
  { action: 'risk.symbol_auto_block', target: 'BTCUSD', highRisk: true, admin: '系统', before: { status: 'normal' }, after: { status: 'auto_blocked', netUsd: '110000' } },
  { action: 'risk.symbol_pause', target: 'XAGUSD', highRisk: true, admin: '李娜', reason: '流动性不足', before: { status: 'normal' }, after: { status: 'manual_paused' } },
  { action: 'withdrawal.approve', target: 'WD-20261014-000296', highRisk: false, admin: '李娜', before: { status: 'pending' }, after: { status: 'broadcasting' } },
  { action: 'admin.reset_password', target: 'newbie', highRisk: true, admin: 'Amos', reason: '新员工入职', before: { mustChangePassword: false, password: '******' }, after: { mustChangePassword: true, password: 'Tmp#2026abc' } },
  { action: 'customer.freeze', target: '100524', highRisk: true, admin: '李娜', reason: '客户来电称手机丢失，申请冻结', before: { status: 'active' }, after: { status: 'frozen' } },
  { action: 'kyc.reject', target: 'KYC-20261039', highRisk: false, admin: '赵强', reason: '证件照片模糊，无法辨认证件号', before: { status: 'pending' }, after: { status: 'rejected' } },
  { action: 'symbol.update', target: 'XAUUSD', highRisk: true, admin: 'Amos', before: { maxLeverage: 200, swapLong: null, swapShort: null }, after: { maxLeverage: 200, swapLong: '-0.000192', swapShort: '0.000061' } },
  { action: 'role.update', target: '运营', highRisk: true, admin: 'Amos', before: { permissions: ['kyc:view', 'kyc:review'] }, after: { permissions: ['kyc:view', 'kyc:review', 'withdrawal:review'] } },
  { action: 'admin.create', target: 'newbie', highRisk: true, admin: 'Amos', before: null, after: { username: 'newbie', roleIds: ['运营'], passwordHash: '$2a$10$abcdef...' } },
  { action: 'auth.login', target: 'lina', highRisk: false, admin: '李娜', before: null, after: { ip: '203.0.113.24' } },
  { action: 'auth.login', target: 'unknown_user', highRisk: false, admin: '—', result: 'failure', before: null, after: { reason: '账号或密码错误', pwd: 'guess123' } },
  { action: 'risk.global_pause_off', target: '全局', highRisk: true, admin: 'Amos', reason: '非农数据公布后行情平稳', before: { globalPause: true }, after: { globalPause: false } },
  { action: 'risk.global_pause_on', target: '全局', highRisk: true, admin: 'Amos', reason: '非农数据公布前暂停新开仓', before: { globalPause: false }, after: { globalPause: true } },
  { action: 'customer.adjust_balance', target: '100489', highRisk: true, admin: 'Amos', reason: '补偿 10-11 行情异常导致的错误强平', before: { balance: '800.00' }, after: { balance: '1050.00' } },
  { action: 'withdrawal.emergency_cancel', target: 'WD-20261014-000287', highRisk: true, admin: '王五', reason: '客户来电称账户被盗，紧急取消', before: { status: 'delayed' }, after: { status: 'cancelled' } },
  { action: 'position.liquidate', target: 'PS-660011', highRisk: true, admin: '王五', reason: '客户保证金水平持续低于强平线，自动强平未触发，人工处理', before: { status: 'open' }, after: { status: 'closed' } },
  { action: 'config.update', target: 'withdraw.dailyLimit', highRisk: true, admin: 'Amos', before: { value: '30000' }, after: { value: '30000' } },
  { action: 'notify.manual_send', target: '100489', highRisk: true, admin: '李娜', reason: '通知客户补充 KYC 材料', before: null, after: { channels: ['inbox', 'email'], title: '关于您账户安全的提醒' } },
  { action: 'recon.resolve', target: 'RC-1005', highRisk: false, admin: '李娜', reason: '已与链上核对，人工补记入账', before: { status: 'open' }, after: { status: 'resolved' } },
  { action: 'task.retry', target: 'TK-78012', highRisk: false, admin: '李娜', before: { status: 'failed', attempts: 5 }, after: { status: 'pending', attempts: 5 } },
];

export const auditLogs: AuditLog[] = Array.from({ length: 48 }, (_, i) => {
  const s = auditSeeds[i % auditSeeds.length];
  return {
    id: `AU-${String(240000 - i)}`,
    time: minutesAgo(18 + i * 37),
    adminName: s.admin,
    ip: s.admin === '系统' ? '—' : `203.0.113.${(i * 7) % 250}`,
    action: s.action,
    target: s.target,
    highRisk: s.highRisk,
    result: s.result ?? 'success',
    reason: s.reason ?? null,
    before: s.before ?? null,
    after: s.after ?? null,
  };
});

// ---------------- 系统配置（只列真正生效的配置项） ----------------
export const systemConfigs: SystemConfig[] = [
  { key: 'withdraw.minAmount', value: '10', unit: 'usdt', group: 'withdraw', updatedAt: '2026-10-01 10:00:00' },
  { key: 'withdraw.maxSingle', value: '10000', unit: 'usdt', group: 'withdraw', updatedAt: '2026-10-01 10:00:00' },
  { key: 'withdraw.dailyLimit', value: '30000', unit: 'usdt', group: 'withdraw', updatedAt: '2026-10-01 10:00:00' },
  { key: 'withdraw.coolingHours', value: '2', unit: 'hours', group: 'withdraw', updatedAt: '2026-10-01 10:00:00' },
  { key: 'withdraw.largeThreshold', value: '3000', unit: 'usdt', group: 'withdraw', updatedAt: '2026-10-01 10:00:00' },
  { key: 'withdraw.largeDelayHours', value: '6', unit: 'hours', group: 'withdraw', updatedAt: '2026-10-01 10:00:00' },
  { key: 'whitelist.effectiveHours', value: '24', unit: 'hours', group: 'withdraw', updatedAt: '2026-10-01 10:00:00' },
  { key: 'whitelist.maxAddresses', value: '10', unit: 'count', group: 'withdraw', updatedAt: '2026-10-01 10:00:00' },
  { key: 'deposit.confirmations.ERC20', value: '12', unit: 'count', group: 'deposit', updatedAt: '2026-10-01 10:00:00' },
  { key: 'deposit.confirmations.TRC20', value: '19', unit: 'count', group: 'deposit', updatedAt: '2026-10-01 10:00:00' },
  { key: 'deposit.confirmations.BSC', value: '15', unit: 'count', group: 'deposit', updatedAt: '2026-10-01 10:00:00' },
  { key: 'login.lockThreshold', value: '5', unit: 'count', group: 'security', updatedAt: '2026-10-01 10:00:00' },
  { key: 'login.lockMinutes', value: '30', unit: 'minutes', group: 'security', updatedAt: '2026-10-01 10:00:00' },
  { key: 'admin.ipWhitelist', value: '203.0.113.0/24, 198.51.100.7', unit: 'text', group: 'security', updatedAt: '2026-10-05 15:30:00' },
  { key: 'adjust.singleLimit', value: '5000', unit: 'usdt', group: 'adjust', updatedAt: '2026-10-01 10:00:00' },
  { key: 'adjust.dailyLimit', value: '20000', unit: 'usdt', group: 'adjust', updatedAt: '2026-10-01 10:00:00' },
  { key: 'notify.marginCallThrottleMinutes', value: '30', unit: 'minutes', group: 'notify', updatedAt: '2026-10-01 10:00:00' },
];

/** 今日已调整余额合计（每日上限用） */
export const adjustState = { usedToday: '1250.00' };

/** 原型身份：超级管理员 / 运营 / 风控 → 对应的管理员 */
export const identityAdmin: Record<'super' | 'ops' | 'risk', number> = { super: 1, ops: 2, risk: 3 };
export const session = { adminId: 1 };
