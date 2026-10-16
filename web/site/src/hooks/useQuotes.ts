/**
 * 官网行情：每秒取一次（技术方案/v2-官网技术方案.md 第 3 节：轮询，不用 WebSocket）。
 * - 页面在后台（标签页不可见）时暂停，回到前台立即取一次，不给服务器添无用的请求；
 * - 取不到超过 UNAVAILABLE_AFTER_MS 就把全部品种显示成"暂无报价"（不显示过期价格），恢复后照常显示。
 */
import { useEffect, useRef, useState } from 'react';
import { fetchPublicQuotes } from '../api/quotes';
import { DEFAULT_SYMBOLS } from '../config';
import { initialRows, nextRows, POLL_MS, unavailableRows, UNAVAILABLE_AFTER_MS, type Row } from '../lib/quotes';

export interface QuotesState {
  rows: Row[];
  /** 来自模拟报价源：标"示例行情" */
  sample: boolean;
}

export function useQuotes(): QuotesState {
  const [state, setState] = useState<QuotesState>(() => ({ rows: initialRows(DEFAULT_SYMBOLS), sample: false }));
  const lastOk = useRef(Date.now());

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;

    const tick = async () => {
      if (stopped || inFlight) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const data = await fetchPublicQuotes();
        if (stopped) return;
        lastOk.current = Date.now();
        setState((s) => ({ rows: nextRows(s.rows, data), sample: data.sample }));
      } catch {
        if (!stopped && Date.now() - lastOk.current >= UNAVAILABLE_AFTER_MS) setState((s) => ({ ...s, rows: unavailableRows(s.rows) }));
      } finally {
        inFlight = false;
        if (!stopped) schedule();
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(tick, POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        lastOk.current = Date.now();
        void tick();
      }
    };
    void tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return state;
}
