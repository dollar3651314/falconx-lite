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
