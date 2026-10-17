import type { Chain, SessionTemplate, SymbolCategory } from '../api/types';
import { IS_MOCK } from '../api/mode';

/** 第一版支持的三条链（USDT） */
export const CHAINS: Chain[] = ['ERC20', 'TRC20', 'BSC'];

/** 后端（真实接口）的品种类别：外汇只有一个 fx（V4 迁移）。新增品种只能选这几种 */
export const BACKEND_CATEGORIES: SymbolCategory[] = ['fx', 'metal', 'index', 'energy', 'crypto', 'stock'];

/** 品种分类筛选：原型用细分的外汇类别（00-架构方案.md 3.6，另加新增品种用的 fx），真实接口用后端的类别 */
export const CATEGORIES: SymbolCategory[] = IS_MOCK
  ? ['forex_major', 'forex_cross', 'cnh', 'fx', 'metal', 'index', 'energy', 'crypto', 'stock']
  : BACKEND_CATEGORIES;

/** 新增品种的交易时段模板（和后端 MarketAdminApi.SessionTemplate 一致） */
export const SESSION_TEMPLATES: SessionTemplate[] = ['fx', 'crypto', 'us_stock'];

/** 星期（0 = 周日） */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * 加点的默认值：每边 10 点，买卖合计 20 点（Amos 2026-10-17"买卖一共 20 点"，后端迁移 V24）。1 点 = 最小价格单位 10^(-digits)，
 * 加点是卖价减、买价加各一次，所以每边 10 点：5 位小数 → 0.00010，3 位 → 0.010，2 位 → 0.10，1 位 → 1.0，0 位 → 10；点差因此宽 20 点。
 */
export const DEFAULT_MARKUP_POINTS = 10;

/** 小数位 → 默认加点（十进制字符串，不经过浮点）；小数位不在 0–8 时为空 */
export function defaultMarkup(digits: number | undefined | null): string | undefined {
  if (digits == null || !Number.isInteger(digits) || digits < 0 || digits > 8) return undefined;
  if (digits === 0) return String(DEFAULT_MARKUP_POINTS);
  const s = String(DEFAULT_MARKUP_POINTS).padStart(digits + 1, '0');
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

/** 所有小数位的默认加点（每边 10 点）：加点还是其中之一（或空）时，说明运营没改过 */
const DEFAULT_MARKUPS = new Set(Array.from({ length: 9 }, (_, d) => defaultMarkup(d)));

/** 新增品种表单改小数位时：加点还是默认值（没改过）就跟着换成新小数位的默认值（每边 10 点）；运营改过的不动 */
export function followDigits(markup: string | undefined, digits: number | undefined): string | undefined {
  const next = defaultMarkup(digits);
  if (!next) return markup;
  return !markup?.trim() || DEFAULT_MARKUPS.has(markup.trim()) ? next : markup;
}
