import type { SymbolInfo } from '../api/types';
import { formatDecimal } from './format';

/** 合约单位文案，例如"100 盎司/手"、"100,000 EUR/手" */
export function contractUnitText(t: (k: string, o?: Record<string, unknown>) => string, s: SymbolInfo): string {
  return t(`units.${s.unit}`, { n: formatDecimal(s.contractSize, 0), ccy: s.baseCcy });
}

export function symbolName(s: SymbolInfo, lang: string): string {
  return lang === 'en' ? s.nameEn : s.nameZh;
}
