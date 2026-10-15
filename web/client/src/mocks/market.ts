/**
 * 模拟行情：每秒随机跳动报价，并据此实时更新 K 线最后一根。
 * 价格内部用"最小变动单位的整数个数"表示，避免浮点误差。
 */
import type { Kline, Quote, SymbolInfo, Timeframe } from '../api/types';
import { SYMBOL_SEEDS } from './data/symbols';
import { seeded } from './ids';

interface LiveQuote {
  info: SymbolInfo;
  digits: number;
  bid: number; // 以 tick 为单位的整数
  spread: number;
  open: number;
  high: number;
  low: number;
  vol: number; // 每次跳动的最大 tick 数
  quoteToUsd: string;
  time: number;
}

/** 整数 tick → 十进制字符串 */
export function ticksToStr(ticks: number, digits: number): string {
  const negative = ticks < 0;
  const s = Math.abs(Math.round(ticks)).toString().padStart(digits + 1, '0');
  const body = digits > 0 ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s;
  return negative ? `-${body}` : body;
}

/** 十进制字符串 → 整数 tick（按品种小数位截断补齐，不经过浮点） */
export function strToTicks(v: string, digits: number): number {
  const [i, f = ''] = v.split('.');
  return Number(`${i}${f.padEnd(digits, '0').slice(0, digits)}`);
}

const rnd = seeded(20261014);
const live = new Map<string, LiveQuote>();

for (const s of SYMBOL_SEEDS) {
  const d = s.info.digits;
  const bid = strToTicks(s.price, d);
  // 今日开盘价：在当前价附近 ±0.8% 内取值，用于显示涨跌
  const open = Math.round(bid * (1 + (rnd() - 0.55) * 0.016));
  live.set(s.info.code, {
    info: s.info,
    digits: d,
    bid,
    spread: strToTicks(s.spread, d),
    open,
    high: Math.max(bid, open) + Math.round(bid * 0.002 * rnd()),
    low: Math.min(bid, open) - Math.round(bid * 0.002 * rnd()),
    vol: Math.max(1, Math.round(bid * 0.00008)),
    quoteToUsd: s.quoteToUsd,
    time: Date.now(),
  });
}

export function symbols(): SymbolInfo[] {
  return SYMBOL_SEEDS.map((s) => s.info);
}

export function symbolInfo(code: string): SymbolInfo | undefined {
  return live.get(code)?.info;
}

function toQuote(q: LiveQuote): Quote {
  return {
    symbol: q.info.code,
    bid: ticksToStr(q.bid, q.digits),
    ask: ticksToStr(q.bid + q.spread, q.digits),
    open: ticksToStr(q.open, q.digits),
    high: ticksToStr(q.high, q.digits),
    low: ticksToStr(q.low, q.digits),
    quoteToUsd: q.quoteToUsd,
    time: new Date(q.time).toISOString(),
  };
}

export function quote(code: string): Quote | undefined {
  const q = live.get(code);
  return q ? toQuote(q) : undefined;
}

export function allQuotes(): Quote[] {
  return [...live.values()].map(toQuote);
}

/** 原型：把某个品种的价格直接拨到指定值（用于演示止盈止损和强平触发） */
export function forcePrice(code: string, bid: string): void {
  const q = live.get(code);
  if (!q) return;
  q.bid = strToTicks(bid, q.digits);
  q.high = Math.max(q.high, q.bid);
  q.low = Math.min(q.low, q.bid);
  q.time = Date.now();
  publish([toQuote(q)]);
}

// ---------- 订阅 ----------
type QuoteListener = (quotes: Quote[]) => void;
const quoteListeners = new Set<QuoteListener>();
const tickHooks = new Set<(quotes: Quote[]) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function publish(quotes: Quote[]): void {
  updateKlines(quotes);
  tickHooks.forEach((h) => h(quotes));
  quoteListeners.forEach((l) => l(quotes));
}

function tick(): void {
  const changed: Quote[] = [];
  const now = Date.now();
  for (const q of live.values()) {
    if (!q.info.tradingOpen) continue; // 休市品种不跳动
    if (Math.random() < 0.35) continue; // 不是每个品种每秒都有新报价
    const step = Math.round((Math.random() - 0.5) * 2 * q.vol);
    if (step === 0) continue;
    q.bid = Math.max(1, q.bid + step);
    q.high = Math.max(q.high, q.bid);
    q.low = Math.min(q.low, q.bid);
    q.time = now;
    changed.push(toQuote(q));
  }
  if (changed.length) publish(changed);
}

