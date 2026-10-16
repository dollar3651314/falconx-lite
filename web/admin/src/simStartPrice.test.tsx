/**
 * 模拟起始价（v2 后台补充，后台方案第 11 节）：只在报价源是模拟源时显示和生效。
 * 校验函数、模拟层（和后端一致）、真实接口的请求体、新增抽屉有 / 没有输入框和页面上的校验提示。
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from './api/types';
import type { SymbolCreateInput } from './api/types';
import { createSymbol, listAuditLogs, listSymbols, switchIdentity, updateSymbol } from './api';
import * as real from './api/real';
import { setMockSimulatedQuotes } from './mocks/handlers';
import { fakeFetch } from './test/fakeFetch';
import { renderAs } from './test/render';
import { quoteFreshness } from './utils/display';
import { simStartPriceProblems } from './utils/validators';
import { SymbolCreateDrawer } from './pages/market/SymbolCreateDrawer';

const input = (code: string, extra: Partial<SymbolCreateInput> = {}): SymbolCreateInput => ({
  code,
  nameZh: '模拟币',
  nameEn: 'Sim Coin',
  category: 'crypto',
  digits: 2,
  contractSize: '1',
  quoteCurrency: 'USD',
  maxLeverage: 50,
  maintenanceMarginRate: '0.005',
  openFeeRate: '0.0005',
  minLots: '0.01',
  maxLots: '20',
  lotStep: '0.01',
  markup: '0',
  hot: false,
  sessionTemplate: 'crypto',
  ...extra,
});

afterEach(async () => {
  vi.unstubAllGlobals();
  setMockSimulatedQuotes(true);
  await switchIdentity('super');
});

describe('模拟起始价：校验（和后端一致）', () => {
  it('空表示不填；正数；整数部分最多 16 位；小数位不超过 digits，末尾的 0 不算', () => {
    expect(simStartPriceProblems('', 2)).toEqual([]);
    expect(simStartPriceProblems(undefined, 2)).toEqual([]);
    expect(simStartPriceProblems('123.45', 2)).toEqual([]);
    expect(simStartPriceProblems('1.2300', 2)).toEqual([]);
    expect(simStartPriceProblems('100', 0)).toEqual([]);
    expect(simStartPriceProblems('1.234', 2)).toEqual(['validation.simStartPriceDecimals']);
    expect(simStartPriceProblems('1.5', 0)).toEqual(['validation.simStartPriceDecimals']);
    expect(simStartPriceProblems('0', 2)).toEqual(['validation.simStartPrice']);
    expect(simStartPriceProblems('0.00', 2)).toEqual(['validation.simStartPrice']);
    expect(simStartPriceProblems('-1', 2)).toEqual(['validation.simStartPrice']);
    expect(simStartPriceProblems('abc', 2)).toEqual(['validation.simStartPrice']);
    expect(simStartPriceProblems('1e3', 2)).toEqual(['validation.simStartPrice']);
    expect(simStartPriceProblems('12345678901234567', 2)).toEqual(['validation.simStartPrice']);
    // 小数位没填或不合法时只查格式
    expect(simStartPriceProblems('1.234567', undefined)).toEqual([]);
  });
});

describe('模拟起始价：模拟层', () => {
  it('原型是模拟报价源：列表告诉页面；新增时填了起始价立即有报价，审计记下', async () => {
    expect((await listSymbols({ page: 1, pageSize: 1 })).simulatedQuotes).toBe(true);
    const s = await createSymbol(input('ZSIM1', { simStartPrice: '123.450' }), '上新');
    expect(s.simStartPrice).toBe('123.45');
    expect(s.lastQuoteAt).not.toBeNull();
    expect(quoteFreshness(s)).toBe('fresh');
    const log = (await listAuditLogs({ page: 1, pageSize: 5, action: 'symbol.create' })).items[0];
    expect(log.after).toMatchObject({ simStartPrice: '123.45' });
  });

  it('不填：没有报价；字段错误和其他字段一起返回；编辑里补填后有报价', async () => {
    const bad = await createSymbol(input('ZSIM2', { simStartPrice: '1.234', nameZh: '' }), '测试').catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(ApiError);
    expect((bad as ApiError).fields).toEqual(expect.arrayContaining([{ field: 'simStartPrice', code: 'tooManyDecimals' }, { field: 'nameZh', code: 'required' }]));
    const s = await createSymbol(input('ZSIM2'), '上新');
    expect(s.simStartPrice ?? null).toBeNull();
    expect(s.lastQuoteAt).toBeNull();
    await expect(updateSymbol('ZSIM2', { simStartPrice: 'x' }, '补价')).rejects.toMatchObject({ fields: [{ field: 'simStartPrice', code: 'invalid' }] });
    await updateSymbol('ZSIM2', { simStartPrice: '8.5' }, '补价');
    const after = (await listSymbols({ page: 1, pageSize: 10, keyword: 'ZSIM2' })).items[0];
    expect(after.simStartPrice).toBe('8.5');
    expect(after.lastQuoteAt).not.toBeNull();
    const log = (await listAuditLogs({ page: 1, pageSize: 5, action: 'symbol.update' })).items[0];
    expect(log.after).toMatchObject({ simStartPrice: '8.5' });
  });

  it('不是模拟报价源（例如接了 LP）：这一项被忽略，不校验、不保存', async () => {
    setMockSimulatedQuotes(false);
    expect((await listSymbols({ page: 1, pageSize: 1 })).simulatedQuotes).toBe(false);
    const s = await createSymbol(input('ZSIM3', { simStartPrice: 'abc' }), '上新');
    expect(s.simStartPrice ?? null).toBeNull();
    expect(s.lastQuoteAt).toBeNull();
  });
});

describe('模拟起始价：真实接口', () => {
  it('列表带 simulatedQuotes（后端没返回按 false）；新增的请求体带 simStartPrice', async () => {
    fakeFetch({ 'GET /api/admin/symbols': { body: { items: [], total: 0, page: 1, pageSize: 20, simulatedQuotes: true } } });
    expect((await real.listSymbols({ page: 1, pageSize: 20 })).simulatedQuotes).toBe(true);
    fakeFetch({ 'GET /api/admin/symbols': { body: { items: [], total: 0, page: 1, pageSize: 20 } } });
    expect((await real.listSymbols({ page: 1, pageSize: 20 })).simulatedQuotes).toBe(false);
    const { calls } = fakeFetch({
      'POST /api/admin/symbols': { body: { ...input('ZT9'), swapLong: '0', swapShort: '0', enabled: true, openPaused: true, simStartPrice: '10' } },
      'PUT /api/admin/symbols/ZT9': { body: {} },
    });
    await real.createSymbol(input('ZT9', { simStartPrice: '10' }), '上新');
    expect(calls[0].body).toMatchObject({ code: 'ZT9', simStartPrice: '10', reason: '上新' });
    await real.updateSymbol('ZT9', { simStartPrice: '11' }, '补价');
    expect(calls[1].body).toEqual({ simStartPrice: '11', reason: '补价' });
  });
});

describe('模拟起始价：新增抽屉', () => {
  it('模拟报价源：有输入框和说明；小数位超过品种的小数位时在页面上提示', async () => {
    renderAs(<SymbolCreateDrawer open simulatedQuotes onClose={() => {}} onCreated={() => {}} />);
    const drawer = await screen.findByRole('dialog');
    const field = await within(drawer).findByLabelText('模拟起始价', undefined, { timeout: 30_000 });
    expect(within(drawer).getByText(/当前是模拟报价源/)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: '1.234' } });
    await waitFor(() => expect(within(drawer).getByText('小数位不能超过品种的小数位（2 位）')).toBeInTheDocument(), { timeout: 10_000 });
  }, 90_000);

  it('不是模拟报价源：没有输入框', async () => {
    renderAs(<SymbolCreateDrawer open simulatedQuotes={false} onClose={() => {}} onCreated={() => {}} />);
    const drawer = await screen.findByRole('dialog');
    await within(drawer).findByLabelText('小数位', undefined, { timeout: 30_000 });
    expect(within(drawer).queryByLabelText('模拟起始价')).toBeNull();
    expect(within(drawer).queryByText(/当前是模拟报价源/)).toBeNull();
  }, 90_000);
});
