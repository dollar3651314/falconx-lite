/**
 * v2 资金归集的原型数据（技术方案/v2-半自动归集.md，推荐路线 (b)）：
 * - 以太坊、BSC：合约转发地址，服务器一笔批量交易归集（首次顺便部署转发合约）；
 * - TRON：普通地址，热钱包补 TRX，Amos 离线签名后导入、广播。
 * 地址、交易哈希都是随机生成的演示值（不是任何真实地址，也不是密钥）；手续费按方案第 3.2 节 2026-10-20 的实测价格估算。
 */
import type {
  SweepBatch,
  SweepBatchDetail,
  SweepCandidate,
  SweepChain,
  SweepItem,
  SweepSettings,
  SweepSkipReason,
} from '../../api/types';
import { createRng, fmtTime, minutesAgo, NOW_MS } from './seed';
import { customers } from './db';

const rng = createRng(20261020);

/**
 * 2026-10-20 实测的币价（币安只读行情）和 gas 价格（主网节点），方案第 3.2 节。
 * 以太坊当天只有 0.0444 gwei，原型按"较忙"的 5 gwei 演示，才能看到"手续费占比过高"被跳过的地址。
 */
export const PRICE_USD: Record<SweepChain, number> = { ERC20: 2381.78, BSC: 727.58, TRC20: 0.3322 };
const ETH_GWEI = 5;
export const GAS_PRICE_TEXT: Record<SweepChain, string> = { ERC20: `${ETH_GWEI} gwei`, BSC: '0.05 gwei', TRC20: '100 sun / 能量（烧 TRX）' };

/** 每个地址的手续费（手续费币）：以太坊、BSC 首次部署 ~290,000 gas、以后批量 ~27,000 gas（BitGo 文档 + 估算）；TRON 烧 TRX 6.70，未激活首次 8.15 */
export function feeOf(chain: SweepChain, deploy: boolean): number {
  if (chain === 'ERC20') return (deploy ? 290_000 : 27_000) * ETH_GWEI * 1e-9;
  if (chain === 'BSC') return (deploy ? 290_000 : 27_000) * 0.05e-9;
  return deploy ? 8.15 : 6.7;
}

export const fmtFee = (chain: SweepChain, v: number) => (chain === 'TRC20' ? v.toFixed(2) : v.toFixed(8));

const evm = () => '0x' + rng.hex(40);
const tron = () => 'T' + rng.base58(33);
const hash = (chain: SweepChain) => (chain === 'TRC20' ? rng.hex(64) : '0x' + rng.hex(64));

/** 以太坊、BSC 共用同一个转发地址（工厂部署在同一地址上） */
const evmAddrOf = new Map<number, string>();
const tronAddrOf = new Map<number, string>();
export function addressOf(chain: SweepChain, userId: number): string {
  const m = chain === 'TRC20' ? tronAddrOf : evmAddrOf;
  if (!m.has(userId)) m.set(userId, chain === 'TRC20' ? tron() : evm());
  return m.get(userId)!;
}

export const EVM_PARENT = '0x5afe' + rng.hex(36);
export const TRON_COLD = 'T' + rng.base58(33);

export const settings: SweepSettings = {
  thresholds: { ERC20: '100', BSC: '10', TRC20: '100' },
  maxFeeRatioPct: '3',
  autoEnabled: false,
  autoHourUtc: 18,
  ethMaxBaseFeeGwei: '2',
  operatorMin: { ERC20: '0', BSC: '0' },
  remind: { ERC20: '0', BSC: '0', TRC20: '0' },
  tronTopupPerItem: '20',
  tronTopupPerDay: '5000',
  tronExpireHours: 20,
  tronTargetDelayHours: 24,
  evm: {
    parent: EVM_PARENT,
    safeThreshold: '2 / 3',
    factory: evm(),
    implementation: evm(),
    batcher: evm(),
    operator: evm(),
    operatorBalances: { ERC20: '0.0412', BSC: '0.0193' },
    readAt: minutesAgo(3),
  },
  tronTarget: { address: TRON_COLD, pending: null },
  version: 3,
  updatedAt: minutesAgo(60 * 26),
  updatedBy: 'Amos',
};

/** 每条链上"有余额的充值地址"：余额、是否已部署 / 激活、这次跳过的原因 */
export interface Holding {
  chain: SweepChain;
  userId: number;
  usdt: string;
  /** 以太坊、BSC：转发合约已部署；TRON：地址已激活 */
  ready: boolean;
  /** TRON：地址里已有的 TRX（以前补剩的） */
  gasHad: number;
  flag: SweepSkipReason | null;
}

