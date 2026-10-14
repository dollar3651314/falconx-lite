/**
 * 模拟钱包：充值地址、资金流水、白名单、提现。
 * 规则（需求 4.4）：最小 10、单笔 ≤10,000、当日累计 <30,000；2 小时冷静期；≥3,000 审核后延迟 6 小时；
 * 白名单最多 10 个，新地址 24 小时后生效。
 */
import { ApiError } from '../api/errors';
import type {
  DepositAddress,
  LedgerItem,
  LedgerQuery,
  Network,
  Page,
  WhitelistAddress,
  WithdrawInfo,
  Withdrawal,
  WithdrawRequest,
  WithdrawStatus,
} from '../api/types';
import { add, cmp, dec, sub, sum, toFixed, ZERO } from '../lib/decimal';
import { formatAmount } from '../lib/format';
import { hasErrors, validateWhitelist, validateWithdraw } from '../lib/validators';
import { emit } from './bus';
import { db } from './db';
import { mutate, respond } from './delay';
import { nextId } from './ids';
import { availableNow } from './trading';
import { pushNotification } from './user';

const CONFIRMATIONS: Record<Network, { n: number; eta: number }> = {
  ERC20: { n: 12, eta: 3 },
  TRC20: { n: 20, eta: 1 },
  BSC: { n: 15, eta: 1 },
};

export function getDepositAddresses(): Promise<DepositAddress[]> {
  // 地址在注册时生成，空数据场景下也存在
  return respond(() =>
    (['ERC20', 'TRC20', 'BSC'] as Network[]).map((network) => ({ network, address: db.deposit[network], confirmations: CONFIRMATIONS[network].n, etaMinutes: CONFIRMATIONS[network].eta })),
  );
}

const RANGE_DAYS: Record<LedgerQuery['range'], number> = { '7d': 7, '30d': 30, '90d': 90, all: 100000 };

export function listLedger(q: LedgerQuery): Promise<Page<LedgerItem>> {
  return respond(
    () => {
      const since = Date.now() - RANGE_DAYS[q.range] * 86_400_000;
      const rows = db.ledger
        .filter((l) => (q.type === 'all' || l.type === q.type) && new Date(l.time).getTime() >= since)
        .sort((a, b) => b.time.localeCompare(a.time));
      return { items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: rows.length, page: q.page, pageSize: q.pageSize };
    },
    () => ({ items: [], total: 0, page: q.page, pageSize: q.pageSize }),
  );
}

const COUNTS_TOWARDS_DAILY: WithdrawStatus[] = ['cooling', 'reviewing', 'approved', 'delayed', 'broadcasting', 'completed'];

function usedToday(): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = db.withdrawals.filter((w) => COUNTS_TOWARDS_DAILY.includes(w.status) && new Date(w.createdAt).getTime() >= start.getTime());
  return toFixed(sum(today.map((w) => dec(w.amount))), 2);
}

function withdrawable(): string {
  const a = availableNow();
  return toFixed(cmp(a, ZERO) < 0 ? ZERO : a, 2);
}

function info(): WithdrawInfo {
  return {
    kycStatus: db.kyc.status,
    available: withdrawable(),
    usedToday: usedToday(),
    minAmount: '10',
    maxPerTx: '10000',
    dailyLimit: '30000',
    largeAmount: '3000',
    largeDelayHours: 6,
    coolingHours: 2,
    fees: { ERC20: '5.00', TRC20: '1.00', BSC: '0.50' },
    maxWhitelist: 10,
  };
}

export function getWithdrawInfo(): Promise<WithdrawInfo> {
  return respond(info, () => ({ ...info(), kycStatus: 'none', available: '0.00', usedToday: '0.00' }));
}

export function listWhitelist(): Promise<WhitelistAddress[]> {
  return respond(() => db.whitelist.map((w) => ({ ...w })), () => []);
}

