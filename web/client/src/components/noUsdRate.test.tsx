/**
 * 后端暂时取不到汇率（报价的 quoteToUsd 为空）时：按 USD 折算的预估显示"—"，页面不出 NaN、不崩溃。
 */
import { screen, waitFor } from '@testing-library/react';
import type { Quote } from '../api/types';
import { allQuotes } from '../mocks/market';
import { SYMBOL_SEEDS } from '../mocks/data/symbols';
import { renderPage } from '../test/renderApp';
import { OrderPanel } from './OrderPanel';
import { PositionsTabs } from './PositionsTabs';

// 报价照常推送，只是全部没有汇率
vi.mock('../api/market', async (orig) => {
  const m = await orig<typeof import('../api/market')>();
  return {
    ...m,
    subscribeQuotes: (cb: (qs: Quote[]) => void) => {
      cb(allQuotes().map((q) => ({ ...q, quoteToUsd: undefined })));
      return () => {};
    },
  };
});

describe('没有汇率（quoteToUsd 为空）', () => {
  it('下单面板：保证金、手续费、强平价、名义价值显示"—"，没有 NaN', async () => {
    const jpy = SYMBOL_SEEDS.find((s) => s.info.code === 'USDJPY')!.info;
    const { container } = renderPage(<OrderPanel symbol={jpy} inline />, '/trade/USDJPY');
    expect(await screen.findByLabelText('数量（手）')).toBeInTheDocument();
    for (const label of ['名义价值', '保证金']) {
      const row = screen.getAllByText(label, { exact: false }).map((x) => x.closest('div')).find((d) => d?.querySelector('dd'));
      expect(row?.querySelector('dd')?.textContent).toBe('—');
    }
    expect(container.textContent).not.toMatch(/NaN|undefined/);
  });

  it('持仓列表：浮动盈亏显示"—"，没有 NaN', async () => {
    const { container } = renderPage(<PositionsTabs />, '/positions');
    await waitFor(() => expect(container.querySelectorAll('.pnl').length).toBeGreaterThan(0));
    const pnls = [...container.querySelectorAll('.pnl')].map((x) => x.textContent);
    expect(pnls).toContain('—');
    expect(container.textContent).not.toMatch(/NaN|undefined/);
  });
});
