import type { SymbolInfo } from '../api/types';
import { formatDecimal } from './format';

/** 合约单位文案，例如"100 盎司/手"、"100,000 EUR/手" */
export function contractUnitText(t: (k: string, o?: Record<string, unknown>) => string, s: SymbolInfo): string {
  return t(`units.${s.unit}`, { n: formatDecimal(s.contractSize, 0), ccy: s.baseCcy });
}

export function symbolName(s: SymbolInfo, lang: string): string {
  return lang === 'en' ? s.nameEn : s.nameZh;
}

/** 点差（点数）：(买价 − 卖价) ÷ 最小报价单位，例如 EURUSD 1.16443 − 1.16431 = 12 点 */
export function spreadPoints(q: { bid: string; ask: string }, digits: number): string {
  return String(Math.round((Number(q.ask) - Number(q.bid)) * 10 ** digits));
}
