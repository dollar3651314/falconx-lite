/**
 * 模拟数据库：内存中的全部可变状态和初始数据（规则 C50：数据要像真的）。
 * 包含超过一页的列表、大额和多位小数、超长名称、中文名、带 <b> 符号的名称。
 */
import type {
  Account,
  HistoryItem,
  HistoryKind,
  KycInfo,
  LedgerItem,
  LedgerType,
  Network,
  NotificationKind,
  NotifyPrefs,
  PendingOrder,
  Position,
  Profile,
  Side,
  WhitelistAddress,
  Withdrawal,
  WithdrawStatus,
} from '../api/types';
import { dec, toFixed } from '../lib/decimal';
import { estimateOrder } from '../lib/trading';
import { hoursFromNow, minutesAgo, seeded, snowflakeAt } from './ids';

/** 种子数据的对外编号：按「多少分钟前」生成雪花 ID 格式的字符串（和后端一样超过 JavaScript 安全整数，只当字符串） */
const seedNo = (minutes: number, seq: number): string => snowflakeAt(Date.now() - minutes * 60_000, seq);
import { quote, symbolInfo } from './market';

export interface StoredNotification {
  id: string;
  kind: NotificationKind;
  title: { zh: string; en: string };
  body: { zh: string; en: string };
  read: boolean;
  createdAt: string;
}

export interface Db {
  profile: Profile;
  password: string;
  kyc: KycInfo & { rejectReasonI18n?: { zh: string; en: string } };
  prefs: NotifyPrefs;
  account: Account;
  positions: Position[];
  orders: PendingOrder[];
  history: HistoryItem[];
  ledger: LedgerItem[];
  whitelist: WhitelistAddress[];
  withdrawals: Withdrawal[];
  notifications: StoredNotification[];
  deposit: Record<Network, string>;
}

function makePosition(id: string, symbol: string, side: Side, lots: string, leverage: number, openPrice: string, minutes: number, tp?: string, sl?: string): Position {
  const info = symbolInfo(symbol)!;
  const q = quote(symbol)!;
  const est = estimateOrder({ symbol: info, price: dec(openPrice), lots: dec(lots), leverage, side, quoteToUsd: q.quoteToUsd });
  return {
    id,
    symbol,
    side,
    lots,
    leverage,
    openPrice,
    margin: toFixed(est.margin, 2),
    maintenanceMarginRate: info.maintenanceMarginRate,
    liquidationPrice: toFixed(est.liquidationPrice, info.digits),
    takeProfit: tp,
    stopLoss: sl,
    openedAt: minutesAgo(minutes),
  };
}

function makeOrder(id: string, symbol: string, side: Side, lots: string, leverage: number, limitPrice: string, minutes: number, tp?: string, sl?: string): PendingOrder {
  const info = symbolInfo(symbol)!;
  const q = quote(symbol)!;
  const est = estimateOrder({ symbol: info, price: dec(limitPrice), lots: dec(lots), leverage, side, quoteToUsd: q.quoteToUsd });
  return { id, symbol, side, lots, leverage, limitPrice, takeProfit: tp, stopLoss: sl, frozenMargin: toFixed(est.margin, 2), createdAt: minutesAgo(minutes) };
}

const HISTORY_SYMBOLS = ['XAUUSD', 'EURUSD', 'USDJPY', 'GBPUSD', 'NAS100', 'ETHUSD', 'XTIUSD', 'GER40', 'AUDUSD', 'XAGUSD'];

