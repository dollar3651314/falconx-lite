/**
 * 官网（v2 需求 4.1–4.6、第 7 节验收标准）：两种运行形态都跑（默认经 server.mjs 的 4174 端口；部署形态经 Nginx 的官网假域名）。
 * 后端是 e2e profile，报价来自模拟报价源（每 500 毫秒一次），加密货币全天开市，所以任何时间跑都有在跳的价格。
 * 检查：8 个区块（AC2-01）、行情变动和闪色（AC2-02）、行情接口只有允许的字段（AC2-03）、注册登录跳转带语言（AC2-04）、
 * 中英文和默认语言跟随浏览器（AC2-05、W6）、手机和电脑两套结构且没有横向滚动（AC2-06）、没有 Google 请求（AC2-07）、法律页（AC2-08）、
 * 测试环境标识（AC2-10 的页面部分）。
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, Recorder, step } from './support';
import { CLIENT_URL, EXPECT_ENV_BANNER, SITE_URL } from './targets';

const CJK = /[一-鿿]/;
/** 公开行情允许的字段（AC2-03） */
const TOP_KEYS = ['items', 'sample'];
const ITEM_KEYS = ['bid', 'changePct', 'nameEn', 'nameZh', 'status', 'symbol', 'time'];

async function open(browser: Browser, width: number, locale: string, path = '/'): Promise<{ page: Page; rec: Recorder; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width, height: width < 1024 ? 844 : 900 }, locale, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const rec = new Recorder(page);
  await page.goto(`${SITE_URL}${path}`);
  return { page, rec, close: () => ctx.close() };
}

/** 页面上某个品种当前显示的卖价文字 */
const bidOf = (page: Page, symbol: string) => page.locator(`[data-testid="quote-row"][data-symbol="${symbol}"] [data-testid="bid"]`).textContent();