function makeHoldings(chain: SweepChain, offset: number, n: number): Holding[] {
  const out: Holding[] = [];
  for (let i = 0; i < n; i++) {
    const c = customers[(offset + i * 3) % customers.length];
    const big = i === 0 ? '18250.00' : i === 1 ? '6420.50' : null;
    const below = i >= n - 3;
    const usdt = big ?? (below ? rng.amount(1, chain === 'BSC' ? 9 : 90) : rng.amount(chain === 'BSC' ? 12 : 120, 4800));
    let flag: SweepSkipReason | null = null;
    if (i === 4) flag = 'pendingDeposit';
    if (i === 6) flag = 'recentCredit';
    out.push({ chain, userId: c.id, usdt, ready: i % 3 !== 2, gasHad: chain === 'TRC20' && i % 4 === 1 ? 1.35 : 0, flag });
  }
  return out;
}

export const holdings: Holding[] = [...makeHoldings('ERC20', 1, 12), ...makeHoldings('BSC', 2, 14), ...makeHoldings('TRC20', 0, 16)];

/** ERC20 里一个余额小的地址：手续费占比过高（演示"跳过"） */
holdings.filter((h) => h.chain === 'ERC20')[8].usdt = '104.00';

const customerName = (id: number) => customers.find((c) => c.id === id)?.name ?? String(id);

/** 预览：达到门槛的地址（含这次跳过的，标原因） */
export function candidatesOf(chain: SweepChain): SweepCandidate[] {
  const threshold = Number(settings.thresholds[chain]);
  const ratio = Number(settings.maxFeeRatioPct) / 100;
  const busy = new Set(batches.filter((b) => b.chain === chain && ACTIVE.includes(b.status)).flatMap((b) => details.get(b.no)!.items.map((it) => it.userId)));
  return holdings
    .filter((h) => h.chain === chain && Number(h.usdt) >= threshold)
    .sort((a, b) => Number(b.usdt) - Number(a.usdt))
    .map((h) => {
      const deploy = !h.ready;
      const fee = feeOf(chain, deploy);
      const feeUsd = fee * PRICE_USD[chain];
      const need = chain === 'TRC20' ? Math.max(0, Math.ceil((fee * 1.2 - h.gasHad) * 100) / 100) : 0;
      let skip: SweepSkipReason | null = h.flag;
      if (!skip && busy.has(h.userId)) skip = 'inBatch';
      if (!skip && feeUsd > Number(h.usdt) * ratio) skip = 'feeRatio';
      return {
        userId: h.userId,
        customerName: customerName(h.userId),
        address: addressOf(chain, h.userId),
        index: h.userId,
        usdt: h.usdt,
        deploy: chain !== 'TRC20' && deploy,
        topup: chain === 'TRC20' ? need.toFixed(2) : '0',
        estFee: fmtFee(chain, fee),
        estFeeUsd: feeUsd.toFixed(4),
        skip,
      };
    });
}

export const belowCount = (chain: SweepChain) => holdings.filter((h) => h.chain === chain && Number(h.usdt) > 0 && Number(h.usdt) < Number(settings.thresholds[chain])).length;

export const ACTIVE: SweepBatch['status'][] = ['sent', 'topping_up', 'awaiting_signature', 'signed', 'broadcasting'];

// ---------------- 批次 ----------------
let seq = 0;
export function nextBatchNo(): string {
  seq += 1;
  return String(104_017_266_118_000_000n + BigInt(seq * 7919));
}

export const batches: SweepBatch[] = [];
export const details = new Map<string, SweepBatchDetail>();

