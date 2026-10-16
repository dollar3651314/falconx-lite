/**
 * 行情面板（v2 需求 4.2，方向 A：和客户端行情表同一个样子）。电脑版在首屏右栏，有"走势"小图；手机版在第二屏，三列。
 * 每一行都是去注册页的链接（"点品种跳到注册页"）。休市显示"休市"、没有报价显示"暂无报价"，不显示价格。
 */
import { useState } from 'react';
import { CATEGORIES, clientLink, SYMBOL_META, symbolName, type Category } from '../config';
import { useQuotes } from '../hooks/useQuotes';
import { useI18n } from '../i18n';
import { direction, formatPct, formatPrice } from '../lib/format';
import type { Row } from '../lib/quotes';

function Spark({ values, up }: { values: number[]; up: boolean }) {
  const w = 90;
  const h = 22;
  if (values.length < 2) return <svg className="spark" width={w} height={h} aria-hidden="true" />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const d = values
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * w).toFixed(1)},${(2 + (h - 4) * (1 - (v - min) / (max - min || 1))).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke={up ? 'var(--long)' : 'var(--short)'} strokeWidth={1.5} />
    </svg>
  );
}

function QuoteRow({ row, desktop }: { row: Row; desktop: boolean }) {
  const { t, lang } = useI18n();
  const name = symbolName(row.symbol, lang, row);
  const open = row.status === 'OPEN' && row.bid !== null;
  const dir = open && row.changePct !== null ? direction(row.changePct) : 'flat';
  const offText = row.status === 'CLOSED' ? t('board.closed') : row.status === 'LOADING' ? '—' : t('board.noQuote');
  return (
    <a
      className="q-row"
      href={clientLink('register', lang)}
      data-testid="quote-row"
      data-symbol={row.symbol}
      data-status={row.status}
      data-flash={row.flash ?? ''}
      aria-label={t('board.rowLabel', { name: `${row.symbol} ${name}` })}
    >
      {row.flash && <span key={row.flashSeq} className={`flash-layer flash-${row.flash}`} data-testid="flash" />}
      <div className="q-name">
        <b>{row.symbol}</b>
        <span>{name}</span>
      </div>
      {desktop && <div className="q-spark">{open && <Spark values={row.history} up={dir !== 'down'} />}</div>}
      {open ? (
        <div className="q-px num" data-testid="bid">
          {formatPrice(row.bid as string)}
        </div>
      ) : (
        <div className="q-px off" data-testid="bid-off">
          {offText}
        </div>
      )}
      <div className="q-chg num">
        {open && row.changePct !== null ? <span className={`chip ${dir}`}>{formatPct(row.changePct)}</span> : <span className="chip off">—</span>}
      </div>
    </a>
  );
}

export function QuoteBoard({ desktop }: { desktop: boolean }) {
  const { t, lang } = useI18n();
  const { rows, sample } = useQuotes();
  const [cat, setCat] = useState<Category>('hot');
  const shown = cat === 'hot' ? rows : rows.filter((r) => SYMBOL_META[r.symbol]?.category === cat);
  return (
    <div className="card board" data-testid="quote-board">
      <div className="board-head">
        <h2>
          <i className="live" aria-hidden="true" />
          {t('board.title')}
        </h2>
        {sample && (
          <span className="tag-sample" title={t('board.sampleNote')} data-testid="sample-tag">
            {t('board.sample')}
          </span>
        )}
      </div>
      <div className="tabs" role="tablist" aria-label={t('board.tabsLabel')}>
        {CATEGORIES.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={cat === c} onClick={() => setCat(c)}>
            {t(`cat.${c}`)}
          </button>
        ))}
      </div>
      {desktop && (
        <div className="q-head" aria-hidden="true">
          <span>{t('board.colSymbol')}</span>
          <span>{t('board.colTrend')}</span>
          <span>{t('board.colBid')}</span>
          <span>{t('board.colChange')}</span>
        </div>
      )}
      <div role="tabpanel">
        {shown.length === 0 ? <div className="q-empty">{t('board.empty')}</div> : shown.map((r) => <QuoteRow key={r.symbol} row={r} desktop={desktop} />)}
      </div>
      <div className="board-foot">
        {desktop && <span>{t('board.footHint')}</span>}
        <a href={clientLink('register', lang)}>{t('board.all')}</a>
      </div>
      <p className="board-note" data-testid="board-note">
        {t(sample ? 'board.sampleNote' : 'board.liveNote')}
      </p>
    </div>
  );
}
