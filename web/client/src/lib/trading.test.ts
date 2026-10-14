import { dec, toFixed } from './decimal';
import { estimateOrder, execPrice, liquidationAfterAddMargin, pnlAt } from './trading';
import type { SymbolInfo } from '../api/types';

const base: Omit<SymbolInfo, 'code' | 'category' | 'digits' | 'contractSize' | 'unit' | 'baseCcy' | 'quoteCcy' | 'maxLeverage'> = {
  nameZh: '',
  nameEn: '',
  minLots: '0.01',
  maxLots: '20',
  lotStep: '0.01',
  feeRate: '0.00005',
  maintenanceMarginRate: '0.005',
  hot: false,
  openPaused: false,
  tradingOpen: true,
};
const XAU: SymbolInfo = { ...base, maintenanceMarginRate: '0.0025', code: 'XAUUSD', category: 'metal', digits: 2, contractSize: '100', unit: 'ounce', baseCcy: 'XAU', quoteCcy: 'USD', maxLeverage: 200 };
const EUR: SymbolInfo = { ...base, code: 'EURUSD', category: 'fx', digits: 5, contractSize: '100000', unit: 'baseCcy', baseCcy: 'EUR', quoteCcy: 'USD', maxLeverage: 500 };
const JPY: SymbolInfo = { ...base, code: 'USDJPY', category: 'fx', digits: 3, contractSize: '100000', unit: 'baseCcy', baseCcy: 'USD', quoteCcy: 'JPY', maxLeverage: 500 };

describe('下单预估（A-01 合约大小）', () => {
  it('买入按 ask、卖出按 bid', () => {
    expect(execPrice('buy', { bid: '4126.35', ask: '4126.75' })).toBe('4126.75');
    expect(execPrice('sell', { bid: '4126.35', ask: '4126.75' })).toBe('4126.35');
  });

  it('黄金 0.10 手 50×：名义价值、保证金、手续费与效果图 M2 一致', () => {
    const e = estimateOrder({ symbol: XAU, price: dec('4126.75'), lots: dec('0.10'), leverage: 50, side: 'buy', quoteToUsd: '1' });
    expect(toFixed(e.notional, 2)).toBe('41267.50');
    expect(toFixed(e.margin, 2)).toBe('825.35');
    expect(toFixed(e.fee, 2)).toBe('2.06');
    // 维持保证金率 0.25%：可承受亏损 825.35 − 103.17 = 722.18，即 72.22 美元/盎司
    expect(toFixed(e.liquidationPrice, 2)).toBe('4054.53');
  });

  it('外汇 1 手 = 100,000 基础货币；空单强平价在开仓价上方', () => {
    const e = estimateOrder({ symbol: EUR, price: dec('1.16420'), lots: dec('1'), leverage: 100, side: 'sell', quoteToUsd: '1' });
    expect(toFixed(e.notional, 2)).toBe('116420.00');
    expect(toFixed(e.margin, 2)).toBe('1164.20');
    expect(toFixed(e.liquidationPrice, 5)).toBe('1.17002');
  });

  it('非美元报价品种按汇率折算成 USDT', () => {
    const e = estimateOrder({ symbol: JPY, price: dec('151.842'), lots: dec('1'), leverage: 100, side: 'buy', quoteToUsd: '0.0065858' });
    // 151.842 × 100,000 JPY × 0.0065858 ≈ 100,000 USD
    expect(toFixed(e.notional, 0)).toBe('100000');
    expect(toFixed(e.margin, 2)).toBe('1000.00');
  });

  it('盈亏与追加保证金后的强平价', () => {
    expect(toFixed(pnlAt('buy', dec('4120.85'), dec('4126.35'), dec('0.10'), '100', '1'), 2)).toBe('55.00');
    expect(toFixed(pnlAt('sell', dec('1.16420'), dec('1.16432'), dec('1'), '100000', '1'), 2)).toBe('-12.00');
    const pos = { id: 'p', symbol: 'XAUUSD', side: 'buy' as const, lots: '0.10', leverage: 50, openPrice: '4126.75', margin: '825.35', maintenanceMarginRate: '0.0025', liquidationPrice: '4054.53', openedAt: '' };
    // 追加 619 USDT 后，可承受亏损多 61.90 美元/盎司
    expect(liquidationAfterAddMargin(pos, XAU, '1', dec('619'))).toBe('3992.63');
  });
});
