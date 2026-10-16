/**
 * v2 后台（需求说明书 v2.1 第 11.1 节）：E1 编辑客户资料、E2 深色主题、E3 新增品种、E6 最后报价时间 / 最近登录 IP、E7 自动刷新。
 * 页面跑原型（mock）模式；真实接口的路径和请求体用 fetch 替身检查。
 */
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { ApiError } from './api/types';
import { createSymbol, getCustomer, listAuditLogs, listSymbols, switchIdentity, updateCustomerProfile, updateSymbol } from './api';
import * as real from './api/real';
import { fakeFetch } from './test/fakeFetch';
import { renderAs } from './test/render';
import { birthDateProblems, nameProblems, nationalityProblems, SYMBOL_CODE_RE } from './utils/validators';
import { quoteFreshness } from './utils/display';
import { readThemePref, resolveTheme, THEME_KEY, ThemeModeProvider, useThemeMode, writeThemePref } from './hooks/useThemeMode';
import type { AutoRefresh } from './hooks/useAutoRefresh';
import { ThemeSwitch } from './components/ThemeSwitch';
import { CustomerDetailPage } from './pages/customers/CustomerDetailPage';
import { SymbolsPage } from './pages/market/SymbolsPage';
import { RiskPage } from './pages/risk/RiskPage';
import type { SymbolCreateInput } from './api/types';

const TODAY = new Date(Date.UTC(2026, 9, 14));

// 页面测试里不真的定时刷新（品种表很大，定时重绘会拖慢同时运行的其他测试文件）；钩子本身用真实实现单独测
const actualAuto = await vi.importActual<typeof import('./hooks/useAutoRefresh')>('./hooks/useAutoRefresh');
const useAutoRefresh = actualAuto.useAutoRefresh;
vi.mock('./hooks/useAutoRefresh', async () => {
  const React = await import('react');
  return {
    useAutoRefresh: (_refresh: () => void, intervalMs = 5000): AutoRefresh => {
      const [paused, setPaused] = React.useState(false);
      return { paused, setPaused, visible: true, active: !paused, intervalMs };
    },
  };
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  try {
    localStorage.removeItem(THEME_KEY);
  } catch {
    /* 忽略 */
  }
  document.documentElement.removeAttribute('data-theme');
  await switchIdentity('super');
});