function seedHistory(): HistoryItem[] {
  const r = seeded(42);
  const kinds: HistoryKind[] = ['closed', 'closed', 'closed', 'tp', 'sl', 'closed', 'liquidated', 'cancelled'];
  const out: HistoryItem[] = [];
  for (let i = 0; i < 32; i++) {
    const symbol = HISTORY_SYMBOLS[i % HISTORY_SYMBOLS.length];
    const info = symbolInfo(symbol)!;
    const q = quote(symbol)!;
    const base = Number(q.bid);
    const kind = kinds[i % kinds.length];
    const open = (base * (1 + (r() - 0.5) * 0.02)).toFixed(info.digits);
    const close = (base * (1 + (r() - 0.5) * 0.02)).toFixed(info.digits);
    const lots = (Math.round((0.05 + r() * 2) * 100) / 100).toFixed(2);
    const side: Side = r() > 0.5 ? 'buy' : 'sell';
    const pnlRaw = side === 'buy' ? Number(close) - Number(open) : Number(open) - Number(close);
    // 模拟数据的盈亏只用于展示，用字符串保存
    const pnl = (pnlRaw * Number(lots) * Number(info.contractSize) * Number(q.quoteToUsd)).toFixed(2);
    out.push({
      id: `${kind === 'cancelled' ? 'O' : 'P'}${seedNo(90 + i * 517, 100 + i)}`,
      symbol,
      side,
      lots,
      openPrice: open,
      closePrice: kind === 'cancelled' ? undefined : close,
      pnl: kind === 'cancelled' ? undefined : kind === 'liquidated' ? `-${(Math.abs(Number(pnl)) + 120).toFixed(2)}` : pnl,
      fee: kind === 'cancelled' ? '0.00' : (Number(open) * Number(lots) * Number(info.contractSize) * Number(q.quoteToUsd) * 0.00005).toFixed(2),
      kind,
      closedAt: minutesAgo(90 + i * 517),
    });
  }
  return out;
}

function seedLedger(): LedgerItem[] {
  const r = seeded(7);
  const plan: Array<[LedgerType, string]> = [
    ['deposit', 'TRC20'],
    ['fee', 'XAUUSD'],
    ['pnl', 'USDJPY'],
    ['swap', 'EURUSD'],
    ['pnl', 'NAS100'],
    ['withdraw', 'TRC20'],
    ['fee', 'EURUSD'],
    ['deposit', 'ERC20'],
    ['pnl', 'XAUUSD'],
    ['swap', 'XAUUSD'],
    ['withdrawRefund', 'BSC'],
    ['adjust', ''],
  ];
  const out: LedgerItem[] = [];
  for (let i = 0; i < 46; i++) {
    const [type, ref] = plan[i % plan.length];
    let amount: string;
    switch (type) {
      case 'deposit':
        amount = i === 0 ? '1000.00' : (500 + Math.round(r() * 49500 * 100) / 100).toFixed(2);
        break;
      case 'withdraw':
        amount = `-${(100 + Math.round(r() * 4900)).toFixed(2)}`;
        break;
      case 'withdrawRefund':
        amount = (200 + Math.round(r() * 800)).toFixed(2);
        break;
      case 'fee':
        amount = `-${(r() * 25 + 0.12).toFixed(2)}`;
        break;
      case 'swap':
        amount = (r() > 0.7 ? '' : '-') + (r() * 8 + 0.03).toFixed(2);
        break;
      case 'adjust':
        amount = '0.01';
        break;
      default:
        amount = ((r() - 0.4) * 3200).toFixed(2);
    }
    out.push({ id: `L${90000 + i}`, type, amount, ref, time: minutesAgo(40 + i * 2711) });
  }
  return out;
}

const N = (kind: NotificationKind, zhT: string, enT: string, zhB: string, enB: string, minutes: number, read: boolean, i: number): StoredNotification => ({
  id: `N${5000 + i}`,
  kind,
  title: { zh: zhT, en: enT },
  body: { zh: zhB, en: enB },
  read,
  createdAt: minutesAgo(minutes),
});

