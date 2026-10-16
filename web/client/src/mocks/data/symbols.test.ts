import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SYMBOL_SEEDS } from './symbols';

/** 后端模拟报价源的起始价（技术方案/v2-模拟报价起始价.md）。测试在 web/client 目录下运行 */
function backendCsv(): Map<string, { price: string; spread: string }> {
  const text = readFileSync(join(process.cwd(), '../../backend/src/main/resources/simulated-prices.csv'), 'utf8');
  const rows = text.split('\n').filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('code,'));
  return new Map(rows.map((l) => {
    const [code, price, spread] = l.trim().split(',');
    return [code, { price, spread }];
  }));
}

describe('原型品种表', () => {
  it('起始价和点差与后端模拟报价源 simulated-prices.csv 完全一致（改一边必须同时改另一边）', () => {
    const csv = backendCsv();
    expect([...csv.keys()].sort()).toEqual(SYMBOL_SEEDS.map((s) => s.info.code).sort());
    for (const s of SYMBOL_SEEDS) {
      expect({ code: s.info.code, ...csv.get(s.info.code) }).toEqual({ code: s.info.code, price: s.price, spread: s.spread });
    }
  });

  it('起始价的小数位等于品种的 digits，点差为正且小于价格的 0.5%', () => {
    for (const s of SYMBOL_SEEDS) {
      expect(s.price.split('.')[1]?.length ?? 0, s.info.code).toBe(s.info.digits);
      expect(Number(s.spread), s.info.code).toBeGreaterThan(0);
      expect(Number(s.spread) / Number(s.price), s.info.code).toBeLessThan(0.005);
    }
  });
});
