/**
 * 取一次官网行情。real：同源 GET /api/public/quotes（不带 Cookie，不需要登录）；mock：浏览器内模拟行情。
 * 失败（网络错误、超时、非 200、返回格式不对）一律抛错，由 useQuotes 决定什么时候把行情显示成"暂无报价"。
 */
import { IS_MOCK } from './mode';
import type { PublicQuotes } from './types';
import { mockPublicQuotes } from '../mocks/quotes';

const TIMEOUT_MS = 5_000;

export function parsePublicQuotes(body: unknown): PublicQuotes {
  const b = body as Partial<PublicQuotes> | null;
  if (!b || !Array.isArray(b.items)) throw new Error('行情返回格式不对');
  return { sample: b.sample === true, items: b.items.filter((i) => i && typeof i.symbol === 'string') };
}

async function realPublicQuotes(): Promise<PublicQuotes> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('/api/public/quotes', { headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error(`行情接口返回 ${res.status}`);
    return parsePublicQuotes(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

export function fetchPublicQuotes(): Promise<PublicQuotes> {
  return IS_MOCK ? mockPublicQuotes() : realPublicQuotes();
}
