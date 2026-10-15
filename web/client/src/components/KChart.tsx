/**
 * K 线图：TradingView 开源的 lightweight-charts（Apache-2.0）。
 * 按许可要求保留图表右下角的 TradingView 署名标志，并在图表下方注明来源。
 * 历史数据来自 getKlines，最后一根随报价实时更新（subscribeKline）。
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { getKlines, subscribeKline } from '../api/market';
import type { Kline, Timeframe } from '../api/types';
import { useTheme } from '../app/contexts';
import { useScenarioVersion } from '../hooks/useAsync';
import { errorKey } from '../api/errors';

interface Props {
  symbol: string;
  timeframe: Timeframe;
  digits: number;
  /** 持仓开仓价，画成虚线 */
  positionLines?: Array<{ price: number; label: string }>;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#64748b';
}

function toBar(k: Kline) {
  return { time: k.time as UTCTimestamp, open: Number(k.open), high: Number(k.high), low: Number(k.low), close: Number(k.close) };
}

function maSeries(bars: Kline[], n: number) {
  const out: Array<{ time: UTCTimestamp; value: number }> = [];
  let s = 0;
  for (let i = 0; i < bars.length; i++) {
    s += Number(bars[i].close);
    if (i >= n) s -= Number(bars[i - n].close);
    if (i >= n - 1) out.push({ time: bars[i].time as UTCTimestamp, value: s / n });
  }
  return out;
}

export function KChart({ symbol, timeframe, digits, positionLines }: Props) {
  const { t } = useTranslation();
  const { theme, upDown } = useTheme();
  const version = useScenarioVersion();
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [status, setStatus] = useState<{ loading: boolean; error?: unknown; empty?: boolean }>({ loading: true });
  const [legend, setLegend] = useState<Kline | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const up = cssVar('--long-fill');
    const down = cssVar('--short');
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: cssVar('--subtle'), fontFamily: cssVar('--mono'), fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: cssVar('--hair') }, horzLines: { color: cssVar('--hair') } },
      rightPriceScale: { borderColor: cssVar('--border') },
      timeScale: { borderColor: cssVar('--border'), timeVisible: timeframe !== '1d', secondsVisible: false },
      localization: { priceFormatter: (p: number) => p.toFixed(digits) },
      crosshair: { mode: 0 },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      borderVisible: false,
      wickUpColor: up,
      wickDownColor: down,
      priceFormat: { type: 'price', precision: digits, minMove: 1 / 10 ** digits },
    });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.2 } });
    const ma7 = chart.addSeries(LineSeries, { color: '#d97706', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const ma25 = chart.addSeries(LineSeries, { color: '#7c3aed', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    chartRef.current = chart;
    candleRef.current = candle;

    let alive = true;
    let unsub: (() => void) | undefined;
    setStatus({ loading: true });
    getKlines(symbol, timeframe).then(
      (bars) => {
        if (!alive) return;
        if (bars.length === 0) {
          setStatus({ loading: false, empty: true });
          return;
        }
        setStatus({ loading: false });
        candle.setData(bars.map(toBar));
        volume.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, value: Number(b.volume), color: Number(b.close) >= Number(b.open) ? `${up}55` : `${down}44` })));
        ma7.setData(maSeries(bars, 7));
        ma25.setData(maSeries(bars, 25));
        chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 70), to: bars.length + 3 });
        setLegend(bars[bars.length - 1]);
        const recent = bars.slice(-30);
        unsub = subscribeKline(symbol, timeframe, (b) => {
          candle.update(toBar(b));
          volume.update({ time: b.time as UTCTimestamp, value: Number(b.volume), color: Number(b.close) >= Number(b.open) ? `${up}55` : `${down}44` });
          if (recent[recent.length - 1]?.time === b.time) recent[recent.length - 1] = b;
          else recent.push(b);
          if (recent.length > 30) recent.shift();
          const m7 = maSeries(recent, 7);
          const m25 = maSeries(recent, 25);
          if (m7.length) ma7.update(m7[m7.length - 1]);
          if (m25.length) ma25.update(m25[m25.length - 1]);
          setLegend(b);
        });
      },
      (error: unknown) => alive && setStatus({ loading: false, error }),
    );
    return () => {
      alive = false;
      unsub?.();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
    };
  }, [symbol, timeframe, digits, theme, upDown, version, nonce]);

  // 持仓开仓价虚线
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle || status.loading || status.error) return;
    const lines = (positionLines ?? []).map((p) =>
      candle.createPriceLine({ price: p.price, color: cssVar('--cyan-deep'), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: p.label }),
    );
    return () => lines.forEach((l) => candle.removePriceLine(l));
  }, [positionLines, status]);

  return (
    <div className="kchart">
      {legend && !status.error && (
        <div className="kchart-legend num" aria-hidden="true">
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
          <span className="ma7">MA7</span>
          <span className="ma25">MA25</span>
        </div>
      )}
      <div ref={boxRef} className="kchart-canvas" role="img" aria-label={t('chart.aria', { symbol, tf: timeframe })} />
      {status.loading && <div className="kchart-overlay">{t('common.loading')}</div>}
      {status.empty && <div className="kchart-overlay">{t('chart.empty')}</div>}
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