function addBatch(chain: SweepChain, status: SweepBatch['status'], ago: number, picks: number[], opts: { trigger?: 'manual' | 'auto'; failed?: number[]; rejected?: number[] } = {}) {
  const no = nextBatchNo();
  const mode = chain === 'TRC20' ? 'offline' : 'contract';
  const createdAt = minutesAgo(ago);
  const items: SweepItem[] = picks.map((ci, k) => {
    const c = customers[ci % customers.length];
    const deploy = chain !== 'TRC20' && k % 3 === 0;
    const amount = rng.amount(chain === 'BSC' ? 15 : 150, 5200);
    let st: SweepItem['status'] = 'swept';
    let failReason: string | null = null;
    if (status === 'awaiting_signature') st = 'ready';
    if (status === 'cancelled') st = 'cancelled';
    if (status === 'expired') st = 'expired';
    if (status === 'deferred') st = 'pending';
    if (opts.failed?.includes(k)) {
      st = 'failed';
      failReason = chain === 'TRC20' ? 'outOfEnergy' : 'transferReverted';
    }
    if (opts.rejected?.includes(k)) {
      st = 'sign_rejected';
      failReason = 'contentMismatch';
    }
    return {
      itemNo: k + 1,
      userId: c.id,
      customerName: c.name,
      address: addressOf(chain, c.id),
      amount,
      deploy,
      topup: chain === 'TRC20' ? (k % 4 === 1 ? '6.70' : '8.05') : '0',
      status: st,
      txHash: st === 'swept' || st === 'failed' ? (chain === 'TRC20' ? hash(chain) : null) : null,
      failReason,
    };
  });
  const sweptItems = items.filter((i) => i.status === 'swept');
  const fee = items.reduce((s, it) => s + (it.status === 'swept' || it.status === 'failed' ? feeOf(chain, it.deploy || (chain === 'TRC20' && it.topup === '8.05')) : 0), 0);
  const done = ['confirmed', 'partial', 'failed', 'cancelled', 'expired'].includes(status);
  const b: SweepBatch = {
    no,
    chain,
    mode,
    status,
    trigger: opts.trigger ?? 'manual',
    addressCount: items.length,
    expectedUsdt: sumStr(items.map((i) => i.amount)),
    sweptUsdt: sumStr(sweptItems.map((i) => i.amount)),
    fee: fmtFee(chain, fee),
    gasAsset: chain === 'ERC20' ? 'ETH' : chain === 'BSC' ? 'BNB' : 'TRX',
    destination: chain === 'TRC20' ? TRON_COLD : EVM_PARENT,
    createdBy: opts.trigger === 'auto' ? 'system' : 'Amos',
    createdAt,
    finishedAt: done ? minutesAgo(Math.max(1, ago - 6)) : null,
    expiresAt: chain === 'TRC20' ? fmtTime(NOW_MS - ago * 60_000 + settings.tronExpireHours * 3600_000) : null,
    txHash: chain !== 'TRC20' && status !== 'deferred' ? hash(chain) : null,
  };
  batches.unshift(b);
  const events: SweepBatchDetail['events'] = [{ time: createdAt, actor: b.createdBy, text: chain === 'TRC20' ? 'created_offline' : 'created_contract' }];
  if (chain === 'TRC20' && status !== 'cancelled') events.push({ time: minutesAgo(ago - 2), actor: 'system', text: 'topup_confirmed' });
  if (done && status !== 'cancelled' && status !== 'expired') events.push({ time: b.finishedAt!, actor: 'system', text: status === 'confirmed' ? 'all_swept' : 'some_failed' });
  if (status === 'cancelled') events.push({ time: b.finishedAt!, actor: 'Amos', text: 'cancelled' });
  if (status === 'expired') events.push({ time: b.finishedAt!, actor: 'system', text: 'expired' });
  if (status === 'deferred') events.push({ time: minutesAgo(ago - 1), actor: 'system', text: 'deferred_gas' });
  details.set(no, {
    ...b,
    reason: opts.trigger === 'auto' ? '' : '每周例行归集',
    items,
    unsignedSha256: chain === 'TRC20' ? rng.hex(64) : null,
    signedSha256: chain === 'TRC20' && done && status !== 'cancelled' && status !== 'expired' ? rng.hex(64) : null,
    events,
  });
  return no;
}

function sumStr(values: string[]): string {
  const cents = values.reduce((s, v) => s + Math.round(Number(v) * 100), 0);
  return (cents / 100).toFixed(2);
}

// 从旧到新加入（unshift 后最新的在最前面）
addBatch('ERC20', 'confirmed', 60 * 24 * 9, [3, 8, 13, 21, 30]);
addBatch('TRC20', 'confirmed', 60 * 24 * 8, [0, 4, 9, 15, 22, 27]);
addBatch('BSC', 'partial', 60 * 24 * 6, [2, 7, 11, 19, 25, 33, 38], { failed: [4] });
addBatch('TRC20', 'expired', 60 * 24 * 5, [5, 12, 17]);
addBatch('ERC20', 'deferred', 60 * 24 * 3, [6, 14, 26], { trigger: 'auto' });
addBatch('TRC20', 'partial', 60 * 24 * 2, [1, 10, 18, 24, 31], { failed: [2], rejected: [4] });
addBatch('BSC', 'confirmed', 60 * 30, [9, 16, 23, 29], { trigger: 'auto' });
addBatch('TRC20', 'cancelled', 60 * 20, [3, 20]);
/** 进行中：TRON 等待签名（补 TRX 已到账），演示"下载 → 离线签名 → 导入 → 广播" */
export const DEMO_TRON_BATCH = addBatch('TRC20', 'awaiting_signature', 95, [3, 11, 27, 34]);
