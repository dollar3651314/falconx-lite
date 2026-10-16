/**
 * 行情图：TradingView 开源的 lightweight-charts（Apache-2.0）。
 * 按许可要求保留图表右下角的 TradingView 署名标志，并在图表下方注明来源。
 *
 * 两种图（需求说明书 4.2-5、v2 E5）：
 * - K 线（1m～1d）：历史来自 getKlines，最后一根随推送实时更新（subscribeKline）；K 线和后端一样按**中间价**聚合。
 * - Tick 图：最近一段逐笔**中间价**（(卖价 + 买价) / 2，和 K 线同一口径）的折线。初始数据来自 getTicks（后端内存里每个品种最近 500 笔），
 *   之后用报价推送往后接（真实环境推送每 250 毫秒合并一次，所以实时部分是"每 250 毫秒最新的一笔"）。
 *   横轴用序号排点（同一秒可能有多笔，图表库要求时间严格递增），刻度和十字线再换回真实时间。
 *
 * 叠加：买价、卖价两条水平线（可开关）；指标 MA、EMA、BOLL 画在主图，MACD、RSI 各占一个副图（可选择，见 useChartPrefs）。
 * 指标的计算在 `lib/indicators.ts`（纯函数，有单元测试），Tick 图上按中间价序列计算。
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { getKlines, getTicks, subscribeKline, subscribeQuotes } from '../api/market';
import type { ChartPeriod, Kline, Tick } from '../api/types';
import { useTheme } from '../app/contexts';
import { useScenarioVersion } from '../hooks/useAsync';
import { useQuote } from '../hooks/useQuotes';
import { errorKey } from '../api/errors';
import { boll, ema, INDICATOR_LABEL, macd, PARAMS, rsi, sma, SUB_PANE, type IndicatorKey, type Series } from '../lib/indicators';

interface Props {
  symbol: string;
  period: ChartPeriod;
  digits: number;
  /** 要显示的指标（顺序无关） */
  indicators?: IndicatorKey[];
  /** 显示买价、卖价两条水平线 */
  showBidAsk?: boolean;
  /** 持仓开仓价，画成虚线 */
  positionLines?: Array<{ price: number; label: string }>;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#64748b';
}

/** 指标线的颜色（两种主题下都看得清；涨跌相关的用 --long / --short，跟随涨跌色设置） */
const IND_COLORS = {
  ma7: '#d97706',
  ma25: '#7c3aed',
  ema12: '#db2777',
  ema26: '#2563eb',
  bollMid: '#ca8a04',
  bollBand: '#64748b',
  dif: '#d97706',
  dea: '#7c3aed',
  rsi: '#7c3aed',
};

