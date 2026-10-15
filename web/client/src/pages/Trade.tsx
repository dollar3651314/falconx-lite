/**
 * 交易页（UI 风格 C）。手机和电脑各自一套结构，数据和下单逻辑共用。
 * 手机（效果图 assets/v1/ui-research/C-手机.png 第 ② 屏）：品种页，K 线占主体，底部固定"卖出 / 买入"，
 *   点了才弹出下单抽屉（OrderSheet）。
 * 桌面 ≥1024（效果图 C-桌面-交易页.png）：三栏，左品种列表 | 中 K 线（左上角卖 / 买价格按钮）+ 持仓 | 右下单面板。
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { TIMEFRAMES } from '../api/market';
import type { Side, SymbolInfo, Timeframe } from '../api/types';
import { useAccount, useSymbols } from '../app/contexts';
import { EmptyState, ErrorState, Loading } from '../components/AsyncView';
import { Icon } from '../components/Icon';
import { KChart } from '../components/KChart';
import { Modal } from '../components/Modal';
import { OrderPanel } from '../components/OrderPanel';
import { OrderSheet } from '../components/OrderSheet';
import { PositionsTabs } from '../components/PositionsTabs';
import { StatusTags, SymbolList } from '../components/SymbolList';
import { useFavorites } from '../hooks/useFavorites';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { useQuote, useQuotes } from '../hooks/useQuotes';
import { cmp, dec, sub, ZERO } from '../lib/decimal';
import { formatAmount, formatDecimal, formatLots, formatPercent, formatPrice } from '../lib/format';
import { spreadPoints, symbolName } from '../lib/symbol';
import { changePercent, positionPnl } from '../lib/trading';

const TF_KEY = 'fx.trade.tf';
const LAST_KEY = 'fx.trade.symbol';

function readLocal(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function writeLocal(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 忽略 */
  }
}

/** 涨跌、点差等行情摘要 */
function useSymbolStats(s: SymbolInfo) {
  const q = useQuote(s.code);
  const chg = q ? changePercent(q.open, q.bid) : null;
  const diff = q ? sub(dec(q.bid), dec(q.open)) : null;
  const up = chg === null || cmp(chg, ZERO) >= 0;
  const spread = q ? spreadPoints(q, s.digits) : null;
  const chgText = diff !== null && chg !== null ? `${formatDecimal(diff, s.digits, { sign: true })} (${formatPercent(chg, { sign: true })})` : '—';
  return { q, up, cls: up ? 'up' : 'down', spread, chgText };
}

function FavButton({ code }: { code: string }) {
  const { t } = useTranslation();
  const { list } = useSymbols();
  const hot = useMemo(() => list.filter((s) => s.hot).map((s) => s.code), [list]);
  const fav = useFavorites(hot);
  const on = fav.has(code);
  return (
    <button type="button" className={`star-btn${on ? ' on' : ''}`} aria-pressed={on} aria-label={on ? t('market.removeFav') : t('market.addFav')} onClick={() => fav.toggle(code)}>
      <Icon name="star" size={18} strokeWidth={2} />
    </button>
  );
}

function TfBar({ tf, onChange }: { tf: Timeframe; onChange: (t: Timeframe) => void }) {
  const { t } = useTranslation();
  return (
    <div className="tf-bar" role="radiogroup" aria-label={t('trade.timeframe')}>
      {TIMEFRAMES.map((x) => (
        <button key={x} type="button" role="radio" aria-checked={tf === x} className={tf === x ? 'on' : ''} onClick={() => onChange(x)}>
          {x}
        </button>
      ))}
      <span className="sp" />
      <span className="tf-note">MA7 · MA25</span>
    </div>
  );
}

function ChartCredit() {
  const { t } = useTranslation();
  return (
    <p className="chart-credit">
      {t('chart.credit')}{' '}
      <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer noopener">
        TradingView
      </a>
    </p>
  );
}

/** 卖出 / 买入价格按钮：桌面浮在图表左上角，点击切换右栏下单方向 */
function PriceButtons({ s, side, onPick }: { s: SymbolInfo; side?: Side; onPick: (side: Side) => void }) {
  const { t } = useTranslation();
  const q = useQuote(s.code);
  return (
    <div className="px-btns">
      {(['sell', 'buy'] as const).map((x) => (
        <button key={x} type="button" className={`px-btn ${x}${side === x ? ' on' : ''}`} onClick={() => onPick(x)} aria-pressed={side === x}>
          <small>{t(`side.${x}`)}</small>
          <b className="num">{q ? formatPrice(x === 'buy' ? q.ask : q.bid, s.digits) : '—'}</b>
        </button>
      ))}
    </div>
  );
}

