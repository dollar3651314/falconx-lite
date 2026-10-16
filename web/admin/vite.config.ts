/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 后台部署在 /admin/ 子路径下（与客户端合并为同一个静态站点）
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
  preview: { port: 4174 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // 页面测试跑原型（mock）模式；真实接口层由 src/api/*.test.ts 直接测（fetch 替身）
    env: { VITE_API_MODE: 'mock' },
    css: false,
    testTimeout: 20000,
  },
});
