/**
 * 品种列表（UI 风格 C）。
 * - variant="mobile"：手机行情页、手机切换品种面板。每行：品种 | 卖价 / 买价上下两行 | 涨跌色块。
 * - variant="side"：桌面交易页左栏。每行：品种 | 卖价 | 买价 | 涨跌。
 * 桌面行情页是宽表格，见 pages/Markets.tsx，分类和搜索用这里导出的 useSymbolFilter / FilterBar。
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Quote, SymbolInfo } from '../api/types';
import { CATEGORIES, useChange, useSymbolFilter, type Category, type SymbolFilter } from '../hooks/useSymbolFilter';
import { quoteDirection, useQuotes } from '../hooks/useQuotes';
import { formatPercent, formatPrice } from '../lib/format';
import { symbolName } from '../lib/symbol';
import { EmptyState, ErrorState, Loading } from './AsyncView';
import { Icon } from './Icon';


export function StatusTags({ s }: { s: SymbolInfo }) {
  const { t } = useTranslation();
  return (
    <>
      {s.openPaused && <span className="status-tag paused">{t('market.paused')}</span>}
      {!s.tradingOpen && <span className="status-tag closed">{t('market.closed')}</span>}
    </>
  );
}

export function SearchBox({ f, autoFocus }: { f: SymbolFilter; autoFocus?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="search">
      <Icon name="search" size={15} />
      <input type="search" value={f.q} onChange={(e) => f.setQ(e.target.value)} placeholder={t('market.search')} aria-label={t('market.search')} autoFocus={autoFocus} />
    </div>
  );
}

export function CatTabs({ f, pills }: { f: SymbolFilter; pills?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`cats${pills ? ' pills' : ''}`} role="tablist" aria-label={t('market.categories')}>
      {CATEGORIES.map((c) => (
        <button key={c} type="button" role="tab" aria-selected={f.cat === c} className={f.cat === c ? 'on' : ''} onClick={() => f.setCat(c)}>
          {c === 'fav' && <Icon name="star" size={13} strokeWidth={2.2} />}
          {c === 'fav' ? t('market.favorites') : t(`market.cat.${c}`)}
        </button>
      ))}
    </div>
  );
}

/** 列表状态：出错 / 加载中 / 空 */
export function ListState({ f }: { f: SymbolFilter }) {
  const { t } = useTranslation();
  if (f.error && f.list.length === 0) return <ErrorState error={f.error} onRetry={f.reload} compact />;
  if (f.loading && f.list.length === 0) return <Loading rows={5} />;
  if (f.filtered.length === 0) {
    if (f.list.length === 0) return <EmptyState compact title={t('market.emptyAll')} />;
    if (f.cat === 'fav' && !f.q) return <EmptyState compact title={t('market.emptyFav')} hint={t('market.emptyFavHint')} />;
    return <EmptyState compact title={t('market.emptySearch')} hint={t('market.emptySearchHint')} />;
  }
  return null;
}

const Row = memo(function Row({ s, q, selected, onSelect, lang, variant }: { s: SymbolInfo; q?: Quote; selected: boolean; onSelect: (c: string) => void; lang: string; variant: 'mobile' | 'side' }) {
  const { chg, up } = useChange(q);
  const dir = quoteDirection(s.code);
  const flash = dir === 'up' ? 'flash-up' : dir === 'down' ? 'flash-down' : '';
  return (
    <li>
      <button type="button" className={`sym-row${selected ? ' on' : ''}`} onClick={() => onSelect(s.code)} aria-current={selected || undefined}>
        <span className="sym-name">
          <b className="num">{s.code}</b>
          <small>
            <span className="sym-cn">{symbolName(s, lang)}</span>
            <StatusTags s={s} />
          </small>
        </span>
        {variant === 'mobile' ? (
          <span key={q?.bid} className={`sym-ba num ${flash}`}>
            <span className="down">{q ? formatPrice(q.bid, s.digits) : '—'}</span>
            <span className="up">{q ? formatPrice(q.ask, s.digits) : '—'}</span>
          </span>
        ) : (
          <>
            <span key={q?.bid} className={`sym-price num down ${flash}`}>
              {q ? formatPrice(q.bid, s.digits) : '—'}
            </span>
            <span className="sym-price num up">{q ? formatPrice(q.ask, s.digits) : '—'}</span>
          </>
        )}
        <span className="sym-chg num">
          <span className={variant === 'mobile' ? (up ? 'pill-up' : 'pill-down') : up ? 'up' : 'down'}>{chg !== null ? formatPercent(chg, { sign: true }) : '—'}</span>
        </span>
      </button>
    </li>
  );
});

export function SymbolList({ selected, onSelect, autoFocus, initialCategory = 'all', variant = 'mobile' }: { selected?: string; onSelect: (code: string) => void; autoFocus?: boolean; initialCategory?: Category; variant?: 'mobile' | 'side' }) {
  const { t, i18n } = useTranslation();
  const quotes = useQuotes();
  const f = useSymbolFilter(initialCategory);
  return (
    <div className={`sym-list v-${variant}`}>
      <SearchBox f={f} autoFocus={autoFocus} />
      <CatTabs f={f} />
      <div className="sym-head" aria-hidden="true">
        <span>{t('market.symbol')}</span>
        {variant === 'mobile' ? (
          <span>{t('market.bidAsk')}</span>
        ) : (
          <>
            <span>{t('market.bid')}</span>
            <span>{t('market.ask')}</span>
          </>
        )}
        <span>{t('market.change')}</span>
      </div>
      {f.filtered.length === 0 ? (
        <ListState f={f} />
      ) : (
        <ul className="sym-rows">
          {f.filtered.map((s) => (
            <Row key={s.code} s={s} q={quotes[s.code]} selected={s.code === selected} onSelect={onSelect} lang={i18n.language} variant={variant} />
          ))}
        </ul>
      )}
      {f.list.length > 0 && <div className="sym-count">{t('market.count', { shown: f.filtered.length, total: f.list.length })}</div>}
    </div>
  );
}
