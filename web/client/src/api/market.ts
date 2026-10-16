/**
 * 行情接口。real：品种和 K 线走 HTTP（/api/market/*），报价和 K 线更新走 WebSocket /api/ws/market；mock：原型模拟层。
 */
import * as mock from '../mocks/market';
import { respond } from '../mocks/delay';
import { IS_MOCK } from './mode';
import * as real from './real/market';
import type { ChartPeriod, Kline, Quote, SymbolInfo, Tick, Timeframe } from './types';

export const listSymbols = (): Promise<SymbolInfo[]> => (IS_MOCK ? respond(() => mock.symbols(), () => []) : real.listSymbols());

/** 全部品种的今日走势（收盘价序列），一次请求取回（GET /api/market/sparklines） */
export const getSparklines = (): Promise<Record<string, string[]>> => (IS_MOCK ? respond(() => mock.sparklines(), () => ({})) : real.getSparklines());

export const getKlines = (symbol: string, tf: Timeframe): Promise<Kline[]> => (IS_MOCK ? respond(() => mock.klines(symbol, tf), () => []) : real.getKlines(symbol, tf));

/** 最近逐笔报价，Tick 图的初始数据（之后用 subscribeQuotes 推来的报价往后接） */
export const getTicks = (symbol: string): Promise<Tick[]> => (IS_MOCK ? respond(() => mock.ticks(symbol), () => []) : real.getTicks(symbol));

/** 订阅报价：先回调一次全量快照（真实环境：连上后服务器推全量），之后每次有变化回调变化的部分 */
export function subscribeQuotes(cb: (quotes: Quote[]) => void): () => void {
  if (!IS_MOCK) return real.subscribeQuotes(cb);
  cb(mock.allQuotes());
  return mock.subscribeQuotes(cb);
}

/** 订阅某个品种某个周期的最新一根 K 线 */
export const subscribeKline = (symbol: string, tf: Timeframe, cb: (bar: Kline) => void): (() => void) =>
  IS_MOCK ? mock.subscribeKline(symbol, tf, cb) : real.subscribeKline(symbol, tf, cb);

export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
/** 图表周期选择：Tick 图放在最前 */
export const CHART_PERIODS: ChartPeriod[] = ['tick', ...TIMEFRAMES];
export const TF_SECONDS: Record<Timeframe, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
