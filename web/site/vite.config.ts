/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Quick Come 官网（v2）。部署在官网域名的根路径 `/`（Nginx 的 ${WWW_DOMAIN}）；原型预览站（scripts/build-prototype.sh）放在 `/site/`，
// 用 SITE_BASE=/site/ 构建。
// 构建变量：
// - VITE_API_MODE：默认 real（行情调同源 GET /api/public/quotes，测试环境标识调 /api/health）；mock = 浏览器内模拟行情（原型、单元测试）。
// - VITE_CLIENT_URL：客户端地址（注册、登录跳过去），例如 https://test-app.quickcome.online。不设时用页面里的
//   <meta name="qc-client-url">：部署时由 Nginx 换成 https://${APP_DOMAIN}（一个镜像适用于所有环境），e2e/server.mjs 换成本机客户端地址；
//   都没有时用同源相对地址（原型站：客户端就在同一个站点的 /）。见 src/config.ts。
// 本地开发：`npm run dev` 把 /api 转发到后端（FX_API_PROXY，默认 http://localhost:8080）。
// 真实接口模式的构建不打包模拟层 src/mocks/（约定 20，做法同 web/client/vite.config.ts）。
const MOCKS_DIR = /[\\/]src[\\/]mocks[\\/]/;
const mockFree = (mode: string) => {
  const isMock = loadEnv(mode, process.cwd(), 'VITE_').VITE_API_MODE === 'mock';
  return { moduleSideEffects: (id: string) => isMock || !MOCKS_DIR.test(id) };
};

export default defineConfig(({ mode }) => ({
  base: process.env.SITE_BASE || '/',
  server: {
    port: 5175,
    proxy: {
      '/api': { target: process.env.FX_API_PROXY || 'http://localhost:8080' },
    },
  },
  plugins: [react()],
  build: { outDir: 'dist', rollupOptions: { treeshake: mockFree(mode) } },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    css: false,
    env: { VITE_API_MODE: 'mock' },
  },
}));
