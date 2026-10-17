/**
 * 品种页的当前报价源（技术方案/v2-报价源接入.md 第 5.5 节）：AllTick 主源、iTick 备源、币安（加密货币主源）、模拟、两家偏差暂停开仓（标红）。
 */
import { screen } from '@testing-library/react';
import { listSymbols } from './api';
import type { TradingSymbol } from './api/types';
import * as real from './api/real';
import { fakeFetch } from './test/fakeFetch';
import { renderAs } from './test/render';
import { QuoteSourceTag } from './pages/market/SymbolsPage';

const sym = (extra: Partial<TradingSymbol>): TradingSymbol => ({ code: 'EURUSD', enabled: true, ...extra }) as TradingSymbol;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('报价源', () => {
  it('主源只显示名字；备源加"（备）"；模拟；偏差暂停开仓标红；停用或没有报价源不显示', () => {
    const { container, unmount } = renderAs(
      <div>
        <span data-testid="a">
          <QuoteSourceTag s={sym({ quoteSource: 'alltick', quoteSourceState: 'primary' })} />
        </span>
        <span data-testid="b">
          <QuoteSourceTag s={sym({ quoteSource: 'itick', quoteSourceState: 'backup' })} />
        </span>
        <span data-testid="c">
          <QuoteSourceTag s={sym({ quoteSource: 'simulated', quoteSourceState: null })} />
        </span>
        <span data-testid="d">
          <QuoteSourceTag s={sym({ quoteSource: 'alltick', quoteSourceState: 'deviation' })} />
        </span>
        <span data-testid="e">
          <QuoteSourceTag s={sym({ quoteSource: 'alltick', enabled: false })} />
        </span>
        <span data-testid="f">
          <QuoteSourceTag s={sym({ quoteSource: null })} />
        </span>
        <span data-testid="g">
          <QuoteSourceTag s={sym({ code: 'BTCUSD', quoteSource: 'binance', quoteSourceState: 'primary' })} />
        </span>
        <span data-testid="h">
          <QuoteSourceTag s={sym({ code: 'BTCUSD', quoteSource: 'alltick', quoteSourceState: 'backup' })} />
        </span>
      </div>,
    );
    expect(screen.getByTestId('a').textContent).toBe(' · AllTick');
    expect(screen.getByTestId('b').textContent).toBe(' · iTick（备）');
    expect(screen.getByTestId('c').textContent).toBe(' · 模拟');
    expect(screen.getByTestId('d').textContent).toBe(' · AllTick · 偏差·暂停开仓');
    expect(screen.getByTestId('d').querySelector('.quote-source.stale')).not.toBeNull();
    expect(screen.getByTestId('e').textContent).toBe('');
    expect(screen.getByTestId('f').textContent).toBe('');
    // 加密货币：币安主（技术方案第 12 节），币安断了用 AllTick 备
    expect(screen.getByTestId('g').textContent).toBe(' · 币安');
    expect(screen.getByTestId('h').textContent).toBe(' · AllTick（备）');
    expect(container).toBeTruthy();
    unmount();
  });

  it('模拟层里启用的品种都是模拟报价源', async () => {
    const page = await listSymbols({ page: 1, pageSize: 100 });
    for (const s of page.items) expect(s.quoteSource).toBe(s.enabled ? 'simulated' : null);
  });

  it('真实接口：后端返回的报价源字段原样给页面', async () => {
    fakeFetch({
      'GET /api/admin/symbols': {
        body: { items: [{ code: 'EURUSD', enabled: true, swapLong: '0.1', swapShort: '0.1', quoteSource: 'itick', quoteSourceState: 'backup' }], total: 1, page: 1, pageSize: 20, simulatedQuotes: true },
      },
    });
    const page = await real.listSymbols({ page: 1, pageSize: 20 });
    expect(page.items[0].quoteSource).toBe('itick');
    expect(page.items[0].quoteSourceState).toBe('backup');
  });
});
