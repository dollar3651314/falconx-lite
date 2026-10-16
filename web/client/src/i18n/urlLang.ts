import type { Lang } from '../api/types';

/**
 * 从地址栏参数里读语言（官网跳转时带 `?lang=`，v2 需求 4.4）。
 * 接受 `zh`、`zh-CN`（不分大小写）和 `en`；没有参数或值不认识时返回 null（照旧用记住的语言）。
 */
export function langFromSearch(search: string): Lang | null {
  const v = new URLSearchParams(search).get('lang');
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s === 'en') return 'en';
  if (s === 'zh' || s === 'zh-cn') return 'zh-CN';
  return null;
}