// ---------------- E1 编辑客户资料 ----------------
describe('E1 编辑客户资料：校验和客户端注册一致', () => {
  it('姓名：必填、最多 50 字、只允许文字、空格、点、撇号、连字符', () => {
    expect(nameProblems('', true)).toEqual(['validation.required']);
    expect(nameProblems('', false)).toEqual([]);
    expect(nameProblems("O'Brien-Smith Jr.", true)).toEqual([]);
    expect(nameProblems('王小明', true)).toEqual([]);
    expect(nameProblems('a'.repeat(51), true)).toEqual(['validation.nameTooLong']);
    expect(nameProblems('W4ng', true)).toEqual(['validation.nameChars']);
  });

  it('出生日期：格式、真实日期、1900 年以后、年满 18 周岁', () => {
    expect(birthDateProblems('', TODAY)).toEqual(['validation.required']);
    expect(birthDateProblems('1990-1-', TODAY)).toEqual(['validation.dateIncomplete']);
    expect(birthDateProblems('199-01-02', TODAY)).toEqual(['validation.yearFormat']);
    expect(birthDateProblems('1990-02-30', TODAY)).toEqual(['validation.dateInvalid']);
    expect(birthDateProblems('1899-12-31', TODAY)).toEqual(['validation.dateInvalid']);
    expect(birthDateProblems('2027-01-01', TODAY)).toEqual(['validation.dateInvalid']);
    expect(birthDateProblems('2008-10-15', TODAY)).toEqual(['validation.ageUnder18']);
    expect(birthDateProblems('2008-10-14', TODAY)).toEqual([]);
  });

  it('国籍：两位大写字母', () => {
    expect(nationalityProblems('CN')).toEqual([]);
    expect(nationalityProblems('cn')).toEqual(['validation.nationalityFormat']);
    expect(nationalityProblems('')).toEqual(['validation.required']);
  });

  it('模拟层：没有 customer:edit 被拒；原因必填；字段错误一次返回；成功写审计（修改前后），KYC 已通过时标出', async () => {
    await switchIdentity('risk'); // 风控身份没有 customer:edit
    const input = { firstName: '小明', middleName: '', lastName: '王', birthDate: '1990-05-12', nationality: 'HK' };
    await expect(updateCustomerProfile(100482, input, '客户来电')).rejects.toMatchObject({ reasonKey: 'errors.forbidden' });
    await switchIdentity('super');
    await expect(updateCustomerProfile(100482, input, ' ')).rejects.toMatchObject({ reasonKey: 'errors.reasonRequired' });
    const bad = await updateCustomerProfile(100482, { firstName: '', middleName: 'x1', lastName: '王', birthDate: '2015-01-01', nationality: 'hk' }, '测试').catch(
      (e: unknown) => e,
    );
    expect(bad).toBeInstanceOf(ApiError);
    expect((bad as ApiError).fields).toEqual([
      { field: 'firstName', code: 'required' },
      { field: 'middleName', code: 'nameChars' },
      { field: 'birthDate', code: 'ageUnder18' },
      { field: 'nationality', code: 'nationalityInvalid' },
    ]);

    const d = await updateCustomerProfile(100482, input, '客户提供了新证件');
    expect(d.firstName).toBe('小明');
    expect(d.nationality).toBe('HK');
    expect(d.email).toBe((await getCustomer(100482)).email);
    const log = (await listAuditLogs({ page: 1, pageSize: 5, action: 'customer.edit' })).items[0];
    expect(log.highRisk).toBe(true);
    expect(log.reason).toBe('客户提供了新证件');
    expect(log.after).toMatchObject({ firstName: '小明', nationality: 'HK', kycApproved: true });
    expect(log.after?.kycMismatch).toBeTruthy();
  });

  it('真实接口：PUT /customers/{id}/profile，带原因', async () => {
    const { calls } = fakeFetch({ 'PUT /api/admin/customers/7/profile': { body: { id: 7 } } });
    await real.updateCustomerProfile(7, { firstName: 'Lin', middleName: '', lastName: 'Wang', birthDate: '1990-01-02', nationality: 'SG' }, '更正');
    expect(calls[0].body).toEqual({ firstName: 'Lin', middleName: '', lastName: 'Wang', birthDate: '1990-01-02', nationality: 'SG', reason: '更正' });
  });

  it('客户详情：有"编辑资料"按钮和最近登录 IP；KYC 已通过时弹窗提示和证件不一致；邮箱只读', async () => {
    renderAs(
      <Routes>
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
      </Routes>,
      { path: '/customers/100482' },
    );
    expect(await screen.findByText('最近登录 IP')).toBeInTheDocument();
    expect(screen.getByText(/^203\.0\.113\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /编辑资料/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/该客户 KYC 已通过，修改姓名或出生日期会和证件不一致/)).toBeInTheDocument();
    expect(within(dialog).getByText('邮箱不能修改')).toBeInTheDocument();
    // 没填原因、名字不合法：一次显示
    // 出生日期是三框组件：原值 1990-05-12 拆到三个框；整串写进年份框（自动填充、粘贴）也能拆开
    const birth = within(dialog).getByRole('group', { name: '出生日期' });
    expect(within(birth).getByLabelText('月')).toHaveValue('05');
    fireEvent.change(within(birth).getByLabelText(/年/), { target: { value: '2015-01-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认修改' }));
    expect(await within(dialog).findByText('客户须年满 18 周岁', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(within(dialog).getByText('请填写操作原因')).toBeInTheDocument();
  });

  it('运营身份没有 customer:edit：编辑按钮置灰', async () => {
    renderAs(
      <Routes>
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
      </Routes>,
      { path: '/customers/100489', adminId: 2 },
    );
    expect(await screen.findByRole('button', { name: /编辑资料/ })).toBeDisabled();
  });
});

// ---------------- E3 新增品种 ----------------
const newSymbol = (code: string): SymbolCreateInput => ({
  code,
  nameZh: '测试币',
  nameEn: 'Test Coin',
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
});

describe('E3 新增品种', () => {
  it('代码格式', () => {
    expect(SYMBOL_CODE_RE.test('EURUSD')).toBe(true);
    expect(SYMBOL_CODE_RE.test('US30')).toBe(true);
    expect(SYMBOL_CODE_RE.test('eurusd')).toBe(false);
    expect(SYMBOL_CODE_RE.test('1ABC')).toBe(false);
    expect(SYMBOL_CODE_RE.test('A')).toBe(false);
  });

  it('模拟层：权限、原因、字段错误、重复代码；新增后默认暂停开仓、暂无报价、写高危审计；编辑里打开', async () => {
    await switchIdentity('risk'); // 风控身份没有 symbol:create
    await expect(createSymbol(newSymbol('ZTEST1'), '上新')).rejects.toMatchObject({ reasonKey: 'errors.forbidden' });
    await switchIdentity('super');
    await expect(createSymbol(newSymbol('ZTEST1'), '')).rejects.toMatchObject({ reasonKey: 'errors.reasonRequired' });
    const bad = await createSymbol({ ...newSymbol('z-1'), quoteCurrency: 'ZZZ', minLots: '5', maxLots: '1', sessionTemplate: undefined }, '测试').catch((e: unknown) => e);
    expect((bad as ApiError).fields).toEqual(
      expect.arrayContaining([
        { field: 'code', code: 'invalid' },
        { field: 'quoteCurrency', code: 'noFxRate' },
        { field: 'maxLots', code: 'lessThanMin' },
        { field: 'sessions', code: 'required' },
      ]),
    );
    await expect(createSymbol(newSymbol('EURUSD'), '重复')).rejects.toMatchObject({ reasonKey: 'errors.symbolExists' });

    const s = await createSymbol(newSymbol('ZTEST1'), '上新测试币');
    expect(s.openPaused).toBe(true);
    expect(s.lastQuoteAt).toBeNull();
    expect(quoteFreshness(s)).toBe('none');
    const listed = await listSymbols({ page: 1, pageSize: 10, keyword: 'ZTEST1' });
    expect(listed.items.map((x) => x.code)).toEqual(['ZTEST1']);
    const log = (await listAuditLogs({ page: 1, pageSize: 5, action: 'symbol.create' })).items[0];
    expect(log).toMatchObject({ target: 'ZTEST1', highRisk: true, reason: '上新测试币' });
    expect(log.after).toMatchObject({ openPaused: true, sessions: 'template:crypto' });

    await updateSymbol('ZTEST1', { openPaused: false }, '报价正常');
    expect((await listSymbols({ page: 1, pageSize: 10, keyword: 'ZTEST1' })).items[0].openPaused).toBe(false);
  });

  it('真实接口：POST /symbols，带原因；隔夜费率 0 转成未配置', async () => {
    const { calls } = fakeFetch({
      'POST /api/admin/symbols': { body: { ...newSymbol('ZT2'), swapLong: '0', swapShort: '0', enabled: true, openPaused: true, lastQuoteAt: null, tradingOpen: true } },
    });
    const s = await real.createSymbol(newSymbol('ZT2'), '上新');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toMatchObject({ code: 'ZT2', sessionTemplate: 'crypto', reason: '上新' });
    expect(s.swapLong).toBeNull();
    expect(s.openPaused).toBe(true);
  });

  it('品种页：新增按钮（有 symbol:create 才能点）、最后报价列、自动刷新开关', async () => {
    renderAs(<SymbolsPage />);
    expect(await screen.findByText('最后报价')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新增品种/ })).toBeEnabled();
    expect(screen.getByText('每 5 秒自动刷新')).toBeInTheDocument();
    // 新增抽屉的表单在 jsdom 里渲染很慢（约 15 秒），这里不打开；抽屉的样子见浏览器截图，提交逻辑见上面模拟层的用例
  }, 60_000);

  it('风控身份：新增品种按钮置灰', async () => {
    renderAs(<SymbolsPage />, { adminId: 3 });
    expect(await screen.findByRole('button', { name: /新增品种/ })).toBeDisabled();
  }, 60_000);
});