function seedNotifications(): StoredNotification[] {
  const base: StoredNotification[] = [
    N('deposit', '充值到账', 'Deposit credited', '1,000.00 USDT（TRC20）已到账，可用于交易。', '1,000.00 USDT (TRC20) has been credited to your account.', 18, false, 0),
    N('fill', '限价单成交', 'Limit order filled', 'XAUUSD 买入 0.10 手已按 4,120.85 成交。', 'XAUUSD buy 0.10 lots filled at 4,120.85.', 205, false, 1),
    N('marginCall', '保证金水平偏低', 'Low margin level', 'EURUSD 卖出持仓的保证金水平已低于 150%，请追加保证金或平掉部分持仓。', 'Your EURUSD sell position margin level is below 150%. Please add margin or close some positions.', 380, false, 2),
    N('withdraw', '提现已进入冷静期', 'Withdrawal in cooling-off period', '1,000.00 USDT 提现已提交，2 小时内可撤销。', 'Your 1,000.00 USDT withdrawal was submitted and can be cancelled within 2 hours.', 25, false, 3),
    N('system', '系统公告：<b>周末维护</b> 安排', 'Notice: <b>weekend maintenance</b> schedule', '本周六 02:00–04:00（北京时间）进行系统维护，期间无法登录和交易。标题里的 <b> 是测试用的特殊符号，应原样显示。', 'System maintenance on Saturday 02:00–04:00 (UTC+8). The <b> in the title is a test symbol and should be shown as-is.', 1440, false, 4),
    // 和后端模板 KYC_APPROVED（迁移 V30，体验建议第 11 条）同一段文案
    N('kyc', '身份认证已通过', 'Identity verified', '您的身份认证已通过，充值、交易、提现均已开通。还没有充值的话，可以在"资产"页充值 USDT 开始交易。', 'Your identity has been verified. Deposits, trading and withdrawals are all available. If you have not deposited yet, go to Assets to deposit USDT and start trading.', 2880, true, 5),
    N('tpsl', '止盈已触发', 'Take profit triggered', 'USDJPY 买入 1.00 手在 152.300 止盈平仓，盈利 +302.14 USDT。', 'USDJPY buy 1.00 lots closed by take profit at 152.300, P/L +302.14 USDT.', 3100, true, 6),
    N('liquidation', '持仓被强平', 'Position liquidated', 'XTIUSD 卖出 2.00 手在 63.15 被强制平仓，亏损 -1,240.00 USDT。', 'XTIUSD sell 2.00 lots was liquidated at 63.15, P/L -1,240.00 USDT.', 5200, true, 7),
  ];
  const out = [...base];
  for (let i = 0; i < 18; i++) {
    out.push(
      N(
        i % 2 ? 'fill' : 'deposit',
        i % 2 ? '市价单成交' : '充值到账',
        i % 2 ? 'Market order filled' : 'Deposit credited',
        i % 2 ? `EURUSD 卖出 ${(i / 10 + 0.1).toFixed(2)} 手已成交。` : `${(250 * (i + 1)).toLocaleString('en-US')}.00 USDT（ERC20）已到账。`,
        i % 2 ? `EURUSD sell ${(i / 10 + 0.1).toFixed(2)} lots filled.` : `${(250 * (i + 1)).toLocaleString('en-US')}.00 USDT (ERC20) credited.`,
        6000 + i * 1440,
        true,
        10 + i,
      ),
    );
  }
  return out;
}

function seedWithdrawals(): Withdrawal[] {
  const W = (i: number, amount: string, status: WithdrawStatus, network: Network, address: string, minutes: number, extra: Partial<Withdrawal> = {}): Withdrawal => {
    const createdAt = minutesAgo(minutes);
    return {
      id: seedNo(minutes, 200 + i),
      amount,
      fee: network === 'ERC20' ? '5.00' : network === 'TRC20' ? '1.00' : '0.50',
      network,
      address,
      status,
      createdAt,
      coolingEndsAt: new Date(new Date(createdAt).getTime() + 2 * 3_600_000).toISOString(),
      ...extra,
    };
  };
  const T = 'TQ8nB4rW7xYp2LkM9vD3sF6hJ1cZ5gw3kP';
  const E = '0x4A7c9E2b1D8f3C6a5B0e9F7d2C1b8A3e6D5f4C21';
  return [
    W(0, '1000.00', 'cooling', 'TRC20', T, 15),
    W(1, '2500.00', 'reviewing', 'TRC20', T, 180),
    W(2, '800.00', 'approved', 'BSC', E, 300),
    W(3, '5000.00', 'delayed', 'TRC20', T, 420, { delayEndsAt: hoursFromNow(3.5) }),
    W(4, '1200.50', 'broadcasting', 'ERC20', E, 720, { txHash: '0x9b1e4c7a2f3d8e6b5a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a' }),
    W(5, '200.00', 'completed', 'BSC', E, 4300, { txHash: '0x7f3a9c2e5b8d1a4f6c3e9b2d5a8f1c4e7b0d3a6f9c2e5b8d1a4f7c0e3b6de21b' }),
    W(6, '3000.00', 'failedRefunded', 'ERC20', E, 7200),
    W(7, '9999.99', 'rejected', 'TRC20', T, 10000, { rejectReason: 'addressRisk' }),
    W(8, '150.00', 'cancelled', 'TRC20', T, 14000),
    W(9, '10000.00', 'completed', 'TRC20', T, 20000, { txHash: 'a3f9c2e15b8d7a4f6c3e9b2d5a8f1c4e7b0d3a6f9c2e5b8d1a4f7c0e3b6d9a2f' }),
    W(10, '12.34', 'completed', 'BSC', E, 30000, { txHash: '0x1c4e7b0d3a6f9c2e5b8d1a4f7c0e3b6d9a2f5c8e1b4d7a0f3c6e9b2d5a8f1c4e' }),
  ];
}

