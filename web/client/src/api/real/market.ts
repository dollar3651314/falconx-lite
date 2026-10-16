/**
 * 行情的真实接口（`market/web/MarketController.java`、`MarketPush.java`）：
 * - 品种、K 线历史、今日走势走 HTTP；
 * - 报价和 K 线更新走 `WS /api/ws/market`：连上先推全部报价，之后每 250 毫秒推有变化的；
 *   K 线发 `{op:'subKline', symbol, tf}` 订阅（每个连接同时只订阅一个）。断线自动重连，重连后重新订阅。
 */
import { get } from '../http';
import type { Kline, Quote, SymbolInfo, Timeframe } from '../types';
import { ReconnectingSocket } from '../ws';
import { isLoggedIn, onSessionChange } from './session';

export const listSymbols = (): Promise<SymbolInfo[]> => get<SymbolInfo[]>('/api/market/symbols');

export const getSparklines = (): Promise<Record<string, string[]>> => get<Record<string, string[]>>('/api/market/sparklines');

export const getKlines = (symbol: string, tf: Timeframe): Promise<Kline[]> => get<Kline[]>('/api/market/klines', { query: { symbol, tf, limit: 300 } });

type QuoteListener = (quotes: Quote[]) => void;
type BarListener = (bar: Kline) => void;

const cache: Record<string, Quote> = {};
const quoteListeners = new Set<QuoteListener>();
let kline: { symbol: string; tf: Timeframe; listeners: Set<BarListener> } | null = null;

/** 推送消息：{"type":"quotes","data":[…]} 或 {"type":"kline","symbol","tf","bar"} */
interface MarketMsg {
  type?: string;
  data?: Quote[];
  symbol?: string;
  tf?: Timeframe;
  bar?: Kline;
}

/**
 * 汇率暂时取不到时（后端返回 null）沿用上一次的值；从来没有拿到过就留空，页面按"—"显示
 * （原来补成 '0'，预估的保证金、浮动盈亏会显示成 0，误导客户）。
 */
function normalize(q: Quote): Quote {
  return { ...q, quoteToUsd: q.quoteToUsd ?? cache[q.symbol]?.quoteToUsd };
}

export function handleMarketMessage(msg: unknown): void {
  const m = msg as MarketMsg | undefined;
  if (m?.type === 'quotes' && Array.isArray(m.data)) {
    const qs = m.data.filter((q) => q && q.symbol).map(normalize);
    for (const q of qs) cache[q.symbol] = q;
    if (qs.length) quoteListeners.forEach((l) => l(qs));
  } else if (m?.type === 'kline' && m.bar && kline && m.symbol === kline.symbol && m.tf === kline.tf) {
    const bar = m.bar;
    kline.listeners.forEach((l) => l(bar));
  }
}

const socket = new ReconnectingSocket('/api/ws/market', {
  onMessage: handleMarketMessage,
  onOpen: (send) => {
    if (kline) send({ op: 'subKline', symbol: kline.symbol, tf: kline.tf });
  },
});

/** 已登录且有人订阅时才连接；退出登录时断开 */
function sync(): void {
  if (isLoggedIn() && (quoteListeners.size > 0 || kline)) socket.start();
  else if (!isLoggedIn()) socket.stop();
}
onSessionChange(sync);

/** 订阅报价：已有数据时先回调一次全量快照，之后每次有变化回调变化的部分 */
export function subscribeQuotes(cb: QuoteListener): () => void {
  quoteListeners.add(cb);
  const snapshot = Object.values(cache);
  if (snapshot.length) cb(snapshot);
  sync();
  return () => {
    quoteListeners.delete(cb);
  };
}

/** 订阅某个品种某个周期的最新一根 K 线（同时只有一个订阅，新的替换旧的） */
export function subscribeKline(symbol: string, tf: Timeframe, cb: BarListener): () => void {
  if (!kline || kline.symbol !== symbol || kline.tf !== tf) {
    kline = { symbol, tf, listeners: new Set() };
    socket.send({ op: 'subKline', symbol, tf });
  }
  const sub = kline;
  sub.listeners.add(cb);
  sync();
  return () => {
    sub.listeners.delete(cb);
    if (kline === sub && sub.listeners.size === 0) {
      kline = null;
      socket.send({ op: 'unsubKline' });
    }
  };
}
