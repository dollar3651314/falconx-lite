/** UI 风格 C：手机和电脑分开的页面结构、下单抽屉、自选、主题和涨跌色。 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { useTheme } from '../app/contexts';
import { ThemeProvider } from '../app/ThemeProvider';
import { resetFavorites } from '../hooks/useFavorites';
import { resetDb } from '../mocks/db';
import { renderPage } from '../test/renderApp';
import Markets from './Markets';
import Trade from './Trade';

// 测试环境没有画布，K 线组件用空组件代替（K 线本身在截图检查里看）
vi.mock('../components/KChart', () => ({ KChart: () => null }));

function setDesktop(on: boolean) {
  window.matchMedia = ((query: string) =>
    ({ matches: on && query.includes('min-width: 1024px'), media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false }) as MediaQueryList) as typeof window.matchMedia;
}

afterEach(() => {
  setDesktop(false);
  resetFavorites();
  resetDb();
});

describe('行情页：手机和电脑分开设计', () => {
  it('电脑上是宽表格：卖价、买价、点差、最高、最低、今日走势、交易', async () => {
    setDesktop(true);
    renderPage(<Markets />, '/markets');
    const table = await screen.findByRole('table');
    for (const h of ['卖价', '买价', '点差', '最高', '最低', '今日走势', '交易']) expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(screen.getByText('显示 50 / 50 个品种')).toBeInTheDocument();
  });

  it('手机上是列表，每行同时显示卖价和买价', async () => {
    renderPage(<Markets />, '/markets');
    expect(await screen.findByText('显示 50 / 50 个品种')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('卖价 / 买价')).toBeInTheDocument();
  });

  it('自选：默认是热门品种，可以加入和取消', async () => {
    setDesktop(true);
    renderPage(<Markets />, '/markets');
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('tab', { name: '自选' }));
    const before = screen.getAllByRole('button', { name: '取消自选' }).length;
    expect(before).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: '取消自选' })[0]);
    await waitFor(() => expect(screen.queryAllByRole('button', { name: '取消自选' }).length).toBe(before - 1));
  });
});

describe('交易页：手机下单抽屉、电脑下单面板', () => {
  it('点"买入"后弹出，方向已定；杠杆、止盈止损折叠，可切换方向', async () => {
    renderPage(
      <Routes>
        <Route path="/trade/:symbol" element={<Trade />} />
      </Routes>,
      '/trade/XAUUSD',
    );
    const buy = await screen.findByRole('button', { name: /^买入/ });
    fireEvent.click(buy);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: '确认买入 0.10 手 XAUUSD' })).toBeInTheDocument();
    // 抽屉里不再有买卖二选一，杠杆输入框默认收起
    expect(within(dialog).queryByRole('radiogroup', { name: '方向' })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/^杠杆/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /^杠杆/ }));
    expect(within(dialog).getByRole('group', { name: '快捷杠杆' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /切换为卖出/ }));
    expect(within(dialog).getByRole('button', { name: '确认卖出 0.10 手 XAUUSD' })).toBeInTheDocument();
  });

  it('电脑交易页：右栏常驻下单面板，在右栏切换方向；图表上没有卖出 / 买入按钮（体验优化 1021 第 5 条）', async () => {
    setDesktop(true);
    renderPage(
      <Routes>
        <Route path="/trade/:symbol" element={<Trade />} />
      </Routes>,
      '/trade/XAUUSD',
    );
    expect(await screen.findByRole('button', { name: '确认买入 0.10 手 XAUUSD' })).toBeInTheDocument();
    expect(document.querySelector('.px-btns')).toBeNull();
    // 确认按钮放在固定在右栏底部的那一块里（第 3 条）
    expect(screen.getByRole('button', { name: '确认买入 0.10 手 XAUUSD' }).closest('.op-sticky')).not.toBeNull();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '方向' })).getByRole('radio', { name: /卖出/ }));
    expect(await screen.findByRole('button', { name: '确认卖出 0.10 手 XAUUSD' })).toBeInTheDocument();
  });

  it('电脑交易页左栏：默认只列自选品种名称（不跳价格），可以切到全部行情、收起和展开（第 7 条）', async () => {
    setDesktop(true);
    localStorage.removeItem('fx.trade.wl');
    renderPage(
      <Routes>
        <Route path="/trade/:symbol" element={<Trade />} />
      </Routes>,
      '/trade/XAUUSD',
    );
    const names = await screen.findByRole('list', { name: '自选' });
    expect(within(names).getAllByRole('button').length).toBeGreaterThan(0);
    expect(names.querySelector('.sym-price, .sym-ba')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '全部行情' }));
    expect(await screen.findByText('显示 50 / 50 个品种')).toBeInTheDocument();
    expect(localStorage.getItem('fx.trade.wl')).toBe('full');
    fireEvent.click(screen.getByRole('button', { name: '收起品种列表' }));
    expect(screen.queryByRole('tab', { name: '全部行情' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开品种列表' }));
    expect(await screen.findByRole('list', { name: '自选' })).toBeInTheDocument();
  });

  it('电脑交易页左栏：自选全部取消后显示空状态，可以去浏览全部品种', async () => {
    setDesktop(true);
    localStorage.setItem('fx.favorites', '[]');
    resetFavorites();
    localStorage.setItem('fx.favorites', '[]');
    renderPage(
      <Routes>
        <Route path="/trade/:symbol" element={<Trade />} />
      </Routes>,
      '/trade/XAUUSD',
    );
    expect(await screen.findByText('还没有自选品种')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '浏览全部品种' }));
    expect(await screen.findByText('显示 50 / 50 个品种')).toBeInTheDocument();
    localStorage.removeItem('fx.trade.wl');
  });
});

describe('主题和涨跌色', () => {
  function Probe() {
    const { theme, upDown, setUpDown } = useTheme();
    return (
      <button type="button" onClick={() => setUpDown(upDown === 'green' ? 'red' : 'green')}>
        {theme}-{upDown}
      </button>
    );
  }

  it('默认浅色（体验优化 1021 第 8 条）、绿涨红跌；切换后写到页面根元素', () => {
    localStorage.clear();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('light-green');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('fx.theme.v3')).toBeNull();
    act(() => screen.getByRole('button').click());
    expect(document.documentElement.dataset.updown).toBe('red');
    expect(localStorage.getItem('fx.updown')).toBe('red');
  });

  it('自己选过深色的保留；旧版本每次自动写入的 fx.theme.v2 不再沿用', () => {
    function ThemeProbe() {
      const { theme, setTheme } = useTheme();
      return (
        <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme}
        </button>
      );
    }
    localStorage.clear();
    localStorage.setItem('fx.theme.v2', 'dark');
    const first = render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('light');
    act(() => screen.getByRole('button').click());
    expect(localStorage.getItem('fx.theme.v3')).toBe('dark');
    first.unmount();
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
