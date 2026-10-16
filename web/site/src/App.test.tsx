import { act, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { LANG_KEY } from './i18n/lang';

function setDesktop(on: boolean) {
  window.matchMedia = ((query: string) =>
    ({ matches: on && query.includes('min-width: 1024px'), media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false }) as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  setDesktop(false);
});

describe('官网首页（原型模式，模拟行情）', () => {
  it('手机：8 个区块都在（AC2-01），底部固定登录和注册（W8），顶部风险提示条（W9）', async () => {
    render(<App initialLang="zh-CN" />);
    expect(screen.getByTestId('risk-bar')).toHaveTextContent('风险');
    for (const id of ['hero', 'quote-board', 'sec-platform', 'sec-products', 'sec-steps', 'sec-safety', 'sec-faq', 'footer', 'sticky-cta']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId('menu-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('nav-register')).toBeNull();
    expect(screen.getAllByTestId('faq-item').length).toBeGreaterThanOrEqual(5);
    expect(screen.getByTestId('contact')).toHaveTextContent('info@quickcome.online');
    expect(screen.getByTestId('footer')).toHaveTextContent('© Quick Come');
    // 行情：10 个品种，模拟行情标"示例行情"
    expect(await screen.findByTestId('sample-tag')).toHaveTextContent('示例行情');
    const rows = screen.getAllByTestId('quote-row');
    expect(rows).toHaveLength(10);
    // 加密货币全天开市，模拟行情一定有价格
    const btc = rows.find((r) => r.getAttribute('data-symbol') === 'BTCUSD')!;
    expect(within(btc).getByTestId('bid').textContent).toMatch(/^\d{1,3}(,\d{3})*\.\d$/);
    // 每一行、首屏和底部按钮都去客户端注册页，带当前语言
    expect(btc.getAttribute('href')).toBe('/register?lang=zh-CN');
    expect(screen.getByTestId('sticky-register').getAttribute('href')).toBe('/register?lang=zh-CN');
    expect(screen.getByTestId('sticky-login').getAttribute('href')).toBe('/login?lang=zh-CN');
  });

  it('切换英文：文字和链接里的语言都变，并记住选择', async () => {
    render(<App initialLang="zh-CN" />);
    fireEvent.click(within(screen.getByTestId('lang-switch')).getByText('EN'));
    expect(screen.getByTestId('hero')).toHaveTextContent('trade global markets');
    expect(screen.getByTestId('hero-register').getAttribute('href')).toBe('/register?lang=en');
    expect(localStorage.getItem(LANG_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    // 英文页面上除了语言切换的"中"以外没有中文
    const text = (document.body.textContent || '').replace('中', '');
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('电脑：顶部导航有登录和注册，行情面板有表头和走势列', async () => {
    setDesktop(true);
    render(<App initialLang="en" />);
    expect(screen.getByTestId('nav-register').getAttribute('href')).toBe('/register?lang=en');
    expect(screen.getByTestId('nav-login').getAttribute('href')).toBe('/login?lang=en');
    expect(screen.queryByTestId('sticky-cta')).toBeNull();
    expect(screen.getByText('Instrument')).toBeInTheDocument();
    expect(await screen.findAllByTestId('quote-row')).toHaveLength(10);
  });

  it('分类标签：选"加密货币"只剩比特币和以太坊', async () => {
    render(<App initialLang="zh-CN" />);
    await screen.findByTestId('sample-tag');
    fireEvent.click(screen.getByRole('tab', { name: '加密货币' }));
    expect(screen.getAllByTestId('quote-row').map((r) => r.getAttribute('data-symbol'))).toEqual(['BTCUSD', 'ETHUSD']);
  });
});

describe('法律页（AC2-08）', () => {
  it.each([
    ['/terms', '服务条款'],
    ['/privacy', '隐私政策'],
    ['/risk', '风险披露'],
  ])('%s 能打开，顶部标"需法务审核"，风险提示条和页脚照常显示', (path, title) => {
    window.history.replaceState(null, '', path);
    render(<App initialLang="zh-CN" />);
    expect(screen.getByTestId('legal-review')).toHaveTextContent('需法务审核');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title);
    expect(screen.getByTestId('risk-bar')).toBeInTheDocument();
    expect(screen.getByTestId('footer-risk')).toHaveTextContent('风险提示');
  });

  it('页脚链接在页面内切换，不重新加载', () => {
    render(<App initialLang="en" />);
    act(() => {
      fireEvent.click(within(screen.getByTestId('footer')).getByText('Privacy Policy'));
    });
    expect(window.location.pathname).toBe('/privacy');
    expect(screen.getByTestId('legal-review')).toHaveTextContent('Legal review required');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Privacy Policy');
  });
});