// ---------------- E6 最后报价时间 ----------------
describe('E6 最后报价时间', () => {
  const now = Date.parse('2026-10-14T10:00:00Z');
  it('开市超过 1 分钟没报价标红；休市不标红；从没报价是 none；停用不看', () => {
    expect(quoteFreshness({ enabled: true, tradingOpen: true, lastQuoteAt: '2026-10-14T09:59:30Z' }, now)).toBe('fresh');
    expect(quoteFreshness({ enabled: true, tradingOpen: true, lastQuoteAt: '2026-10-14T09:58:59Z' }, now)).toBe('stale');
    expect(quoteFreshness({ enabled: true, tradingOpen: false, lastQuoteAt: '2026-10-13T20:00:00Z' }, now)).toBe('closed');
    expect(quoteFreshness({ enabled: true, tradingOpen: true, lastQuoteAt: null }, now)).toBe('none');
    expect(quoteFreshness({ enabled: false, tradingOpen: true, lastQuoteAt: null }, now)).toBe('disabled');
  });

  it('模拟数据里 HK50 演示超过 1 分钟没报价', async () => {
    const hk = (await listSymbols({ page: 1, pageSize: 10, keyword: 'HK50' })).items[0];
    expect(quoteFreshness(hk)).toBe('stale');
  });
});

