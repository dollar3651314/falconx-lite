/**
 * 品种列表：分类 + 搜索 + 实时报价。行情页、桌面交易页左栏、手机品种切换面板共用。
 */
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Quote, SymbolCategory, SymbolInfo } from '../api/types';
import { useSymbols } from '../app/contexts';
import { quoteDirection, useQuotes } from '../hooks/useQuotes';
import { cmp, ZERO } from '../lib/decimal';
import { formatPercent, formatPrice } from '../lib/format';
import { symbolName } from '../lib/symbol';
import { changePercent } from '../lib/trading';
import { EmptyState, ErrorState, Loading } from './AsyncView';
import { Icon } from './Icon';

export type Category = 'all' | 'hot' | SymbolCategory;
const CATS: Category[] = ['all', 'hot', 'fx', 'metal', 'index', 'energy', 'crypto', 'stock'];

export function StatusTags({ s }: { s: SymbolInfo }) {
  const { t } = useTranslation();
  return (
    <>
      {s.openPaused && <span className="status-tag paused">{t('market.paused')}</span>}
      {!s.tradingOpen && <span className="status-tag closed">{t('market.closed')}</span>}
    </>
  );
}

const Row = memo(function Row({ s, q, selected, onSelect, lang, showAsk }: { s: SymbolInfo; q?: Quote; selected: boolean; onSelect: (c: string) => void; lang: string; showAsk?: boolean }) {
  const chg = q ? changePercent(q.open, q.bid) : null;
  const dir = quoteDirection(s.code);
  const up = chg !== null && cmp(chg, ZERO) >= 0;
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
        <span key={q?.bid} className={`sym-price num ${dir === 'up' ? 'flash-up' : dir === 'down' ? 'flash-down' : ''}`}>
          {q ? formatPrice(q.bid, s.digits) : '—'}
        </span>
        {showAsk && <span className="sym-price num ask">{q ? formatPrice(q.ask, s.digits) : '—'}</span>}
        <span className="sym-chg num">
          <span className={up ? 'up bg-up' : 'down bg-down'}>{chg !== null ? formatPercent(chg, { sign: true }) : '—'}</span>
        </span>
      </button>
    </li>
  );
});

export function SymbolList({ selected, onSelect, showAsk, autoFocus, initialCategory = 'all' }: { selected?: string; onSelect: (code: string) => void; showAsk?: boolean; autoFocus?: boolean; initialCategory?: Category }) {
  const { t, i18n } = useTranslation();
  const { list, loading, error, reload } = useSymbols();
  const quotes = useQuotes();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category>(initialCategory);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return list.filter(
      (s) =>
        (cat === 'all' || (cat === 'hot' ? s.hot : s.category === cat)) &&
        (!k || s.code.toLowerCase().includes(k) || s.nameZh.toLowerCase().includes(k) || s.nameEn.toLowerCase().includes(k)),
    );
  }, [list, q, cat]);

  return (
    <div className="sym-list">
      <div className="search">
        <Icon name="search" size={15} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('market.search')}
          aria-label={t('market.search')}
          autoFocus={autoFocus}
        />
      </div>
      <div className="cats" role="tablist" aria-label={t('market.categories')}>
        {CATS.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={cat === c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
            {t(`market.cat.${c}`)}
          </button>
        ))}
      </div>
      <div className={`sym-head${showAsk ? ' with-ask' : ''}`} aria-hidden="true">
        <span>{t('market.symbol')}</span>
        <span>{t('market.bid')}</span>
        {showAsk && <span>{t('market.ask')}</span>}
        <span>{t('market.change')}</span>
      </div>
      {error && list.length === 0 ? (
        <ErrorState error={error} onRetry={reload} compact />
      ) : loading && list.length === 0 ? (
        <Loading rows={5} />
      ) : filtered.length === 0 ? (
        <EmptyState compact title={list.length === 0 ? t('market.emptyAll') : t('market.emptySearch')} hint={list.length === 0 ? undefined : t('market.emptySearchHint')} />
      ) : (
        <ul className={`sym-rows${showAsk ? ' with-ask' : ''}`}>
          {filtered.map((s) => (
            <Row key={s.code} s={s} q={quotes[s.code]} selected={s.code === selected} onSelect={onSelect} lang={i18n.language} showAsk={showAsk} />
          ))}
        </ul>
      )}
      {list.length > 0 && <div className="sym-count">{t('market.count', { shown: filtered.length, total: list.length })}</div>}
    </div>
  );
}