function DesktopHead({ s }: { s: SymbolInfo }) {
  const { t, i18n } = useTranslation();
  const { q, cls, spread, chgText } = useSymbolStats(s);
  return (
    <div className="sym-head-d">
      <div className="nm">
        <b className="num">{s.code}</b>
        <small>{symbolName(s, i18n.language)}</small>
        <StatusTags s={s} />
      </div>
      <FavButton code={s.code} />
      <span className={`num chg ${cls}`}>{chgText}</span>
      <div className="st">
        {t('trade.high')}
        <span className="num">{q ? formatPrice(q.high, s.digits) : '—'}</span>
      </div>
      <div className="st">
        {t('trade.low')}
        <span className="num">{q ? formatPrice(q.low, s.digits) : '—'}</span>
      </div>
      <div className="st">
        {t('trade.spread')}
        <span className="num">{spread ?? '—'}</span>
      </div>
    </div>
  );
}

function MobileHead({ s, onPick }: { s: SymbolInfo; onPick: () => void }) {
  const { t, i18n } = useTranslation();
  const { q, cls, spread, chgText } = useSymbolStats(s);
  return (
    <header className="m-sym">
      <div className="m-sym-top">
        <button type="button" className="sym-pick" onClick={onPick} aria-haspopup="dialog">
          <b className="num">{s.code}</b>
          <span>{symbolName(s, i18n.language)}</span>
          <Icon name="chevronDown" size={14} strokeWidth={2.4} />
        </button>
        <FavButton code={s.code} />
      </div>
      <div className="m-sym-px">
        <div>
          <div className={`p num ${cls}`}>{q ? formatPrice(q.bid, s.digits) : '—'}</div>
          <div className="m-sym-sub">
            <span className={`num ${cls}`}>{chgText}</span>
            <span>
              {t('trade.spread')} <span className="num">{spread ?? '—'}</span>
            </span>
            <StatusTags s={s} />
          </div>
        </div>
        <dl className="m-sym-hl">
          <div>
            <dt>{t('market.high')}</dt>
            <dd className="num">{q ? formatPrice(q.high, s.digits) : '—'}</dd>
          </div>
          <div>
            <dt>{t('market.low')}</dt>
            <dd className="num">{q ? formatPrice(q.low, s.digits) : '—'}</dd>
          </div>
        </dl>
      </div>
    </header>
  );
}

/** 手机品种页：该品种的持仓摘要，点"全部持仓"去持仓页 */
function MyPositionsHere({ s }: { s: SymbolInfo }) {
  const { t } = useTranslation();
  const { positions } = useAccount();
  const quotes = useQuotes();
  const mine = positions.filter((p) => p.symbol === s.code);
  if (mine.length === 0) return null;
  const q = quotes[s.code];
  return (
    <section className="m-mine">
      <div className="m-mine-head">
        <span>{t('trade.myPositionHere', { code: s.code })}</span>
        <Link to="/positions">
          {t('trade.viewAll')}
          <Icon name="chevronRight" size={14} />
        </Link>
      </div>
      {mine.map((p) => {
        const pnl = q ? positionPnl(p, s, q) : null;
        return (
          <div key={p.id} className="m-mine-row">
            <span className={p.side === 'buy' ? 'up' : 'down'}>
              {t(`side.${p.side}Short`)} {t('positions.lotsMeta', { lots: formatLots(p.lots), lev: p.leverage })}
            </span>
            <span className="muted num">@ {formatPrice(p.openPrice, s.digits)}</span>
            <b className={`num ${pnl && cmp(pnl, ZERO) < 0 ? 'down' : 'up'}`}>{pnl ? formatAmount(pnl, { sign: true }) : '—'}</b>
          </div>
        );
      })}
    </section>
  );
}

