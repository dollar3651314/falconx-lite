/**
 * 报价订阅：全局只订阅一次，组件通过 useQuote / useQuotes 读取。
 */
import { useSyncExternalStore } from 'react';
import { subscribeQuotes } from '../api/market';
import type { Quote } from '../api/types';

let snapshot: Record<string, Quote> = {};
/** 记录每个品种最近一次的跳动方向，用于闪烁效果 */
const direction: Record<string, 'up' | 'down'> = {};
const listeners = new Set<() => void>();
let unsub: (() => void) | null = null;

function start(): void {
  if (unsub) return;
  unsub = subscribeQuotes((qs) => {
    const next = { ...snapshot };
    for (const q of qs) {
      const prev = snapshot[q.symbol];
      if (prev && prev.bid !== q.bid) direction[q.symbol] = q.bid.localeCompare(prev.bid, undefined, { numeric: true }) > 0 ? 'up' : 'down';
      next[q.symbol] = q;
    }
    snapshot = next;
    listeners.forEach((l) => l());
  });
}

function subscribe(l: () => void): () => void {
  start();
  listeners.add(l);
  return () => listeners.delete(l);
}

const getSnapshot = () => snapshot;

export function useQuotes(): Record<string, Quote> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useQuote(symbol: string | undefined): Quote | undefined {
  const all = useQuotes();
  return symbol ? all[symbol] : undefined;
}

export function quoteDirection(symbol: string): 'up' | 'down' | undefined {
  return direction[symbol];
}
