/**
 * 只在部署形态（E2E_MODE=deployed，e2e/run-deployed.sh）运行：在真浏览器里确认 Nginx 镜像的路由、跳转、安全响应头和 Service Worker
 * （测试报告/v1-端到端测试方案.md 第 9 节）。主流程（登录 Cookie 的 Secure、WebSocket 推送、测试环境标识条）在 main-flow.spec.ts 里。
 * 请求都从浏览器页面里发（同源 fetch），走的是浏览器的域名解析和 HTTPS，和真实用户一样。
 */
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_URL, CLIENT_URL, DEPLOYED } from './targets';

test.skip(!DEPLOYED, '只在部署形态运行（e2e/run-deployed.sh）');

/** 在页面里同源请求，返回状态码和内容类型（不跟随跳转） */
async function status(page: Page, path: string): Promise<{ status: number; type: string; location: string }> {
  return page.evaluate(async (p) => {
    const r = await fetch(p, { redirect: 'manual', cache: 'no-store' });
    return { status: r.type === 'opaqueredirect' ? 302 : r.status, type: r.headers.get('content-type') || '', location: r.headers.get('location') || '' };
  }, path);
}

test('Nginx：两个域名的路由、跳转和安全响应头', async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  try {
    // http → https（80 只做跳转）
    await page.goto(CLIENT_URL.replace(/^https:/, 'http:') + '/');
    expect(page.url(), 'http 跳到 https').toBe(`${CLIENT_URL}/`);

    // 客户端域名
    const res = await page.goto(`${CLIENT_URL}/`);
    const h = res!.headers();
    expect(h['strict-transport-security'], 'HSTS').toContain('max-age=');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    const health = await page.evaluate(async () => (await fetch('/api/health', { cache: 'no-store' })).json());
    expect(health.status).toBe('UP');
    expect(health.env, '健康检查带测试环境标识').toBe('test');
    for (const p of ['/api/e2e/mail/code?email=x%40example.com', '/api/admin/me', '/actuator/health']) {
      expect((await status(page, p)).status, `客户端域名 ${p} 应为 404（Nginx 不转发）`).toBe(404);
    }
    expect((await status(page, '/api/me/session')).status, '客户端接口经 Nginx 到后端（未登录 401）').toBe(401);
    // 浏览器路由：直接打开或刷新任意页面路径都回到客户端的 index.html。
    // 资产页路由 /assets* 和构建目录 assets/ 同名（曾经是 403 / 404，见方案第 9 节 D-1）
    for (const p of ['/trade/ETHUSD', '/assets', '/assets/', '/assets/ledger', '/assets/withdraw', '/assets/whitelist', '/me/kyc']) {
      const r = await status(page, p);
      expect(r.status, `直接打开 ${p}`).toBe(200);
      expect(r.type, `直接打开 ${p} 是页面`).toContain('text/html');
    }
    // 构建出来的脚本：长期缓存；不存在的脚本是 404，不能拿页面冒充
    const js = await page.evaluate(() => (document.querySelector('script[type="module"][src]') as HTMLScriptElement | null)?.getAttribute('src') || '');
    expect(js).toMatch(/^\/assets\/.+\.js$/);
    const jsRes = await page.evaluate(async (u) => {
      const r = await fetch(u, { cache: 'no-store' });
      return { status: r.status, type: r.headers.get('content-type') || '', cache: r.headers.get('cache-control') || '' };
    }, js);
    expect(jsRes.status).toBe(200);
    expect(jsRes.type).toContain('javascript');
    expect(jsRes.cache).toContain('max-age=2592000');
    expect((await status(page, '/assets/not-exist-0000.js')).status, '不存在的脚本').toBe(404);
    expect((await status(page, '/')).type).toContain('text/html');

    // 后台域名
    await page.goto(`${ADMIN_URL}/`);
    expect(page.url(), '后台域名 / 跳到 /admin/').toMatch(/\/admin\/(login)?$/);
    expect((await status(page, '/api/health')).status).toBe(200);
    expect((await status(page, '/api/admin/me')).status, '后台接口经 Nginx 到后端（未登录 401）').toBe(401);
    for (const p of ['/api/me/session', '/api/e2e/mail/code?email=x%40example.com', '/actuator/health']) {
      expect((await status(page, p)).status, `后台域名 ${p} 应为 404`).toBe(404);
    }
  } finally {
    await ctx.close();
  }
});

test('Service Worker：经 HTTPS 注册、接管页面，不接管 /api 和 /admin', async ({ browser }) => {
  // 这里允许 Service Worker（主流程为了记录请求把它关掉了）
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  try {
    await page.goto(`${CLIENT_URL}/`);
    const script = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return reg.active?.scriptURL || '';
    });
    expect(script, 'Service Worker 已激活').toBe(`${CLIENT_URL}/sw.js`);
    // 重新打开页面后由 Service Worker 接管
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { message: '页面由 Service Worker 接管' }).toBe(true);
    // Service Worker 用 importScripts 加载推送处理脚本（push-sw.js）：要能取到、类型是 JavaScript，否则注册会失败
    const push = await status(page, '/push-sw.js');
    expect(push.status).toBe(200);
    expect(push.type).toContain('javascript');
    // 被接管后：/api/ 的页面导航不能被换成客户端的 index.html（navigateFallbackDenylist）
    const api = await page.goto(`${CLIENT_URL}/api/health`);
    expect(api!.headers()['content-type'], '/api/health 仍由后端返回 JSON').toContain('application/json');
    await page.goto(`${CLIENT_URL}/`);
    // 页面能正常显示（Service Worker 的缓存页面和最新构建一致）
    await expect(page.getByTestId('env-banner')).toBeVisible();
  } finally {
    await ctx.close();
  }
});
