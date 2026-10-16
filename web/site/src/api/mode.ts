/**
 * 接口模式（构建变量 VITE_API_MODE，和 web/client 同一个约定）：
 * - `real`（默认）：行情调同源 `GET /api/public/quotes`（不需要登录），测试环境标识调 `GET /api/health`；
 * - `mock`：浏览器内模拟行情（`src/mocks/`），原型预览站（Vercel）和单元测试用。
 * 构建时被替换成常量，real 构建不含模拟层（约定 20，CI 用 scripts/check-no-mocks.mjs 检查）。
 */
export const IS_MOCK = import.meta.env.VITE_API_MODE === 'mock';
