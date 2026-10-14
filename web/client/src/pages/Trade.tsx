/**
 * 交易页。手机：效果图 M1（品种切换、K 线、账户条、买卖按钮、持仓页签，下单为底部弹出）；
 * 桌面 ≥1024：效果图 M5 三栏（行情列表 | K 线 + 持仓表 | 下单面板）。
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { TIMEFRAMES } from '../api/market';
import type { Side, SymbolInfo, Timeframe } from '../api/types';
import { useAccount, useSymbols } from '../app/contexts';
import { EmptyState, ErrorState, Loading } from '../components/AsyncView';
import { Icon } from '../components/Icon';
import { KChart } from '../components/KChart';
import { Modal } from '../components/Modal';
import { OrderPanel } from '../components/OrderPanel';
import { PositionsTabs } from '../components/PositionsTabs';
import { StatusTags, SymbolList } from '../components/SymbolList';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { useQuote } from '../hooks/useQuotes';
import { cmp, dec, sub, ZERO } from '../lib/decimal';
import { formatAmount, formatDecimal, formatPercent, formatPrice } from '../lib/format';
import { symbolName } from '../lib/symbol';
import { changePercent, marginLevelTone } from '../lib/trading';

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

function SymbolHead({ s, onPick, desktop }: { s: SymbolInfo; onPick?: () => void; desktop?: boolean }) {
  const { t, i18n } = useTranslation();
  const q = useQuote(s.code);
  const chg = q ? changePercent(q.open, q.bid) : null;
  const diff = q ? sub(dec(q.bid), dec(q.open)) : null;
  const up = chg === null || cmp(chg, ZERO) >= 0;
  const cls = up ? 'up' : 'down';
  if (desktop) {
    return (
      <div className="sym-head-d">
        <div className="nm">
          <b className="num">{s.code}</b>
          <small>{symbolName(s, i18n.language)}</small>
          <StatusTags s={s} />
        </div>
        <div className={`px num ${cls}`}>{q ? formatPrice(q.bid, s.digits) : '—'}</div>
        <div className="st">
          {t('trade.change')}
          <span className={`num ${cls}`}>{diff !== null && chg !== null ? `${formatDecimal(diff, s.digits, { sign: true })} (${formatPercent(chg, { sign: true })})` : '—'}</span>
        </div>
        <div className="st">
          {t('trade.bidAsk')}
          <span className="num">{q ? `${formatPrice(q.bid, s.digits)} / ${formatPrice(q.ask, s.digits)}` : '—'}</span>
        </div>
        <div className="st">
          {t('trade.high')}
          <span className="num">{q ? formatPrice(q.high, s.digits) : '—'}</span>
        </div>
        <div className="st">
          {t('trade.low')}
          <span className="num">{q ? formatPrice(q.low, s.digits) : '—'}</span>
        </div>
      </div>
    );
  }
  return (
    <header className="trade-head">
      <div>
        <button type="button" className="sym-pick" onClick={onPick} aria-haspopup="dialog">
          <b className="num">{s.code}</b>
          <span>{symbolName(s, i18n.language)}</span>
          <Icon name="chevronDown" size={14} strokeWidth={2.4} />
        </button>
        <div className="ba">
          {t('side.sellShort')} <span className="num down">{q ? formatPrice(q.bid, s.digits) : '—'}</span>
          <span aria-hidden="true"> / </span>
          {t('side.buyShort')} <span className="num up">{q ? formatPrice(q.ask, s.digits) : '—'}</span>
          <StatusTags s={s} />
        </div>
      </div>
      <div className="last">
        <div className={`p num ${cls}`}>{q ? formatPrice(q.bid, s.digits) : '—'}</div>
        <span className={`chg num ${cls} ${up ? 'bg-up' : 'bg-down'}`}>{diff !== null && chg !== null ? `${formatDecimal(diff, s.digits, { sign: true })} · ${formatPercent(chg, { sign: true })}` : '—'}</span>
      </div>
    </header>
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

function AccountStrip() {
  const { t } = useTranslation();
  const { metrics, error } = useAccount();
  const tone = marginLevelTone(metrics?.marginLevel ?? null);
  return (
    <section className="acct-strip">
      <div>
        {t('account.equity')}
        <span className="num">{error && !metrics ? '—' : formatAmount(metrics?.equity)}</span>
      </div>
      <div>
        {t('account.available')}
        <span className="num">{error && !metrics ? '—' : formatAmount(metrics?.available)}</span>
      </div>
      <div>
        {t('account.marginLevel')}
        <span className={`num tone-${tone}`}>
          {metrics?.marginLevel ? formatPercent(metrics.marginLevel, { dp: 1 }) : metrics ? t('account.noPosition') : '—'}
          {metrics?.marginLevel && <span className={`pill pill-${tone}`}>{t(`account.level.${tone}`)}</span>}
        </span>
      </div>
    </section>
  );
}

function TradeButtons({ s, onOpen }: { s: SymbolInfo; onOpen: (side: Side) => void }) {
  const { t } = useTranslation();
  const q = useQuote(s.code);
  const spread = q ? sub(dec(q.ask), dec(q.bid)) : null;
  return (
    <section className="trade-btns">
      <button type="button" className="big-btn sell" onClick={() => onOpen('sell')}>
        <small>{t('side.sell')}</small>
        <b className="num">{q ? formatPrice(q.bid, s.digits) : '—'}</b>
      </button>
      <button type="button" className="big-btn buy" onClick={() => onOpen('buy')}>
        <small>{t('side.buy')}</small>
        <b className="num">{q ? formatPrice(q.ask, s.digits) : '—'}</b>
      </button>
      <span className="spread num">
        {t('trade.spread')} {spread !== null ? formatDecimal(spread, s.digits) : '—'}
      </span>
    </section>
  );
}

export default function Trade() {
  const { t, i18n } = useTranslation();
  const { symbol: param } = useParams();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const { map, list, loading, error, reload } = useSymbols();
  const { positions } = useAccount();
  const [tf, setTf] = useState<Timeframe>(() => (TIMEFRAMES.includes(readLocal(TF_KEY) as Timeframe) ? (readLocal(TF_KEY) as Timeframe) : '15m'));
  const [sheet, setSheet] = useState<Side | null>(null);
  const [picker, setPicker] = useState(false);

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
          <SymbolList selected={s.code} onSelect={select} />
        </aside>
        <section className="center">
          <div className="panel chartp">
            <SymbolHead s={s} desktop />
            <TfBar tf={tf} onChange={changeTf} />
            <KChart symbol={s.code} timeframe={tf} digits={s.digits} positionLines={lines} />
            <p className="chart-credit">
              {t('chart.credit')}{' '}
              <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer noopener">
                TradingView
              </a>
            </p>
          </div>
          <div className="panel posp">
            <PositionsTabs table onSelectSymbol={select} />
          </div>
        </section>
        <aside className="panel op">
          <OrderPanel key={s.code} symbol={s} inline />
        </aside>
      </div>
    );
  }

  return (
    <div className="page page-trade">
      <SymbolHead s={s} onPick={() => setPicker(true)} />
      <TfBar tf={tf} onChange={changeTf} />
      <div className="chart-box">
        <KChart symbol={s.code} timeframe={tf} digits={s.digits} positionLines={lines} />
      </div>
      <p className="chart-credit">
        {t('chart.credit')}{' '}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer noopener">
          TradingView
        </a>
      </p>
      <AccountStrip />
      <TradeButtons s={s} onOpen={setSheet} />
      <PositionsTabs onSelectSymbol={select} />
      <Modal open={sheet !== null} title={<span className="num">{s.code}</span>} subtitle={`${symbolName(s, i18n.language)} · ${t('order.title')}`} onClose={() => setSheet(null)} size="md">
        {sheet && <OrderPanel key={`${s.code}-${sheet}`} symbol={s} initialSide={sheet} onDone={() => setSheet(null)} />}
      </Modal>
      <Modal open={picker} title={t('trade.pickSymbol')} onClose={() => setPicker(false)} size="md">
        <SymbolList selected={s.code} onSelect={select} />
      </Modal>
    </div>
  );
}
