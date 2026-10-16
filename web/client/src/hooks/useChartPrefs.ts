/**
 * 图表显示设置（v2 E5）：显示哪些指标、是否显示买卖价线。记在本地（localStorage `fx.chart.prefs`），换品种、刷新后保持。
 * 默认：MA 和买卖价线打开（MA7、MA25 是 v1 就有的），其他指标关闭。
 */
import { useCallback, useState } from 'react';
import { INDICATORS, type IndicatorKey } from '../lib/indicators';

const KEY = 'fx.chart.prefs';

export interface ChartPrefs {
  indicators: IndicatorKey[];
  bidAsk: boolean;
}

export const DEFAULT_PREFS: ChartPrefs = { indicators: ['ma'], bidAsk: true };

/** 读本地记录；格式不对或读不到就用默认值，未知的指标名丢掉，顺序按 INDICATORS 固定 */
export function readChartPrefs(): ChartPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ChartPrefs> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
    const list = Array.isArray(raw.indicators) ? raw.indicators : DEFAULT_PREFS.indicators;
    return { indicators: INDICATORS.filter((k) => list.includes(k)), bidAsk: typeof raw.bidAsk === 'boolean' ? raw.bidAsk : DEFAULT_PREFS.bidAsk };
  } catch {
    return DEFAULT_PREFS;
  }
}

function save(p: ChartPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 忽略：无痕模式等读写不了本地存储时只在本次有效 */
  }
}

export function useChartPrefs() {
  const [prefs, setPrefs] = useState<ChartPrefs>(readChartPrefs);
  const toggleIndicator = useCallback((k: IndicatorKey) => {
    setPrefs((p) => {
      const on = p.indicators.includes(k);
      const next = { ...p, indicators: INDICATORS.filter((x) => (x === k ? !on : p.indicators.includes(x))) };
      save(next);
      return next;
    });
  }, []);
  const toggleBidAsk = useCallback(() => {
    setPrefs((p) => {
      const next = { ...p, bidAsk: !p.bidAsk };
      save(next);
      return next;
    });
  }, []);
  return { prefs, toggleIndicator, toggleBidAsk };
}