test('官网：区块、行情跳动、字段、跳转、中英文、三种宽度、法律页', async ({ browser }) => {
  // ---------- 手机 390，浏览器语言中文 ----------
  const m = await open(browser, 390, 'zh-CN');
  const page = m.page;

  await step('手机：默认中文（跟随浏览器），8 个区块都在，手机结构', async () => {
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('.site')).toHaveAttribute('data-layout', 'mobile');
    for (const id of ['risk-bar', 'logo', 'hero', 'quote-board', 'sec-platform', 'sec-products', 'sec-steps', 'sec-safety', 'sec-faq', 'footer', 'sticky-cta']) {
      await expect(page.getByTestId(id).first(), `区块 ${id}`).toBeVisible();
    }
    // 手机上导航收进菜单，注册按钮始终可见（底部固定）
    await expect(page.getByTestId('menu-btn')).toBeVisible();
    await expect(page.getByTestId('nav-register')).toHaveCount(0);
    await page.mouse.wheel(0, 2000);
    await expect(page.getByTestId('sticky-register')).toBeInViewport();
    await expect(page.getByTestId('contact')).toContainText('info@quickcome.online');
    await expect(page.getByTestId('footer')).toContainText('© Quick Come');
    if (EXPECT_ENV_BANNER) await expect(page.getByTestId('env-banner')).toBeVisible();
    await expectNoHorizontalScroll(page, '官网首页 390');
  });

  await step('行情：10 个品种；加密货币 10 秒内价格变动并闪绿或红；没有价格的品种显示休市或暂无报价', async () => {
    const rows = page.getByTestId('quote-row');
    await expect(rows).toHaveCount(10);
    await expect(page.locator('[data-testid="quote-row"][data-symbol="BTCUSD"]')).toHaveAttribute('data-status', 'OPEN', { timeout: 15_000 });
    await expect(page.getByTestId('sample-tag'), '测试环境是模拟报价源：标"示例行情"').toBeVisible();
    const before = { BTCUSD: await bidOf(page, 'BTCUSD'), ETHUSD: await bidOf(page, 'ETHUSD') };
    expect(before.BTCUSD).toMatch(/^\d{1,3}(,\d{3})*\.\d$/);
    await expect
      .poll(async () => (await bidOf(page, 'BTCUSD')) !== before.BTCUSD || (await bidOf(page, 'ETHUSD')) !== before.ETHUSD, { timeout: 10_000, message: '10 秒内价格没有变化' })
      .toBe(true);
    // 闪色层：涨用客户端的 --long-soft（绿），跌用 --short-soft（红）
    const flash = page.getByTestId('flash').first();
    await expect(flash).toBeAttached({ timeout: 10_000 });
    const f = await flash.evaluate((el) => ({ cls: el.className, anim: getComputedStyle(el).animationName, up: getComputedStyle(el).getPropertyValue('--long-soft').trim(), down: getComputedStyle(el).getPropertyValue('--short-soft').trim() }));
    expect(f.cls).toMatch(/flash-(up|down)/);
    expect(f.anim).toMatch(/^flash-(up|down)$/);
    expect(f.up, '涨：客户端深色主题的 --long-soft').toMatch(/^rgba\(34, 197, 94, 0?\.14\)$/);
    expect(f.down, '跌：客户端深色主题的 --short-soft').toMatch(/^rgba\(244, 63, 94, 0?\.14\)$/);
    // 非 OPEN 的品种不显示任何价格
    for (const r of await rows.all()) {
      const st = await r.getAttribute('data-status');
      if (st !== 'OPEN') await expect(r.getByTestId('bid-off'), `${await r.getAttribute('data-symbol')} ${st}`).toHaveText(st === 'CLOSED' ? '休市' : /暂无报价|—/);
    }
  });

  await step('AC2-03 行情接口只有品种、名称、卖价、涨跌幅、时间、状态；AC2-07 没有 Google 和其他外部请求', async () => {
    await m.rec.settle();
    const bodies = m.rec.apiBodies.filter((b) => new URL(b.url).pathname === '/api/public/quotes');
    expect(bodies.length, '至少记录到一次行情接口的返回').toBeGreaterThan(0);
    for (const b of bodies) {
      const j = JSON.parse(b.body);
      expect(Object.keys(j).sort()).toEqual(TOP_KEYS);
      for (const it of j.items) expect(Object.keys(it).sort()).toEqual(ITEM_KEYS);
    }
    const paths = new Set(m.rec.apiBodies.map((b) => new URL(b.url).pathname));
    expect([...paths].filter((p) => p !== '/api/public/quotes' && p !== '/api/health'), '官网只调这两个接口').toEqual([]);
    expect(m.rec.wsFrames, '官网不用 WebSocket').toEqual([]);
    expect(m.rec.riskLeaks()).toEqual([]);
    expect(m.rec.googleHosts()).toEqual([]);
    expect([...m.rec.hosts], '只访问官网自己的域名').toEqual([new URL(SITE_URL).hostname]);
  });

  await step('法律页：三个都能打开，标"需法务审核"，风险提示条和页脚风险提示都在', async () => {
    for (const [p, title] of [['/terms', '服务条款'], ['/privacy', '隐私政策'], ['/risk', '风险披露']]) {
      await page.goto(`${SITE_URL}${p}`);
      await expect(page.getByTestId('legal-review')).toContainText('需法务审核');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
      await expect(page.getByTestId('risk-bar')).toBeVisible();
      await expect(page.getByTestId('footer-risk')).toContainText('风险提示');
      await expectNoHorizontalScroll(page, `官网 ${p} 390`);
    }
  });

  await step('AC2-04 手机：首屏"免费注册"跳到客户端注册页，语言是中文', async () => {
    await page.goto(`${SITE_URL}/`);
    await page.getByTestId('hero-register').click();
    await expect(page).toHaveURL(`${CLIENT_URL}/register?lang=zh-CN`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  });
  await m.close();

  // ---------- 电脑 1280 / 1440，浏览器语言英文 ----------
  for (const width of [1280, 1440]) {
    const d = await open(browser, width, 'en-US');
    await step(`电脑 ${width}：默认英文（浏览器不是中文），电脑结构，没有中文残留，没有横向滚动`, async () => {
      await expect(d.page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(d.page.locator('.site')).toHaveAttribute('data-layout', 'desktop');
      await expect(d.page.getByTestId('nav-register')).toBeVisible();
      await expect(d.page.getByTestId('sticky-cta')).toHaveCount(0);
      await expect(d.page.locator('[data-testid="quote-row"][data-symbol="ETHUSD"]')).toHaveAttribute('data-status', 'OPEN', { timeout: 15_000 });
      const text = (await d.page.locator('body').innerText()).replace(/中/g, '');
      expect(text.match(CJK), '英文页面的中文残留（语言切换的"中"除外）').toBeNull();
      await expectNoHorizontalScroll(d.page, `官网首页 ${width}`);
    });
    if (width === 1440) {
      await step('切换中文后显示中文，刷新后仍是中文（记住选择）', async () => {
        await d.page.getByTestId('lang-switch').getByText('中').click();
        await expect(d.page.locator('html')).toHaveAttribute('lang', 'zh-CN');
        await expect(d.page.getByTestId('hero')).toContainText('交易全球行情');
        await d.page.reload();
        await expect(d.page.locator('html')).toHaveAttribute('lang', 'zh-CN');
        await d.page.getByTestId('lang-switch').getByText('EN').click();
      });
      await step('AC2-04 电脑：品种行和顶部"注册"跳到客户端注册页，"登录"跳到登录页，语言是英文', async () => {
        await expect(d.page.locator('[data-testid="quote-row"]').first()).toHaveAttribute('href', `${CLIENT_URL}/register?lang=en`);
        await expect(d.page.getByTestId('nav-login')).toHaveAttribute('href', `${CLIENT_URL}/login?lang=en`);
        await d.page.locator('[data-testid="quote-row"][data-symbol="XAUUSD"]').click();
        await expect(d.page).toHaveURL(`${CLIENT_URL}/register?lang=en`);
        await expect(d.page.locator('html')).toHaveAttribute('lang', 'en');
      });
    }
    await d.close();
  }
});