export default function Trade() {
  const { t } = useTranslation();
  const { symbol: param } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const { map, list, loading, error, reload } = useSymbols();
  const { positions } = useAccount();
  const [tf, setTf] = useState<Timeframe>(() => (TIMEFRAMES.includes(readLocal(TF_KEY) as Timeframe) ? (readLocal(TF_KEY) as Timeframe) : '15m'));
  const [sheet, setSheet] = useState<Side | null>(null);
  const [picker, setPicker] = useState(false);
  const qSide = search.get('side');
  const [sideReq, setSideReq] = useState<{ side: Side; n: number }>(() => ({ side: qSide === 'sell' ? 'sell' : 'buy', n: 0 }));

  const s = param ? map[param] : undefined;
  const lines = useMemo(
    () =>
      s
        ? positions
            .filter((p) => p.symbol === s.code)
            .map((p) => ({ price: Number(p.openPrice), label: `${t(`side.${p.side}Short`)} ${formatDecimal(p.lots, 2)} @ ${formatPrice(p.openPrice, s.digits)}` }))
        : [],
    [positions, s, t],
  );

  useEffect(() => {
    if (s) writeLocal(LAST_KEY, s.code);
  }, [s]);

  // 从桌面行情表点"卖 / 买"进来时带 ?side=，切换右栏方向
  useEffect(() => {
    if (qSide === 'buy' || qSide === 'sell') setSideReq((r) => ({ side: qSide, n: r.n + 1 }));
  }, [qSide, param]);

  if (!param) return <Navigate to={`/trade/${readLocal(LAST_KEY) ?? 'XAUUSD'}`} replace />;
  if (error && !list.length) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading && !list.length) return <div className="page"><Loading rows={6} /></div>;
  if (!list.length) return <div className="page"><EmptyState title={t('market.emptyAll')} /></div>;
  if (!s) return <div className="page"><EmptyState title={t('trade.symbolNotFound', { code: param })} action={<button type="button" className="btn btn-primary" onClick={() => navigate('/trade/XAUUSD')}>XAUUSD</button>} /></div>;

  const changeTf = (x: Timeframe) => {
    setTf(x);
    writeLocal(TF_KEY, x);
  };
  const select = (c: string) => {
    setPicker(false);
    navigate(`/trade/${c}`);
  };

  if (desktop) {
    return (
      <div className="trade-desktop">
        <aside className="panel wl">
          <SymbolList selected={s.code} onSelect={select} variant="side" initialCategory="fav" />
        </aside>
        <section className="center">
          <div className="panel chartp">
            <DesktopHead s={s} />
            <TfBar tf={tf} onChange={changeTf} />
            <div className="chart-wrap">
              <PriceButtons s={s} side={sideReq.side} onPick={(x) => setSideReq((r) => ({ side: x, n: r.n + 1 }))} />
              <KChart symbol={s.code} timeframe={tf} digits={s.digits} positionLines={lines} />
            </div>
            <ChartCredit />
          </div>
          <div className="panel posp">
            <PositionsTabs table onSelectSymbol={select} />
          </div>
        </section>
        <aside className="panel op">
          <OrderPanel key={s.code} symbol={s} sideRequest={sideReq} />
        </aside>
      </div>
    );
  }

  return (
    <div className="page page-trade">
      <MobileHead s={s} onPick={() => setPicker(true)} />
      <TfBar tf={tf} onChange={changeTf} />
      <div className="chart-box">
        <KChart symbol={s.code} timeframe={tf} digits={s.digits} positionLines={lines} />
      </div>
      <ChartCredit />
      <MyPositionsHere s={s} />
      <div className="m-actbar">
        {(['sell', 'buy'] as const).map((x) => (
          <TradeButton key={x} s={s} side={x} onOpen={setSheet} />
        ))}
      </div>
      <OrderSheet symbol={s} side={sheet} onClose={() => setSheet(null)} />
      <Modal open={picker} title={t('trade.pickSymbol')} onClose={() => setPicker(false)} size="md">
        <SymbolList selected={s.code} onSelect={select} />
      </Modal>
    </div>
  );
}

function TradeButton({ s, side, onOpen }: { s: SymbolInfo; side: Side; onOpen: (side: Side) => void }) {
  const { t } = useTranslation();
  const q = useQuote(s.code);
  return (
    <button type="button" className={`big-btn ${side}`} onClick={() => onOpen(side)}>
      <small>{t(`side.${side}`)}</small>
      <b className="num">{q ? formatPrice(side === 'buy' ? q.ask : q.bid, s.digits) : '—'}</b>
    </button>
  );
}
