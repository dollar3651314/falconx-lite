/**
 * 新增品种的默认加点（Amos 2026-10-17"买卖一共 20 点"，后端迁移 V24）：每边 10 点 = 10 × 10^(-小数位)，
 * 改小数位时没改过的默认值跟着变，运营改过的不动。
 */
import { describe, expect, it } from 'vitest';
import { defaultMarkup, followDigits } from './constants';

describe('默认加点：买卖合计 20 点 = 每边 10 点', () => {
  it('按小数位换算，十进制字符串', () => {
    expect(defaultMarkup(5)).toBe('0.00010');
    expect(defaultMarkup(3)).toBe('0.010');
    expect(defaultMarkup(2)).toBe('0.10');
    expect(defaultMarkup(1)).toBe('1.0');
    expect(defaultMarkup(0)).toBe('10');
    expect(defaultMarkup(8)).toBe('0.00000010');
    expect(defaultMarkup(9)).toBeUndefined();
    expect(defaultMarkup(undefined)).toBeUndefined();
  });

  it('改小数位：默认值或空跟着变，运营改过的不动', () => {
    expect(followDigits('0.10', 5)).toBe('0.00010');
    expect(followDigits('', 3)).toBe('0.010');
    expect(followDigits(undefined, 1)).toBe('1.0');
    expect(followDigits('0.25', 5)).toBe('0.25');
    expect(followDigits('0.10', undefined)).toBe('0.10');
  });
});
