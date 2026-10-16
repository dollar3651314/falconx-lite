/**
 * 图表技术指标（需求说明书 4.2-5、v2 E5、验收 AC2-18）。全部是纯函数：输入收盘价序列（K 线用收盘价，Tick 图用中间价），
 * 输出和输入等长的数组，前面数据不够算的位置是 null。图表只显示，不参与任何交易计算，所以用浮点数。
 *
 * 公式（和原系统 fxsystem `falconx-frontend/src/features/market/indicators/math.ts` 一致，RSI 的全涨情况按定义修正为 100）：
 * - MA(n)：最近 n 个收盘价的简单平均。
 * - EMA(n)：α = 2 / (n + 1)，EMA_t = α·C_t + (1 − α)·EMA_{t−1}；第一个值（第 n 个位置）用前 n 个的简单平均做种子
 *   （TA-Lib、StockCharts 的做法）。
 * - BOLL(n, k)：中轨 = MA(n)，上 / 下轨 = 中轨 ± k × 最近 n 个收盘价的总体标准差（除以 n，不是 n − 1；TradingView、TA-Lib 相同）。
 * - MACD(快, 慢, 信号)：DIF = EMA(快) − EMA(慢)；DEA = DIF 的 EMA(信号)（同样用前"信号"个 DIF 的平均做种子）；
 *   柱 = 2 × (DIF − DEA)（国内行情软件的口径，原系统相同）。
 * - RSI(n)：Wilder 平滑。第一个值用前 n 次涨跌的简单平均，之后 avg = (avg_{t−1} × (n − 1) + 本次) / n；
 *   RSI = 100 − 100 / (1 + 平均涨幅 / 平均跌幅)；平均跌幅为 0 时 RSI = 100（涨跌都为 0 时取 50）。
 */

export type Series = Array<number | null>;

/** 简单移动平均 */
export function sma(values: number[], n: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (n < 1) return out;
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i];
    if (i >= n) s -= values[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

/** 指数移动平均；输入里前面的 null 会跳过（MACD 的 DEA 用它对 DIF 求平均） */
export function ema(values: Series, n: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (n < 1) return out;
  const start = values.findIndex((v) => v !== null);
  if (start < 0 || values.length - start < n) return out;
  const a = 2 / (n + 1);
  let seed = 0;
  for (let i = start; i < start + n; i++) seed += values[i] as number;
  let prev = seed / n;
  out[start + n - 1] = prev;
  for (let i = start + n; i < values.length; i++) {
    prev = a * (values[i] as number) + (1 - a) * prev;
    out[i] = prev;
  }
  return out;
}

export interface Boll {
  mid: Series;
  upper: Series;
  lower: Series;
}

/** 布林带：中轨 MA(n)，上下轨 ± k 倍总体标准差 */
export function boll(values: number[], n = 20, k = 2): Boll {
  const mid = sma(values, n);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    const m = mid[i] as number;
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (values[j] - m) ** 2;
    const sd = Math.sqrt(v / n);
    upper[i] = m + k * sd;
    lower[i] = m - k * sd;
  }
  return { mid, upper, lower };
}

export interface Macd {
  dif: Series;
  dea: Series;
  hist: Series;
}

/** MACD：DIF、DEA、柱（2 × (DIF − DEA)） */
export function macd(values: number[], fast = 12, slow = 26, signal = 9): Macd {
  const ef = ema(values, fast);
  const es = ema(values, slow);
  const dif: Series = values.map((_, i) => (ef[i] !== null && es[i] !== null ? (ef[i] as number) - (es[i] as number) : null));
  const dea = ema(dif, signal);
  const hist: Series = values.map((_, i) => (dif[i] !== null && dea[i] !== null ? 2 * ((dif[i] as number) - (dea[i] as number)) : null));
  return { dif, dea, hist };
}

/** RSI（Wilder 平滑） */
export function rsi(values: number[], n = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (n < 1 || values.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[n] = value();
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = value();
  }
  return out;
}

// ---------- 图表上显示哪些指标（用户选择，记在本地） ----------

export type IndicatorKey = 'ma' | 'ema' | 'boll' | 'macd' | 'rsi';
export const INDICATORS: IndicatorKey[] = ['ma', 'ema', 'boll', 'macd', 'rsi'];
/** 画在副图（K 线下方单独一栏）的指标 */
export const SUB_PANE: IndicatorKey[] = ['macd', 'rsi'];
/** 各指标的参数，图例和单元测试共用 */
export const PARAMS = {
  ma: [7, 25],
  ema: [12, 26],
  boll: [20, 2],
  macd: [12, 26, 9],
  rsi: [14],
} as const;
export const INDICATOR_LABEL: Record<IndicatorKey, string> = {
  ma: `MA(${PARAMS.ma.join(',')})`,
  ema: `EMA(${PARAMS.ema.join(',')})`,
  boll: `BOLL(${PARAMS.boll.join(',')})`,
  macd: `MACD(${PARAMS.macd.join(',')})`,
  rsi: `RSI(${PARAMS.rsi.join(',')})`,
};
