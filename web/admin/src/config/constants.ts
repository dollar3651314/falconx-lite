import type { Chain, SymbolCategory } from '../api/types';

/** 第一版支持的三条链（USDT） */
export const CHAINS: Chain[] = ['ERC20', 'TRC20', 'BSC'];

/** 品种分类（00-架构方案.md 3.6） */
export const CATEGORIES: SymbolCategory[] = ['forex_major', 'forex_cross', 'cnh', 'metal', 'index', 'energy', 'crypto', 'stock'];

/** 星期（0 = 周日） */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
