/** 图表工具栏（v2 E5、AC2-18）：Tick 图能切换、买卖价线可开关、5 种指标可选择且记在本地；手机收进菜单、电脑一行排开。 */
import { fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { getTicks } from '../api/market';
import { readChartPrefs } from '../hooks/useChartPrefs';
import { resetDb } from '../mocks/db';
import { renderPage } from '../test/renderApp';
import Trade from './Trade';

// 测试环境没有画布：用一个探针代替图表，只把收到的参数写出来（图表本身在截图检查里看）
vi.mock('../components/KChart', () => ({
  KChart: (p: { period: string; indicators: string[]; showBidAsk: boolean }) => (
    <div data-testid="chart" data-period={p.period} data-ind={p.indicators.join(',')} data-bidask={String(p.showBidAsk)} />
  ),
}));

function setDesktop(on: boolean) {
  window.matchMedia = ((query: string) =>
    ({ matches: on && query.includes('min-width: 1024px'), media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false }) as MediaQueryList) as typeof window.matchMedia;
}

function renderTrade() {
  renderPage(
    <Routes>
      <Route path="/trade/:symbol" element={<Trade />} />
    </Routes>,
    '/trade/XAUUSD',
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  setDesktop(false);
  resetDb();
});

describe('图表工具栏', () => {
  it('默认：15m、MA 和买卖价线打开', async () => {
    renderTrade();
    const chart = await screen.findByTestId('chart');
    expect(chart).toHaveAttribute('data-period', '15m');
    expect(chart).toHaveAttribute('data-ind', 'ma');
    expect(chart).toHaveAttribute('data-bidask', 'true');
  });

  it('周期里有 Tick，切换后图表收到 tick，并记在本地', async () => {
    renderTrade();
    const bar = await screen.findByRole('radiogroup', { name: '图表周期' });
    expect(within(bar).getAllByRole('radio').map((b) => b.textContent)).toEqual(['Tick', '1m', '5m', '15m', '1h', '4h', '1d']);
    fireEvent.click(within(bar).getByRole('radio', { name: 'Tick' }));
    expect(screen.getByTestId('chart')).toHaveAttribute('data-period', 'tick');
    expect(localStorage.getItem('fx.trade.tf')).toBe('tick');
  });

  it('手机：指标收进菜单；打开 MACD、RSI，关掉买卖价线，记在本地，重新打开页面还在', async () => {
    renderTrade();
    const toggle = await screen.findByRole('button', { name: /^指标/ });
    expect(screen.queryByRole('switch', { name: 'MACD(12,26,9)' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    const pop = screen.getByRole('group', { name: '指标' });
    expect(within(pop).getAllByRole('switch').map((b) => b.textContent)).toEqual(['买卖价线', 'MA(7,25)', 'EMA(12,26)', 'BOLL(20,2)', 'MACD(12,26,9)', 'RSI(14)']);
    fireEvent.click(within(pop).getByRole('switch', { name: 'RSI(14)' }));
    fireEvent.click(within(pop).getByRole('switch', { name: 'MACD(12,26,9)' }));
    fireEvent.click(within(pop).getByRole('switch', { name: '买卖价线' }));
    expect(within(pop).getByRole('switch', { name: 'MACD(12,26,9)' })).toHaveAttribute('aria-checked', 'true');
    const chart = screen.getByTestId('chart');
    expect(chart).toHaveAttribute('data-ind', 'ma,macd,rsi');
    expect(chart).toHaveAttribute('data-bidask', 'false');
    expect(readChartPrefs()).toEqual({ indicators: ['ma', 'macd', 'rsi'], bidAsk: false });
    // 点菜单外面收起
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: '指标' })).not.toBeInTheDocument();
  });

  it('电脑：指标一行排开，不需要菜单；读取本地记录', async () => {
    localStorage.setItem('fx.chart.prefs', JSON.stringify({ indicators: ['boll', 'ema', 'xyz'], bidAsk: true }));
    setDesktop(true);
    renderTrade();
    const group = await screen.findByRole('group', { name: '指标' });
    expect(screen.queryByRole('button', { name: /^指标/ })).not.toBeInTheDocument();
    expect(within(group).getByRole('switch', { name: 'EMA' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('chart')).toHaveAttribute('data-ind', 'ema,boll');
    fireEvent.click(within(group).getByRole('switch', { name: 'BOLL' }));
    expect(screen.getByTestId('chart')).toHaveAttribute('data-ind', 'ema');
  });

  it('本地记录损坏时用默认值', () => {
    localStorage.setItem('fx.chart.prefs', '{oops');
    expect(readChartPrefs()).toEqual({ indicators: ['ma'], bidAsk: true });
  });
});

describe('Tick 数据（原型模式）', () => {
  it('最近逐笔报价按时间递增，不超过 500 笔，卖价 < 买价', async () => {
    const ticks = await getTicks('XAUUSD');
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(500);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].time).toBeGreaterThan(ticks[i - 1].time);
    for (const t of ticks) expect(Number(t.bid)).toBeLessThan(Number(t.ask));
  });
});
