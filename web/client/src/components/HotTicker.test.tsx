/** 电脑版顶栏跑马灯（v2 E4，AC2-17）和品牌改名（AC2-11）。数据来自原型模拟层（单元测试按 mock 模式运行）。 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { resetDb } from '../mocks/db';
import { listSymbols } from '../api/market';
import { renderPage } from '../test/renderApp';
import { HotTicker } from './HotTicker';
import { Layout } from './Layout';

let width = 390;
let reducedMotion = false;
function setScreen(w: number, reduced = false) {
  width = w;
  reducedMotion = reduced;
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = min ? width >= Number(min[1]) : query.includes('prefers-reduced-motion: reduce') ? reducedMotion : false;
    return { matches, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false } as MediaQueryList;
  }) as typeof window.matchMedia;
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

afterEach(() => {
  setScreen(390);
  resetDb();
});

describe('电脑版顶栏跑马灯', () => {
  it('1280 宽以上：只显示热门品种，有卖价和涨跌幅，内容渲染两遍首尾相接（第二遍对读屏隐藏、不能用键盘聚焦）', async () => {
    setScreen(1440);
    const hot = (await listSymbols()).filter((s) => s.hot).map((s) => s.code);
    expect(hot.length).toBeGreaterThan(0);
    renderPage(<HotTicker />, '/markets');
    const ticker = await screen.findByRole('navigation', { name: '热门品种行情' });
    const links = within(ticker).getAllByRole('link');
    expect(links.map((a) => a.querySelector('b')?.textContent)).toEqual(hot);
    await waitFor(() => expect(links[0].querySelector('.ticker-px')?.textContent).not.toBe('—'));
    expect(links[0].querySelector('.ticker-chg')?.textContent).toMatch(/%$/);
    expect(links[0].querySelector('.ticker-chg')?.className).toMatch(/\b(up|down)\b/);
    const groups = ticker.querySelectorAll('.ticker-group');
    expect(groups).toHaveLength(2);
    expect(groups[1]).toHaveAttribute('aria-hidden', 'true');
    expect(groups[1].querySelector('a')).toHaveAttribute('tabindex', '-1');
    expect(ticker).not.toHaveClass('static');
  });

  it('点击进入该品种的交易页', async () => {
    setScreen(1440);
    renderPage(
      <>
        <HotTicker />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </>,
      '/markets',
    );
    const ticker = await screen.findByRole('navigation', { name: '热门品种行情' });
    const first = within(ticker).getAllByRole('link')[0];
    const code = first.querySelector('b')?.textContent;
    fireEvent.click(first);
    expect(screen.getByTestId('where')).toHaveTextContent(`/trade/${code}`);
  });

  it('减少动态效果：不滚动，只渲染一遍（静态横排）', async () => {
    setScreen(1440, true);
    renderPage(<HotTicker />, '/markets');
    const ticker = await screen.findByRole('navigation', { name: '热门品种行情' });
    expect(ticker).toHaveClass('static');
    expect(ticker.querySelectorAll('.ticker-group')).toHaveLength(1);
  });

  it('1280 以下（含手机）不显示', async () => {
    for (const w of [390, 1024, 1279]) {
      setScreen(w);
      const { unmount } = renderPage(<HotTicker />, '/markets');
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByRole('navigation', { name: '热门品种行情' })).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe('品牌改名', () => {
  it('顶栏 Logo 是 Quick Come，没有旧品牌名和 Lite 标记', async () => {
    setScreen(1440);
    const { container } = renderPage(
      <Routes>
        <Route path="/*" element={<Layout />} />
      </Routes>,
      '/markets',
    );
    const brand = await screen.findByRole('link', { name: 'Quick Come' });
    expect(brand).toHaveTextContent('Quick Come');
    expect(container.textContent).not.toMatch(/falcon\s*x/i);
    expect(container.textContent).not.toMatch(/\bLite\b/);
  });
});