export function addWhitelist(f: { network: Network; address: string; label: string }): Promise<WhitelistAddress> {
  return mutate(() => {
    const errs = validateWhitelist(f, db.whitelist, 10);
    if (errs.form) throw new ApiError('whitelistFull');
    if (errs.address?.includes('validation.addressDuplicate')) throw new ApiError('whitelistDuplicate');
    const now = Date.now();
    const w: WhitelistAddress = {
      id: nextId('A'),
      network: f.network,
      address: f.address.trim(),
      label: f.label.trim(),
      createdAt: new Date(now).toISOString(),
      activeAt: new Date(now + 24 * 3_600_000).toISOString(),
    };
    db.whitelist.push(w);
    return { ...w };
  });
}

export function removeWhitelist(id: string): Promise<void> {
  return mutate(() => {
    db.whitelist = db.whitelist.filter((w) => w.id !== id);
  });
}

export function listWithdrawals(page: number, pageSize: number): Promise<Page<Withdrawal>> {
  return respond(
    () => {
      const sorted = [...db.withdrawals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { items: sorted.slice((page - 1) * pageSize, page * pageSize).map((w) => ({ ...w })), total: sorted.length, page, pageSize };
    },
    () => ({ items: [], total: 0, page, pageSize }),
  );
}

export function submitWithdraw(req: WithdrawRequest): Promise<Withdrawal> {
  return mutate(() => {
    const i = info();
    if (i.kycStatus !== 'approved') throw new ApiError('kycRequired');
    const errs = validateWithdraw(req, i, db.whitelist);
    if (hasErrors(errs)) throw new ApiError('withdrawInvalid', errs as Record<string, string[]>);
    const addr = db.whitelist.find((w) => w.id === req.whitelistId)!;
    const now = Date.now();
    const w: Withdrawal = {
      id: nextId('W'),
      amount: toFixed(dec(req.amount), 2),
      fee: i.fees[addr.network],
      network: addr.network,
      address: addr.address,
      status: 'cooling',
      createdAt: new Date(now).toISOString(),
      coolingEndsAt: new Date(now + i.coolingHours * 3_600_000).toISOString(),
    };
    db.withdrawals.unshift(w);
    db.account.balance = toFixed(sub(dec(db.account.balance), dec(w.amount)), 2);
    db.account.withdrawFrozen = toFixed(add(dec(db.account.withdrawFrozen), dec(w.amount)), 2);
    db.ledger.unshift({ id: nextId('L'), type: 'withdraw', amount: toFixed(dec(`-${w.amount}`), 2), ref: w.network, time: w.createdAt });
    pushNotification(
      'withdraw',
      ['提现已进入冷静期', 'Withdrawal in cooling-off period'],
      [`${formatAmount(w.amount)} USDT 提现已提交，${i.coolingHours} 小时内可撤销。`, `Your ${formatAmount(w.amount)} USDT withdrawal was submitted and can be cancelled within ${i.coolingHours} hours.`],
    );
    emit({ type: 'account' });
    return { ...w };
  });
}

export function cancelWithdraw(id: string): Promise<Withdrawal> {
  return mutate(() => {
    const w = db.withdrawals.find((x) => x.id === id);
    if (!w) throw new ApiError('notFound');
    if (w.status !== 'cooling' || new Date(w.coolingEndsAt).getTime() < Date.now()) throw new ApiError('withdrawNotCancellable');
    w.status = 'cancelled';
    // 冷静期内撤销：冻结金额立即释放（AC-18）
    db.account.balance = toFixed(add(dec(db.account.balance), dec(w.amount)), 2);
    db.account.withdrawFrozen = toFixed(sub(dec(db.account.withdrawFrozen), dec(w.amount)), 2);
    db.ledger.unshift({ id: nextId('L'), type: 'withdrawRefund', amount: w.amount, ref: w.network, time: new Date().toISOString() });
    emit({ type: 'account' });
    emit({ type: 'withdraw', status: 'cancelled', amount: w.amount });
    return { ...w };
  });
}
