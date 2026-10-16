/** 价格和涨跌幅的显示格式（纯函数，和客户端行情表一致：千分位、涨跌幅带符号和 %） */

/** "112480.5" → "112,480.5"；小数位保持接口给的（接口已按品种小数位格式化），不经过浮点 */
export function formatPrice(bid: string): string {
  const neg = bid.startsWith('-');
  const [int, frac] = (neg ? bid.slice(1) : bid).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + grouped + (frac !== undefined ? `.${frac}` : '');
}

/** 涨跌方向：大于 0 涨、小于 0 跌、0 平 */
export function direction(pct: string): 'up' | 'down' | 'flat' {
  const n = Number(pct);
  if (!Number.isFinite(n) || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}

/** "0.62" → "+0.62%"，"-1.35" → "-1.35%"，"0.00" → "0.00%" */
export function formatPct(pct: string): string {
  const d = direction(pct);
  const abs = pct.replace(/^[-+]/, '');
  return `${d === 'up' ? '+' : d === 'down' ? '-' : ''}${abs}%`;
}
