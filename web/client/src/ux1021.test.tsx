/**
 * 体验优化 1021（Amos 2026-10-21 的 11 条建议，方案 技术方案/v2-体验优化-1021.md）的原型：
 * 语言下拉框、新手引导、电脑顶栏（去掉"我的"和跑马灯）、部分平仓。交易页左栏、确认按钮、默认浅色在 pages/layouts.test.tsx。
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { closePosition } from './api/trading';
import { AuthProvider } from './app/AuthProvider';
import { ThemeProvider } from './app/ThemeProvider';
import { ToastProvider } from './app/ToastProvider';
import { Layout } from './components/Layout';
import { LangSelect } from './components/LangSelect';
import { ClosePositionDialog } from './components/PositionDialogs';
import { PositionsTabs } from './components/PositionsTabs';
import { resetOnboarding } from './hooks/useOnboarding';
import { setLanguage } from './i18n';
import { langFromBrowser, pickLang } from './i18n/urlLang';
import { validateCloseLots } from './lib/validators';
import { db, resetDb } from './mocks/db';
import { symbolInfo } from './mocks/market';
import { protoSetKyc } from './mocks/user';
import Me from './pages/me/Me';
import { renderPage } from './test/renderApp';

vi.mock('./components/KChart', () => ({ KChart: () => null }));

function setDesktop(on: boolean) {
  window.matchMedia = ((query: string) =>
    ({ matches: on && query.includes('min-width: 1024px'), media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false }) as MediaQueryList) as typeof window.matchMedia;
}

const SESSION = { token: 't', userId: 'U10086', email: 'demo@example.com' };

function renderShell(path = '/markets') {
  localStorage.setItem('fx.session', JSON.stringify(SESSION));
  return renderPage(
    <Routes>
      <Route element={<Layout />}>
        <Route path="/markets" element={<div>行情页内容</div>} />
        <Route path="/me" element={<Me />} />
        <Route path="/me/kyc" element={<div>身份认证页内容</div>} />
        <Route path="/assets" element={<div>资产页内容</div>} />
      </Route>
    </Routes>,
    path,
  );
}

afterEach(async () => {
  setDesktop(false);
  resetOnboarding();
  resetDb();
  localStorage.clear();
  await act(() => setLanguage('zh-CN'));
});

describe('第 1 条：语言下拉框', () => {
  it('按钮显示当前语言，展开后当前语言打勾，选另一项切换', async () => {
    render(<LangSelect />);
    const btn = screen.getByRole('button', { name: '语言：简体中文' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    const list = screen.getByRole('listbox');
    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['简体中文当前', 'English']);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(options[1]).getByRole('button'));
    await waitFor(() => expect(screen.getByRole('button', { name: /English$/ })).toBeInTheDocument());
    expect(localStorage.getItem('fx.lang')).toBe('en');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('默认跟随浏览器语言：zh 开头的都用中文，其他或取不到用英文；?lang= 优先并记住；自己选过的优先于浏览器（UX-1）', () => {
    // 单元测试把浏览器语言设成了 zh-CN（test/browserLang.ts），页面是中文
    expect(document.documentElement.lang).toBe('zh-CN');
    for (const l of ['zh', 'zh-CN', 'zh-TW', 'zh-HK', 'zh-Hans-CN', 'ZH-cn']) expect(langFromBrowser([l, 'en'])).toBe('zh-CN');
    for (const l of ['en-US', 'en', 'ja-JP', 'fr', 'zu']) expect(langFromBrowser([l, 'zh-CN'])).toBe('en');
    expect(langFromBrowser(undefined, 'zh-TW'), 'languages 取不到时看 language').toBe('zh-CN');
    expect(langFromBrowser([], undefined), '都取不到用英文').toBe('en');
    expect(langFromBrowser([''], ''), '空字符串也算取不到').toBe('en');
    expect(pickLang({ search: '', stored: null, languages: ['en-GB'] })).toEqual({ lang: 'en', remember: false });
    expect(pickLang({ search: '', stored: 'zh-CN', languages: ['en-GB'] }), '自己选过中文，英文浏览器也用中文').toEqual({ lang: 'zh-CN', remember: false });
    expect(pickLang({ search: '', stored: 'en', languages: ['zh-CN'] }), '自己选过英文').toEqual({ lang: 'en', remember: false });
    expect(pickLang({ search: '?lang=en', stored: 'zh-CN', languages: ['zh-CN'] }), '官网带的 ?lang= 最优先，并记住').toEqual({ lang: 'en', remember: true });
    expect(pickLang({ search: '?lang=xx', stored: null, languages: ['zh-HK'] })).toEqual({ lang: 'zh-CN', remember: false });
  });
});

describe('第 4、10 条：电脑顶栏', () => {
  it('顶栏没有"我的"和跑马灯，右上角头像进"我的"', async () => {
    setDesktop(true);
    renderShell();
    const top = (await screen.findByText('行情页内容')).closest('.app')!.querySelector('header.topnav') as HTMLElement;
    const menu = within(top).getByRole('navigation', { name: '主导航' });
    expect(within(menu).queryByRole('link', { name: '我的' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: '资产' })).toBeInTheDocument();
    expect(within(top).queryByRole('navigation', { name: '热门品种行情' })).not.toBeInTheDocument();
    expect(within(top).getByRole('link', { name: '我的' })).toHaveAttribute('href', '/me');
    // 手机底部导航照旧有"我的"（手机没有右上角头像）
    const bottom = document.querySelector('nav.bottomnav') as HTMLElement;
    expect(within(bottom).getByRole('link', { name: /我的/ })).toBeInTheDocument();
  });
});

describe('第 2 条：新手引导', () => {
  it('新客户（认证未提交）第一次进来自动打开，4 步，终点是去认证；看完不再自动打开', async () => {
    protoSetKyc('none');
    const view = renderShell();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('第 1 / 4 步')).toBeInTheDocument();
    expect(within(dialog).getByText('欢迎来到 Quick Come')).toBeInTheDocument();
    const titles = ['第一步：完成身份认证', '第二步：充值 USDT', '最后：下第一笔单'];
    for (const title of titles) {
      fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }));
      expect(within(dialog).getByText(title)).toBeInTheDocument();
    }
    expect(within(dialog).queryByRole('button', { name: '下一步' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '去完成认证' }));
    expect(await screen.findByText('身份认证页内容')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('fx.onboarding.v1:U10086')).toBe('done');
    view.unmount();
    renderShell();
    await screen.findByText('行情页内容');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('可以跳过；已认证的老客户不自动打开，从"我的 → 新手引导"重看，终点是去充值', async () => {
    protoSetKyc('none');
    const view = renderShell();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '跳过' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.unmount();

    protoSetKyc('approved');
    renderShell('/me');
    fireEvent.click(await screen.findByRole('button', { name: '新手引导' }));
    const again = await screen.findByRole('dialog');
    for (let i = 0; i < 3; i++) fireEvent.click(within(again).getByRole('button', { name: '下一步' }));
    fireEvent.click(within(again).getByRole('button', { name: '去充值' }));
    expect(await screen.findByText('资产页内容')).toBeInTheDocument();
  });
});

describe('第 6 条：部分平仓（第二批，真实接口和模拟层同一套规则）', () => {
  const sym = { minLots: '0.01', lotStep: '0.01' };

  it('手数校验：步长、最小手数、不超过持仓、剩余不能小于最小手数', () => {
    expect(validateCloseLots('0.50', '1.00', sym)).toEqual([]);
    expect(validateCloseLots('1.00', '1.00', sym)).toEqual([]);
    expect(validateCloseLots('', '1.00', sym)).toEqual(['validation.required']);
    expect(validateCloseLots('0', '1.00', sym)).toEqual(['validation.positiveNumber']);
    expect(validateCloseLots('0.005', '1.00', sym)).toContain('validation.lotsStep');
    expect(validateCloseLots('1.01', '1.00', sym)).toEqual(['validation.closeLotsMax']);
    expect(validateCloseLots('0.10', '0.20', { minLots: '0.15', lotStep: '0.01' })).toEqual(['validation.lotsMin', 'validation.closeRemainMin']);
  });

  it('模拟层：平掉一部分，剩余持仓保证金按比例减少、开仓价和止盈止损不变，历史多一条', async () => {
    const p = db.positions.find((x) => symbolInfo(x.symbol)?.tradingOpen && Number(x.lots) >= 0.5)!;
    const before = { ...p };
    const histBefore = db.history.length;
    const r = await closePosition(p.id, '0.20');
    expect(r.closedLots).toBe('0.20');
    expect(r.remainingLots).toBe((Number(before.lots) - 0.2).toFixed(2));
    const after = db.positions.find((x) => x.id === p.id)!;
    expect(Number(after.lots)).toBeCloseTo(Number(before.lots) - 0.2, 6);
    expect(Number(after.margin)).toBeCloseTo((Number(before.margin) * (Number(before.lots) - 0.2)) / Number(before.lots), 1);
    expect(after.openPrice).toBe(before.openPrice);
    expect(after.takeProfit).toBe(before.takeProfit);
    expect(after.stopLoss).toBe(before.stopLoss);
    expect(db.history.length).toBe(histBefore + 1);
    expect(db.history[0].lots).toBe('0.20');
    // 和真实接口一样：拆出来的记录有新编号，parentId 指向原持仓
    expect(db.history[0].parentId).toBe(p.id);
    expect(db.history[0].id).not.toBe(`P${p.id}`);
    await expect(closePosition(p.id, '9999')).rejects.toMatchObject({ reason: 'validationFailed', fieldErrors: { lots: ['validation.closeLotsMax'] } });
    // 剩下的全部平掉：返回平掉和剩下的手数，整笔平仓的记录没有 parentId
    const rest = await closePosition(p.id);
    expect(rest.closedLots).toBe(after.lots);
    expect(rest.remainingLots).toBe('0.00');
    expect(db.history[0].parentId).toBeUndefined();
  });

  it('历史：部分平仓的记录标"部分平仓"，悬停看原持仓编号；整笔平仓不标', async () => {
    const p = db.positions.find((x) => symbolInfo(x.symbol)?.tradingOpen && Number(x.lots) >= 0.5)!;
    await closePosition(p.id, '0.10');
    for (const table of [false, true]) {
      const { unmount } = renderPage(<PositionsTabs table={table} />, '/positions');
      fireEvent.click(screen.getByRole('tab', { name: '历史' }));
      const tags = await screen.findAllByText('部分平仓');
      expect(tags).toHaveLength(1);
      expect(tags[0]).toHaveAttribute('title', `来自持仓 ${p.id}`);
      unmount();
    }
  });

  it('平仓弹窗：快捷 50%，显示剩余手数，确认后提示已平仓', async () => {
    const p = db.positions.find((x) => symbolInfo(x.symbol)?.tradingOpen && Number(x.lots) >= 0.5)!;
    const lots = p.lots;
    const onClose = vi.fn();
    render(
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <MemoryRouter>
              <ClosePositionDialog position={{ ...p }} symbol={symbolInfo(p.symbol)!} onClose={onClose} />
            </MemoryRouter>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('平仓手数')).toHaveValue(p.lots);
    // 默认填的是全部手数：确认按钮是"全部平仓"（快捷比例里也有一个"全部平仓"）
    expect(within(dialog).getAllByRole('button', { name: '全部平仓' })).toHaveLength(2);
    fireEvent.click(within(within(dialog).getByRole('group', { name: '快捷比例' })).getByRole('button', { name: '50%' }));
    const half = (Number(p.lots) / 2).toFixed(2);
    expect(within(dialog).getByLabelText('平仓手数')).toHaveValue(half);
    fireEvent.click(within(dialog).getByRole('button', { name: `平仓 ${half} 手` }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(Number(db.positions.find((x) => x.id === p.id)!.lots)).toBeCloseTo(Number(lots) - Number(half), 6);
  });
});