// ---------------- E2 深色主题 ----------------
describe('E2 深色主题', () => {
  it('默认跟随系统；选择记在本机；读写存储出错时按跟随系统处理', () => {
    expect(readThemePref()).toBe('system');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    writeThemePref('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(readThemePref()).toBe('dark');
    writeThemePref('system');
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    vi.stubGlobal('localStorage', broken);
    expect(readThemePref()).toBe('system');
    expect(() => writeThemePref('dark')).not.toThrow();
  });

  it('系统是深色时默认深色；右上角切到浅色后根元素跟着变，刷新后保持', async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ ...mm(q), matches: q.includes('prefers-color-scheme: dark') ? true : mm(q).matches })) as typeof window.matchMedia;
    try {
      const Probe = () => <span data-testid="theme">{useThemeMode().theme}</span>;
      const { unmount } = render(
        <ThemeModeProvider>
          <Probe />
          <ThemeSwitch />
        </ThemeModeProvider>,
      );
      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
      expect(document.documentElement.dataset.theme).toBe('dark');
      fireEvent.click(screen.getByRole('button', { name: /主题|Theme/ }));
      fireEvent.click(await screen.findByText('浅色'));
      await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
      expect(localStorage.getItem(THEME_KEY)).toBe('light');
      unmount();
      // "刷新"：重新挂载，按保存的选择
      render(
        <ThemeModeProvider>
          <Probe />
        </ThemeModeProvider>,
      );
      expect(screen.getAllByTestId('theme').at(-1)).toHaveTextContent('light');
    } finally {
      window.matchMedia = mm;
    }
  });

  it('整个后台（含 antd 弹窗）在深色下渲染：根元素 data-theme=dark', async () => {
    localStorage.setItem(THEME_KEY, 'dark');
    renderAs(<RiskPage />);
    expect(await screen.findByText('BTCUSD')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

// ---------------- E7 自动刷新 ----------------
describe('E7 自动刷新', () => {
  it('每 5 秒刷新；暂停后不刷新；页面不可见时停止，回来立即刷新一次', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    let hidden = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    const { result } = renderHook(() => useAutoRefresh(fn, 5000));
    act(() => void vi.advanceTimersByTime(15_000));
    expect(fn).toHaveBeenCalledTimes(3);
    act(() => result.current.setPaused(true));
    act(() => void vi.advanceTimersByTime(15_000));
    expect(fn).toHaveBeenCalledTimes(3);
    act(() => result.current.setPaused(false));
    hidden = true;
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current.active).toBe(false);
    act(() => void vi.advanceTimersByTime(20_000));
    expect(fn).toHaveBeenCalledTimes(3);
    hidden = false;
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(fn).toHaveBeenCalledTimes(4);
    act(() => void vi.advanceTimersByTime(5000));
    expect(fn).toHaveBeenCalledTimes(5);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });

  it('风控看板有自动刷新开关，可以暂停', async () => {
    renderAs(<RiskPage />);
    await screen.findByText('BTCUSD');
    expect(screen.getByText('每 5 秒自动刷新')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /暂停/, pressed: false }));
    expect(await screen.findByText('自动刷新已暂停')).toBeInTheDocument();
  });
});