function ensureTimer(): void {
  if (timer === null && typeof window !== 'undefined') timer = setInterval(tick, 1000);
}

export function subscribeQuotes(l: QuoteListener): () => void {
  quoteListeners.add(l);
  ensureTimer();
  return () => {
    quoteListeners.delete(l);
  };
}

/** 交易模拟模块用：每次报价都检查挂单、止盈止损和强平 */
export function addTickHook(h: (quotes: Quote[]) => void): void {
  tickHooks.add(h);
  ensureTimer();
}

// ---------- K 线 ----------
export const TF_SECONDS: Record<Timeframe, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };

interface Bar {
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const series = new Map<string, Bar[]>();
type BarListener = (bar: Kline) => void;
const barListeners = new Map<string, Set<BarListener>>();

const key = (code: string, tf: Timeframe) => `${code}|${tf}`;

function toKline(b: Bar, digits: number): Kline {
  return {
    time: b.time,
    open: ticksToStr(b.o, digits),
    high: ticksToStr(b.h, digits),
    low: ticksToStr(b.l, digits),
    close: ticksToStr(b.c, digits),
    volume: String(b.v),
  };
}

/** 生成历史 K 线：从当前价往回做随机游走，固定种子保证同一品种每次一致 */
function generate(code: string, tf: Timeframe, count = 300): Bar[] {
  const q = live.get(code)!;
  const sec = TF_SECONDS[tf];
  const r = seeded(code.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) + sec);
  const nowBucket = Math.floor(Date.now() / 1000 / sec) * sec;
  const scale = Math.sqrt(sec / 60);
  const vol = Math.max(2, q.vol * 3 * scale);
  const bars: Bar[] = [];
  let close = q.bid;
  for (let i = 0; i < count; i++) {
    const t = nowBucket - i * sec;
    const drift = Math.sin(i / 9) * vol * 0.35;
    const open = Math.max(1, Math.round(close - drift - (r() - 0.5) * vol * 2));
    const hi = Math.max(open, close) + Math.round(r() * vol * 0.7);
    const lo = Math.max(1, Math.min(open, close) - Math.round(r() * vol * 0.7));
    bars.push({ time: t, o: open, h: hi, l: lo, c: close, v: Math.round(200 + r() * 1800) });
    close = open;
  }
  return bars.reverse();
}

export function klines(code: string, tf: Timeframe): Kline[] {
  const q = live.get(code);
  if (!q) return [];
  let s = series.get(key(code, tf));
  if (!s) {
    s = generate(code, tf);
    series.set(key(code, tf), s);
  }
  return s.map((b) => toKline(b, q.digits));
}

function updateKlines(quotes: Quote[]): void {
  for (const qt of quotes) {
    const q = live.get(qt.symbol)!;
    for (const tf of Object.keys(TF_SECONDS) as Timeframe[]) {
      const s = series.get(key(qt.symbol, tf));
      if (!s || s.length === 0) continue;
      const sec = TF_SECONDS[tf];
      const bucket = Math.floor(q.time / 1000 / sec) * sec;
      let last = s[s.length - 1];
      if (bucket > last.time) {
        last = { time: bucket, o: last.c, h: Math.max(last.c, q.bid), l: Math.min(last.c, q.bid), c: q.bid, v: 0 };
        s.push(last);
        if (s.length > 600) s.shift();
      } else {
        last.c = q.bid;
        last.h = Math.max(last.h, q.bid);
        last.l = Math.min(last.l, q.bid);
      }
      last.v += Math.round(5 + Math.random() * 40);
      const ls = barListeners.get(key(qt.symbol, tf));
      ls?.forEach((l) => l(toKline(last, q.digits)));
    }
  }
}

export function subscribeKline(code: string, tf: Timeframe, l: BarListener): () => void {
  const k = key(code, tf);
  if (!barListeners.has(k)) barListeners.set(k, new Set());
  barListeners.get(k)!.add(l);
  ensureTimer();
  return () => {
    barListeners.get(k)?.delete(l);
  };
}

/** 每个品种今日走势（最近 24 根 1 小时 K 线的收盘价），桌面行情表的迷你走势图用 */
export function sparklines(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of symbols()) out[s.code] = klines(s.code, '1h').slice(-24).map((k) => k.close);
  return out;
}