export function seed(): Db {
  const positions = [
    makePosition(seedNo(260, 1), 'XAUUSD', 'buy', '0.10', 50, '4192.10', 260, '4252.28', '4165.81'),
    makePosition(seedNo(720, 2), 'EURUSD', 'sell', '1.00', 100, '1.12500', 720, undefined, '1.12964'),
    makePosition(seedNo(1500, 3), 'USDJPY', 'buy', '2.00', 200, '157.279', 1500, '159.119'),
    makePosition(seedNo(2900, 4), 'NAS100', 'buy', '1.50', 50, '29323.5', 2900, '29977.7'),
    makePosition(seedNo(3600, 5), 'ETHUSD', 'sell', '0.75', 20, '2459.63', 3600, undefined, '2567.09'),
    makePosition(seedNo(4100, 6), 'GER40', 'sell', '0.50', 100, '25766.9', 4100),
    makePosition(seedNo(5000, 7), 'XAGUSD', 'buy', '0.20', 100, '56.776', 5000),
  ];
  const orders = [
    makeOrder(seedNo(95, 11), 'XAUUSD', 'buy', '0.20', 50, '4150.55', 95, '4231.93', '4109.86'),
    makeOrder(seedNo(400, 12), 'GBPUSD', 'sell', '0.50', 100, '1.34036', 400),
    makeOrder(seedNo(1300, 13), 'SOLUSD', 'buy', '3.00', 20, '98.34', 1300),
  ];
  const orderFrozen = orders.reduce((s, o) => s + dec(o.frozenMargin), 0n);
  return {
    profile: {
      userId: 'U10086',
      email: 'ouyang.siyuan.trading.account@example-mail.com',
      firstName: '思远',
      middleName: '',
      lastName: '欧阳',
      birthDate: '1990-06-18',
      nationality: 'CN',
      registeredAt: minutesAgo(60 * 24 * 41),
    },
    password: 'Falcon2026',
    kyc: { status: 'approved', docType: 'idCard', docNumber: '110101199006181234', submittedAt: minutesAgo(3000), reviewedAt: minutesAgo(2880) },
    prefs: { push: true, email: true },
    account: { currency: 'USDT', balance: '128456.79', withdrawFrozen: '6000.00', orderFrozen: toFixed(orderFrozen, 2) },
    positions,
    orders,
    history: seedHistory(),
    ledger: seedLedger(),
    whitelist: [
      { id: 'A1', network: 'TRC20', address: 'TQ8nB4rW7xYp2LkM9vD3sF6hJ1cZ5gw3kP', label: '我的 imToken 钱包', createdAt: minutesAgo(60 * 24 * 30), activeAt: minutesAgo(60 * 24 * 29) },
      { id: 'A2', network: 'ERC20', address: '0x4A7c9E2b1D8f3C6a5B0e9F7d2C1b8A3e6D5f4C21', label: '冷钱包 <b>主</b> & "Ledger"', createdAt: minutesAgo(60 * 24 * 12), activeAt: minutesAgo(60 * 24 * 11) },
      { id: 'A3', network: 'BSC', address: '0x9E2b1D8f3C6a5B0e9F7d2C1b8A3e6D5f4C214A7c', label: '币安交易所充值地址（新添加，等待生效）', createdAt: minutesAgo(120), activeAt: hoursFromNow(22) },
    ],
    withdrawals: seedWithdrawals(),
    notifications: seedNotifications(),
    deposit: {
      ERC20: '0x8f3C2a9B4e7D1c6F5a0B9e8D7c2F1a4B3e6D9c0A',
      BSC: '0x8f3C2a9B4e7D1c6F5a0B9e8D7c2F1a4B3e6D9c0A',
      TRC20: 'TXr7mKp3Vd9qLw2HcN8eYb4FjGs6AuZt5R',
    },
  };
}

export let db: Db = seed();

/** 原型：重置全部模拟数据 */
export function resetDb(): void {
  db = seed();
}
