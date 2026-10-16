/**
 * 端到端测试配置（S19，测试报告/v1-端到端测试方案.md）。
 * 后端要先以 e2e profile 启动（e2e/start-backend.sh）；本配置只负责启动静态站点和 /api 转发（server.mjs）。
 * 用例串行执行（同一个后端、同一个模拟行情），每一步都有自己的超时，失败时报出卡在哪一步，保留 trace、截图和录像。
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4173);

export default defineConfig({
  testDir: './tests',
  // 整个主流程（注册到提现完成）一个用例，给足时间；每一步另有超时（tests/support.ts 的 step）
  timeout: 8 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    // 客户端是 PWA：不让 Service Worker 缓存页面和接口，每次都拿到最新构建、请求都能被记录
    serviceWorkers: 'block',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node server.mjs',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { E2E_PORT: String(PORT) },
  },
});
