/**
 * 官网行情面板每一行的状态（纯函数，useQuotes 每秒用新数据算一次）：
 * - 卖价比上一次高闪绿、低闪红（flashSeq 每闪一次加 1，组件用它重新触发动画）；
 * - 只有 OPEN 才有价格；休市、没有报价时不保留旧价格（需求 4.2"不显示过期价格"）；
 * - history：打开页面以来每次拿到的卖价（最多 HISTORY_MAX 个），电脑版画"走势"小图；状态不是 OPEN 时清空。
 */
import type { PublicQuotes, QuoteStatus } from '../api/types';

export type RowStatus = QuoteStatus | 'LOADING';

export interface Row {
  symbol: string;
  nameZh: string;
  nameEn: string;
  bid: string | null;
  changePct: string | null;
  status: RowStatus;
  flash: 'up' | 'down' | null;
  flashSeq: number;
  history: number[];
}

export const HISTORY_MAX = 40;

/** 第一次拿到行情之前的占位行 */
export function initialRows(symbols: string[]): Row[] {
  return symbols.map((symbol) => ({ symbol, nameZh: '', nameEn: '', bid: null, changePct: null, status: 'LOADING', flash: null, flashSeq: 0, history: [] }));
}

/** 用新拿到的行情算出新的行（顺序按接口返回的顺序） */
export function nextRows(prev: Row[], data: PublicQuotes): Row[] {
  const old = new Map(prev.map((r) => [r.symbol, r]));
  return data.items.map((q) => {
    const p = old.get(q.symbol);
    const open = q.status === 'OPEN' && q.bid !== null;
    if (!open) {
      return { symbol: q.symbol, nameZh: q.nameZh, nameEn: q.nameEn, bid: null, changePct: null, status: q.status, flash: null, flashSeq: p?.flashSeq ?? 0, history: [] };
    }
    const now = Number(q.bid);
    const before = p && p.status === 'OPEN' && p.bid !== null ? Number(p.bid) : NaN;
    const flash: Row['flash'] = Number.isFinite(before) && now !== before ? (now > before ? 'up' : 'down') : null;
    const history = p && p.status === 'OPEN' ? [...p.history, now].slice(-HISTORY_MAX) : [now];
    return {
      symbol: q.symbol,
      nameZh: q.nameZh,
      nameEn: q.nameEn,
      bid: q.bid,
      changePct: q.changePct,
      status: 'OPEN',
      flash,
      flashSeq: (p?.flashSeq ?? 0) + (flash ? 1 : 0),
      history,
    };
  });
}

/** 连续取不到行情（断网、后端不可用）：全部显示"暂无报价"，不显示旧价格 */
export function unavailableRows(prev: Row[]): Row[] {
  return prev.map((r) => ({ ...r, bid: null, changePct: null, status: 'NO_QUOTE', flash: null, history: [] }));
}

/** 取不到行情多久以后显示"暂无报价"（偶尔一次失败不闪） */
export const UNAVAILABLE_AFTER_MS = 3_000;
/** 轮询间隔（需求 4.2"约每秒更新"） */
export const POLL_MS = 1_000;