const toBar = (k: Kline) => ({ time: k.time as UTCTimestamp, open: Number(k.open), high: Number(k.high), low: Number(k.low), close: Number(k.close) });
const midOf = (t: { bid: string; ask: string }) => (Number(t.bid) + Number(t.ask)) / 2;
const pad = (n: number) => String(n).padStart(2, '0');
function hms(ms: number | undefined): string {
  if (ms === undefined) return '';
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 图上当前的数据：横轴时间（K 线是秒级时间戳，Tick 图是序号）和对应的收盘价 / 中间价 */
interface ChartData {
  times: number[];
  values: number[];
}

/** 一条指标线：算法 + 画法 */
interface Line {
  key: string;
  calc: (v: number[]) => Series;
  kind: 'line' | 'hist';
  color: string;
  pane: number;
  title?: string;
  dashed?: boolean;
}

function indicatorLines(keys: IndicatorKey[], up: string): { lines: Line[]; subPanes: number } {
  const lines: Line[] = [];
  let pane = 0;
  const on = (k: IndicatorKey) => keys.includes(k);
  if (on('ma')) {
    lines.push({ key: 'ma7', calc: (v) => sma(v, PARAMS.ma[0]), kind: 'line', color: IND_COLORS.ma7, pane: 0 });
    lines.push({ key: 'ma25', calc: (v) => sma(v, PARAMS.ma[1]), kind: 'line', color: IND_COLORS.ma25, pane: 0 });
  }
  if (on('ema')) {
    lines.push({ key: 'ema12', calc: (v) => ema(v, PARAMS.ema[0]), kind: 'line', color: IND_COLORS.ema12, pane: 0 });
    lines.push({ key: 'ema26', calc: (v) => ema(v, PARAMS.ema[1]), kind: 'line', color: IND_COLORS.ema26, pane: 0 });
  }
  if (on('boll')) {
    const b = (v: number[]) => boll(v, PARAMS.boll[0], PARAMS.boll[1]);
    lines.push({ key: 'bollUp', calc: (v) => b(v).upper, kind: 'line', color: IND_COLORS.bollBand, pane: 0, dashed: true });
    lines.push({ key: 'bollMid', calc: (v) => b(v).mid, kind: 'line', color: IND_COLORS.bollMid, pane: 0 });
    lines.push({ key: 'bollLo', calc: (v) => b(v).lower, kind: 'line', color: IND_COLORS.bollBand, pane: 0, dashed: true });
  }
  if (on('macd')) {
    pane += 1;
    const m = (v: number[]) => macd(v, PARAMS.macd[0], PARAMS.macd[1], PARAMS.macd[2]);
    lines.push({ key: 'hist', calc: (v) => m(v).hist, kind: 'hist', color: up, pane, title: 'MACD' });
    lines.push({ key: 'dif', calc: (v) => m(v).dif, kind: 'line', color: IND_COLORS.dif, pane, title: 'DIF' });
    lines.push({ key: 'dea', calc: (v) => m(v).dea, kind: 'line', color: IND_COLORS.dea, pane, title: 'DEA' });
  }
  if (on('rsi')) {
    pane += 1;
    lines.push({ key: 'rsi', calc: (v) => rsi(v, PARAMS.rsi[0]), kind: 'line', color: IND_COLORS.rsi, pane, title: 'RSI' });
  }
  return { lines, subPanes: pane };
}

export function KChart({ symbol, period, digits, indicators = [], showBidAsk = false, positionLines }: Props) {
  const { t } = useTranslation();
  const { theme, upDown } = useTheme();
  const version = useScenarioVersion();
  const quote = useQuote(symbol);
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const dataRef = useRef<ChartData>({ times: [], values: [] });
  /** 实时数据追加 / 更新最后一个点之后调用（指标跟着更新） */
  const liveRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<{ loading: boolean; error?: unknown; empty?: boolean }>({ loading: true });
  const [legend, setLegend] = useState<Kline | null>(null);
  const [lastMid, setLastMid] = useState<number | null>(null);
  /** 每次图表重建并装好数据加 1，叠加层（指标、价格线）据此重新挂上 */
  const [dataGen, setDataGen] = useState(0);
  const [nonce, setNonce] = useState(0);
  const isTick = period === 'tick';
  const indKey = indicators.slice().sort().join(',');

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const up = cssVar('--long-fill');
    const down = cssVar('--short');
    const tickMs: number[] = []; // Tick 图：序号 i+1 对应的真实时间（毫秒）
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: cssVar('--subtle'),
        fontFamily: cssVar('--mono'),
        fontSize: 11,
        attributionLogo: true,
        panes: { separatorColor: cssVar('--border'), separatorHoverColor: cssVar('--hair') },
      },
      grid: { vertLines: { color: cssVar('--hair') }, horzLines: { color: cssVar('--hair') } },
      rightPriceScale: { borderColor: cssVar('--border') },
      timeScale: {
        borderColor: cssVar('--border'),
        timeVisible: period !== '1d',
        secondsVisible: isTick,
        ...(isTick ? { tickMarkFormatter: (time: Time) => hms(tickMs[(time as number) - 1]) } : {}),
      },
      localization: {
        priceFormatter: (p: number) => p.toFixed(digits),
        ...(isTick ? { timeFormatter: (time: Time) => hms(tickMs[(time as number) - 1]) } : {}),
      },
      crosshair: { mode: 0 },
    });
    const priceFormat = { type: 'price' as const, precision: digits, minMove: 1 / 10 ** digits };
    let candle: ISeriesApi<'Candlestick'> | null = null;
    let volume: ISeriesApi<'Histogram'> | null = null;
    let line: ISeriesApi<'Line'> | null = null;
    if (isTick) {
      line = chart.addSeries(LineSeries, { color: cssVar('--cyan'), lineWidth: 2, priceFormat, crosshairMarkerRadius: 3 });
      line.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.1 } });
    } else {
      candle = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, priceFormat });
      volume = chart.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      candle.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.2 } });
    }
    chartRef.current = chart;
    mainRef.current = (line ?? candle) as ISeriesApi<SeriesType>;
    const data: ChartData = { times: [], values: [] };
    dataRef.current = data;
    const volColor = (b: Kline) => (Number(b.close) >= Number(b.open) ? `${up}55` : `${down}44`);

    let alive = true;
    let unsub: (() => void) | undefined;
    setStatus({ loading: true });
    setLegend(null);
    setLastMid(null);

    /** 有了第一批实时数据时，去掉"暂无数据"的提示 */
    const gotLive = () => setStatus((s) => (s.empty ? { loading: false } : s));

    if (isTick && line) {
      const series = line;
      const push = (ticks: Tick[]) => {
        let added = false;
        for (const tk of ticks) {
          if (tickMs.length && tk.time <= tickMs[tickMs.length - 1]) continue; // 推送的快照可能和已有的重复
          tickMs.push(tk.time);
          data.times.push(tickMs.length);
          data.values.push(midOf(tk));
          added = true;
        }
        return added;
      };
      getTicks(symbol).then(
        (ticks) => {
          if (!alive) return;
          push(ticks);
          setStatus(data.values.length ? { loading: false } : { loading: false, empty: true });
          series.setData(data.values.map((v, i) => ({ time: data.times[i] as UTCTimestamp, value: v })));
          if (data.values.length) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.values.length - 200), to: data.values.length + 5 });
          setLastMid(data.values[data.values.length - 1] ?? null);
          setDataGen((g) => g + 1);
          unsub = subscribeQuotes((qs) => {
            const mine = qs.filter((q) => q.symbol === symbol).map((q) => ({ time: Date.parse(q.time), bid: q.bid, ask: q.ask }));
            const before = data.values.length;
            if (!mine.length || !push(mine)) return;
            for (let i = before; i < data.values.length; i++) series.update({ time: data.times[i] as UTCTimestamp, value: data.values[i] });
            setLastMid(data.values[data.values.length - 1]);
            gotLive();
            liveRef.current?.();
          });
        },
        (error: unknown) => alive && setStatus({ loading: false, error }),
      );
    } else if (candle && volume) {
      const cs = candle;
      const vs = volume;
      getKlines(symbol, period as Exclude<ChartPeriod, 'tick'>).then(
        (bars) => {
          if (!alive) return;
          setStatus(bars.length ? { loading: false } : { loading: false, empty: true });
          cs.setData(bars.map(toBar));
          vs.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, value: Number(b.volume), color: volColor(b) })));
          data.times = bars.map((b) => b.time);
          data.values = bars.map((b) => Number(b.close));
          if (bars.length) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 70), to: bars.length + 3 });
          setLegend(bars[bars.length - 1] ?? null);
          setDataGen((g) => g + 1);
          unsub = subscribeKline(symbol, period as Exclude<ChartPeriod, 'tick'>, (b) => {
            const last = data.times[data.times.length - 1];
            if (last !== undefined && b.time < last) return;
            cs.update(toBar(b));
            vs.update({ time: b.time as UTCTimestamp, value: Number(b.volume), color: volColor(b) });
            if (last === b.time) data.values[data.values.length - 1] = Number(b.close);
            else {
              data.times.push(b.time);
              data.values.push(Number(b.close));
            }
            setLegend(b);
            gotLive();
            liveRef.current?.();
          });
        },
        (error: unknown) => alive && setStatus({ loading: false, error }),
      );
    }
    return () => {
      alive = false;
      unsub?.();
      liveRef.current = null;
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
    };
  }, [symbol, period, isTick, digits, theme, upDown, version, nonce]);

  // 指标：按选择挂上指标线，数据更新时跟着更新最后一个点
  useEffect(() => {
    const chart = chartRef.current;
    const data = dataRef.current;
    if (!chart || dataGen === 0) return;
    const up = cssVar('--long-fill');
    const down = cssVar('--short');
    const { lines, subPanes } = indicatorLines(indKey ? (indKey.split(',') as IndicatorKey[]) : [], up);
    const histColor = (v: number) => (v >= 0 ? `${up}99` : `${down}99`);
    const made = lines.map((l) => {
      const opts = { color: l.color, priceLineVisible: false, lastValueVisible: !!l.title, title: l.title ?? '', crosshairMarkerVisible: false };
      const s =
        l.kind === 'hist'
          ? chart.addSeries(HistogramSeries, { ...opts, priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } }, l.pane)
          : chart.addSeries(LineSeries, { ...opts, lineWidth: 1, lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid, ...(l.pane ? { priceFormat: { type: 'price', precision: l.key === 'rsi' ? 2 : 4, minMove: 0.0001 } } : {}) }, l.pane);
      return { l, s };
    });
    const rsiSeries = made.find((m) => m.l.key === 'rsi')?.s;
    rsiSeries?.createPriceLine({ price: 70, color: cssVar('--subtle'), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
    rsiSeries?.createPriceLine({ price: 30, color: cssVar('--subtle'), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
    const point = (l: Line, time: number, v: number) => ({ time: time as UTCTimestamp, value: v, ...(l.kind === 'hist' ? { color: histColor(v) } : {}) });
    for (const { l, s } of made) {
      const vals = l.calc(data.values);
      const pts: Array<ReturnType<typeof point>> = [];
      vals.forEach((v, i) => {
        if (v !== null) pts.push(point(l, data.times[i], v));
      });
      s.setData(pts);
    }
    const panes = chart.panes();
    if (subPanes > 0 && panes.length > subPanes) {
      panes[0].setStretchFactor(1);
      for (let i = 1; i <= subPanes; i++) panes[i].setStretchFactor(0.3);
    }
    liveRef.current = () => {
      const last = data.values.length - 1;
      if (last < 0) return;
      for (const { l, s } of made) {
        const v = l.calc(data.values)[last];
        if (v !== null) s.update(point(l, data.times[last], v));
      }
    };
    return () => {
      liveRef.current = null;
      if (chartRef.current !== chart) return; // 图表已经整个重建，指标线随旧图表一起销毁了
      for (const { s } of made) chart.removeSeries(s);
    };
  }, [indKey, dataGen]);

  // 买价、卖价两条水平线（右侧价格轴上有标签）：报价变了就换成新的两条线，开销很小
  const bid = quote?.bid;
  const ask = quote?.ask;
  useEffect(() => {
    const main = mainRef.current;
    if (!main || dataGen === 0 || !showBidAsk || bid === undefined || ask === undefined) return;
    const mk = (price: string, title: string, color: string) =>
      main.createPriceLine({ price: Number(price), color, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title });
    const lines = [mk(bid, t('chart.bid'), cssVar('--short')), mk(ask, t('chart.ask'), cssVar('--long'))];
    return () => {
      if (mainRef.current === main) lines.forEach((l) => main.removePriceLine(l));
    };
  }, [showBidAsk, dataGen, bid, ask, t]);

  // 持仓开仓价虚线
  useEffect(() => {
    const main = mainRef.current;
    if (!main || dataGen === 0) return;
    const lines = (positionLines ?? []).map((p) =>
      main.createPriceLine({ price: p.price, color: cssVar('--cyan-deep'), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: p.label }),
    );
    return () => {
      if (mainRef.current === main) lines.forEach((l) => main.removePriceLine(l));
    };
  }, [positionLines, dataGen]);

  const on = (k: IndicatorKey) => indicators.includes(k);
  const subCount = indicators.filter((k) => SUB_PANE.includes(k)).length;
  return (
    <div className="kchart" data-sub-panes={subCount}>
      {!status.error && (legend || lastMid !== null) && (
        <div className="kchart-legend num" aria-hidden="true">
          {isTick ? (
            <span>
              <i>{t('chart.tickMid')}</i> {lastMid !== null ? lastMid.toFixed(digits + 1) : '—'}
            </span>
          ) : (
            legend && (
              <>
                <span>
                  <i>{t('chart.open')}</i> {Number(legend.open).toFixed(digits)}
                </span>
                <span>
                  <i>{t('chart.high')}</i> {Number(legend.high).toFixed(digits)}
                </span>
                <span>
                  <i>{t('chart.low')}</i> {Number(legend.low).toFixed(digits)}
                </span>
                <span>
                  <i>{t('chart.close')}</i> {Number(legend.close).toFixed(digits)}
                </span>
              </>
            )
          )}
          {on('ma') && (
            <>
              <span style={{ color: IND_COLORS.ma7 }}>MA{PARAMS.ma[0]}</span>
              <span style={{ color: IND_COLORS.ma25 }}>MA{PARAMS.ma[1]}</span>
            </>
          )}
          {on('ema') && (
            <>
              <span style={{ color: IND_COLORS.ema12 }}>EMA{PARAMS.ema[0]}</span>
              <span style={{ color: IND_COLORS.ema26 }}>EMA{PARAMS.ema[1]}</span>
            </>
          )}
          {on('boll') && <span style={{ color: IND_COLORS.bollMid }}>{INDICATOR_LABEL.boll}</span>}
          {on('macd') && <span style={{ color: IND_COLORS.dif }}>{INDICATOR_LABEL.macd}</span>}
          {on('rsi') && <span style={{ color: IND_COLORS.rsi }}>{INDICATOR_LABEL.rsi}</span>}
        </div>
      )}
      <div ref={boxRef} className="kchart-canvas" role="img" aria-label={t(isTick ? 'chart.ariaTick' : 'chart.aria', { symbol, tf: period })} />
      {status.loading && <div className="kchart-overlay">{t('common.loading')}</div>}
      {status.empty && <div className="kchart-overlay">{t(isTick ? 'chart.emptyTick' : 'chart.empty')}</div>}
      {status.error !== undefined && (
        <div className="kchart-overlay error" role="alert">
          <span>{t(errorKey(status.error))}</span>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setNonce((n) => n + 1)}>
            {t('common.retry')}
          </button>
        </div>
      )}
    </div>
  );
}
