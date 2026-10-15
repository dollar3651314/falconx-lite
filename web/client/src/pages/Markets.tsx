/**
 * 行情（UI 风格 C）。
 * 手机：品种列表，每行显示卖价 / 买价和涨跌色块（效果图 assets/v1/ui-research/C-手机.png 第 ① 屏）。
 * 桌面：宽表格，多出来的宽度用来放点差、最高、最低、今日走势和卖 / 买按钮（效果图 C-桌面-行情页.png）。
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { getSparklines } from '../api/market';
import type { Quote, Side, SymbolInfo } from '../api/types';
import { Icon } from '../components/Icon';
import { InstallPrompt } from '../components/InstallPrompt';
import { PageHeader } from '../components/Layout';
import { CatTabs, ListState, SearchBox, StatusTags, SymbolList } from '../components/SymbolList';
import { useChange, useSymbolFilter } from '../hooks/useSymbolFilter';
import { useAsync } from '../hooks/useAsync';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { quoteDirection, useQuotes } from '../hooks/useQuotes';
import { useUnread } from '../hooks/useUnread';
import { formatPercent, formatPrice } from '../lib/format';
import { spreadPoints, symbolName } from '../lib/symbol';

/** 迷你走势图：收盘价折线，颜色跟随今日涨跌 */
export function Sparkline({ closes, up }: { closes?: string[]; up: boolean }) {
  if (!closes || closes.length < 2) return <span className="spark-empty">—</span>;
  const v = closes.map(Number);
  const max = Math.max(...v);
  const min = Math.min(...v);
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${((i * 80) / (v.length - 1)).toFixed(1)},${(22 - (20 * (x - min)) / (max - min || 1)).toFixed(1)}`).join('');
  return (
    <svg className={`spark ${up ? 'up' : 'down'}`} width="80" height="24" viewBox="0 0 80 24" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const TableRow = memo(function TableRow({ s, q, closes, fav, onFav, onOpen, lang }: { s: SymbolInfo; q?: Quote; closes?: string[]; fav: boolean; onFav: (c: string) => void; onOpen: (c: string, side?: Side) => void; lang: string }) {
  const { t } = useTranslation();
  const { chg, up } = useChange(q);
  const dir = quoteDirection(s.code);
  const spread = q ? spreadPoints(q, s.digits) : null;
  return (
    <tr onClick={() => onOpen(s.code)} className="mt-row">
      <td className="mt-fav">
        <button
          type="button"
          className={`star-btn${fav ? ' on' : ''}`}
          aria-pressed={fav}
          aria-label={fav ? t('market.removeFav') : t('market.addFav')}
          onClick={(e) => {
            e.stopPropagation();
            onFav(s.code);
          }}
        >
          <Icon name="star" size={15} strokeWidth={2} />
        </button>
      </td>
      <td className="mt-name">
        <div>
          <Link to={`/trade/${s.code}`} onClick={(e) => e.stopPropagation()}>
            <b className="num">{s.code}</b>
          </Link>
          <span>{symbolName(s, lang)}</span>
          <StatusTags s={s} />
        </div>
      </td>
      <td key={q?.bid} className={`num r down ${dir === 'up' ? 'flash-up' : dir === 'down' ? 'flash-down' : ''}`}>
        {q ? formatPrice(q.bid, s.digits) : '—'}
      </td>
      <td className="num r up">{q ? formatPrice(q.ask, s.digits) : '—'}</td>
      <td className="num r muted">{spread ?? '—'}</td>
      <td className={`num r ${up ? 'up' : 'down'}`}>{chg !== null ? formatPercent(chg, { sign: true }) : '—'}</td>
      <td className="num r">{q ? formatPrice(q.high, s.digits) : '—'}</td>
      <td className="num r">{q ? formatPrice(q.low, s.digits) : '—'}</td>
      <td className="r">
        <Sparkline closes={closes} up={up} />
      </td>
      <td className="r mt-act">
        <div>
          {(['sell', 'buy'] as const).map((side) => (
            <button
              key={side}
              type="button"
              className={`px-btn sm ${side}`}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(s.code, side);
              }}
            >
              {t(`side.${side}Short`)}
            </button>
          ))}
        </div>
      </td>
    </tr>
  );
});

function DesktopMarkets() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const quotes = useQuotes();
  const f = useSymbolFilter('all');
  const sparks = useAsync(getSparklines, 'sparklines');
  const open = (code: string, side?: Side) => navigate(side ? `/trade/${code}?side=${side}` : `/trade/${code}`);
  return (
    <div className="page page-markets-d">
      <div className="mt-bar">
        <h1>{t('nav.markets')}</h1>
        <CatTabs f={f} pills />
        <SearchBox f={f} />
      </div>
      <div className="panel mt-panel">
        {f.filtered.length === 0 ? (
          <ListState f={f} />
        ) : (
          <table className="mt-table">
            <thead>
              <tr>
                <th aria-label={t('market.favorites')} />
                <th>{t('market.symbol')}</th>
                <th className="r">{t('market.bid')}</th>
                <th className="r">{t('market.ask')}</th>
                <th className="r">{t('market.spread')}</th>
                <th className="r">{t('market.change')}</th>
                <th className="r">{t('market.high')}</th>
                <th className="r">{t('market.low')}</th>
                <th className="r">{t('market.trend')}</th>
                <th className="r">{t('market.trade')}</th>
              </tr>
            </thead>
            <tbody>
              {f.filtered.map((s) => (
                <TableRow key={s.code} s={s} q={quotes[s.code]} closes={sparks.data?.[s.code]} fav={f.fav.has(s.code)} onFav={f.fav.toggle} onOpen={open} lang={i18n.language} />
              ))}
            </tbody>
          </table>
        )}
        {f.list.length > 0 && <div className="sym-count">{t('market.count', { shown: f.filtered.length, total: f.list.length })}</div>}
      </div>
      <p className="footnote">{t('market.footnote')}</p>
    </div>
  );
}

function MobileMarkets() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const unread = useUnread();
  return (
    <div className="page page-markets">
      <PageHeader
        title={t('nav.markets')}
        right={
          <Link to="/me/notifications" className="icon-btn" aria-label={t('me.notifications')}>
            <Icon name="bell" />
            {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
          </Link>
        }
      />
      <div className="mx-install">
        <InstallPrompt />
      </div>
      <div className="flush-list">
        <SymbolList onSelect={(c) => navigate(`/trade/${c}`)} />
      </div>
      <p className="footnote">{t('market.footnote')}</p>
    </div>
  );
}

export default function Markets() {
  return useIsDesktop() ? <DesktopMarkets /> : <MobileMarkets />;
}
