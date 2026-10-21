/** 电脑交易页左栏的显示方式（体验优化 1021 第 7 条，见 components/WatchRail.tsx），记在这个浏览器 */
import { useState } from 'react';

export type WatchMode = 'names' | 'full' | 'collapsed';
const KEY = 'fx.trade.wl';

function readMode(): WatchMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'full' || v === 'collapsed' ? v : 'names';
  } catch {
    return 'names';
  }
}

export function useWatchMode(): [WatchMode, (m: WatchMode) => void] {
  const [mode, setMode] = useState<WatchMode>(readMode);
  const set = (m: WatchMode) => {
    setMode(m);
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* 忽略 */
    }
  };
  return [mode, set];
}
