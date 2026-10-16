/**
 * 电脑版顶栏跑马灯（v2 E4，验收 AC2-17）：滚动显示"热门"品种（品种表的 hot 标记）的卖价和当日涨跌幅。
 * - 只在 1280 宽以上显示（1024–1279 的电脑布局顶栏放不下，手机布局没有顶栏），窄屏不渲染、不占资源。
 * - 数据只用现有的品种列表和行情推送（useSymbols、useQuotes），不新增接口；原型模式下同样有数据。
 * - 涨跌色用语义色 .up / .down（跟随用户的涨跌色设置，约定 8）。
 * - 鼠标悬停或键盘聚焦时暂停；点击进入该品种交易页。
 * - 系统设置了"减少动态效果"（prefers-reduced-motion）时不滚动，改为静态横排（放不下的部分可以横向滚动查看）。
 * 滚动做法：同一组品种渲染两遍，整条向左移动一半宽度后回到起点，看起来首尾相接；第二遍只是视觉副本，读屏和键盘都跳过。
 */
import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Quote, SymbolInfo } from '../api/types';
import { useSymbols } from '../app/contexts';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { quoteDirection, useQuotes } from '../hooks/useQuotes';
import { useChange } from '../hooks/useSymbolFilter';
import { formatPercent, formatPrice } from '../lib/format';
import { symbolName } from '../lib/symbol';

const TICKER_QUERY = '(min-width: 1280px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** 每个品种在屏幕上停留的大致秒数，整圈时长 = 品种数 × 这个值 */
const SECONDS_PER_ITEM = 4;

const Item = memo(function Item({ s, q, lang, copy }: { s: SymbolInfo; q?: Quote; lang: string; copy: boolean }) {
  const { chg, up } = useChange(q);
  const dir = quoteDirection(s.code);
  const flash = dir === 'up' ? 'flash-up' : dir === 'down' ? 'flash-down' : '';
  const name = symbolName(s, lang);
  return (
    <Link
      to={`/trade/${s.code}`}
      className="ticker-item"
      title={name}
      tabIndex={copy ? -1 : undefined}
      data-testid={copy ? undefined : `ticker-${s.code}`}
    >
      <b className="num">{s.code}</b>
      <span key={q?.bid} className={`ticker-px num ${flash}`}>
        {q ? formatPrice(q.bid, s.digits) : '—'}
      </span>
      <span className={`ticker-chg num ${chg === null ? '' : up ? 'up' : 'down'}`}>{chg !== null ? formatPercent(chg, { sign: true }) : '—'}</span>
    </Link>
  );
});

function Ticker() {
  const { t, i18n } = useTranslation();
  const { list } = useSymbols();
  const quotes = useQuotes();
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  const hot = list.filter((s) => s.hot);
  if (hot.length === 0) return null;
  const group = (copy: boolean) => (
    <div className="ticker-group" aria-hidden={copy || undefined}>
      {hot.map((s) => (
        <Item key={s.code} s={s} q={quotes[s.code]} lang={i18n.language} copy={copy} />
      ))}
    </div>
  );
  return (
    <nav className={`ticker${reduced ? ' static' : ''}`} aria-label={t('market.ticker')} data-testid="hot-ticker">
      <div className="ticker-track" style={{ animationDuration: `${hot.length * SECONDS_PER_ITEM}s` }}>
        {group(false)}
        {!reduced && group(true)}
      </div>
    </nav>
  );
}

export function HotTicker() {
  const wide = useMediaQuery(TICKER_QUERY);
  return wide ? <Ticker /> : null;
}
