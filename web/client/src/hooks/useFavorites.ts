/**
 * 自选品种（UI 风格 C 的"★ 自选"分类）。V1 只存在当前浏览器（localStorage），不上服务器；
 * 第一次使用时默认是热门品种。
 */
import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'fx.favorites';
const listeners = new Set<() => void>();
let cache: string[] | null = null;

function load(): string[] | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? (JSON.parse(v) as string[]) : null;
  } catch {
    return null;
  }
}

function read(): string[] | null {
  if (cache === null) cache = load();
  return cache;
}

function save(list: string[]): void {
  cache = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 忽略 */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** @param defaults 还没设置过自选时使用的默认列表（热门品种） */
export function useFavorites(defaults: string[]) {
  const stored = useSyncExternalStore(subscribe, read, read);
  const list = stored ?? defaults;
  const toggle = useCallback(
    (code: string) => {
      const cur = read() ?? defaults;
      save(cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]);
    },
    [defaults],
  );
  return { list, has: (code: string) => list.includes(code), toggle };
}

/** 测试用：清空自选 */
export function resetFavorites(): void {
  cache = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
  listeners.forEach((l) => l());
}
