/**
 * 行情接口。正式环境：品种和 K 线走 HTTP（/api/market/*），报价和 K 线更新走 WebSocket。
 */
import * as mock from '../mocks/market';
import { respond } from '../mocks/delay';
import type { Kline, Quote, SymbolInfo, Timeframe } from './types';

export const listSymbols = (): Promise<SymbolInfo[]> => respond(() => mock.symbols(), () => []);

/** 全部品种的今日走势（收盘价序列），一次请求取回；正式环境为 GET /api/market/sparklines */
export const getSparklines = (): Promise<Record<string, string[]>> => respond(() => mock.sparklines(), () => ({}));

export const getKlines = (symbol: string, tf: Timeframe): Promise<Kline[]> => respond(() => mock.klines(symbol, tf), () => []);

/** 订阅报价：先回调一次全量快照，之后每次有变化回调变化的部分 */
export function subscribeQuotes(cb: (quotes: Quote[]) => void): () => void {
  cb(mock.allQuotes());
  return mock.subscribeQuotes(cb);
}

/** 订阅某个品种某个周期的最新一根 K 线 */
export const subscribeKline = (symbol: string, tf: Timeframe, cb: (bar: Kline) => void): (() => void) => mock.subscribeKline(symbol, tf, cb);

export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
export const TF_SECONDS = mock.TF_SECONDS;
