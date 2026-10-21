/**
 * 电脑交易页左栏（体验优化 1021 第 7 条，方案 UX-7）。Amos："左侧行情红绿在跳，k 线也一直在跳，眼花了……可以收起或者只显示自选过的产品名称"。
 * 三种状态，记在这个浏览器（localStorage `fx.trade.wl`）：
 * - names（默认）：只列自选品种的代码和名称，不显示买卖价、不闪色；点一下切换图表；
 * - full：原来的完整列表（搜索、分类、买卖价、涨跌），用来找品种、加自选；
 * - collapsed：收成一条窄边，图表更宽。
 * 自选没设置过时默认是热门品种（useFavorites，原来的规则）；全部取消后显示空状态和"浏览全部品种"。
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSymbols } from '../app/contexts';
import { useFavorites } from '../hooks/useFavorites';
import type { WatchMode } from '../hooks/useWatchMode';
import { symbolName } from '../lib/symbol';
import { EmptyState } from './AsyncView';
import { Icon } from './Icon';
import { StatusTags, SymbolList } from './SymbolList';

export function WatchRail({ mode, onMode, selected, onSelect }: { mode: WatchMode; onMode: (m: WatchMode) => void; selected: string; onSelect: (code: string) => void }) {
  const { t, i18n } = useTranslation();
  const { list } = useSymbols();
  const hot = useMemo(() => list.filter((s) => s.hot).map((s) => s.code), [list]);
  const fav = useFavorites(hot);
  const favs = useMemo(() => list.filter((s) => fav.list.includes(s.code)), [list, fav.list]);

  if (mode === 'collapsed') {
    return (
      <div className="wl-rail">
        <button type="button" className="wl-icon-btn" onClick={() => onMode('names')} aria-label={t('trade.wl.expand')} title={t('trade.wl.expand')}>
          <Icon name="chevronRight" size={16} strokeWidth={2.4} />
        </button>
        <span className="wl-rail-label">{t('trade.wl.title')}</span>
      </div>
    );
  }

  const head = (
    <div className="wl-head">
      <div className="wl-tabs" role="tablist" aria-label={t('trade.wl.title')}>
        <button type="button" role="tab" aria-selected={mode === 'names'} className={mode === 'names' ? 'on' : ''} onClick={() => onMode('names')}>
          <Icon name="star" size={13} strokeWidth={2.2} />
          {t('trade.wl.title')}
        </button>
        <button type="button" role="tab" aria-selected={mode === 'full'} className={mode === 'full' ? 'on' : ''} onClick={() => onMode('full')}>
          {t('trade.wl.all')}
        </button>
      </div>
      <button type="button" className="wl-icon-btn" onClick={() => onMode('collapsed')} aria-label={t('trade.wl.collapse')} title={t('trade.wl.collapse')}>
        <Icon name="back" size={16} strokeWidth={2.4} />
      </button>
    </div>
  );

  if (mode === 'full') {
    return (
      <div className="wl-box">
        {head}
        <SymbolList selected={selected} onSelect={onSelect} variant="side" initialCategory="all" />
      </div>
    );
  }

  return (
    <div className="wl-box">
      {head}
      {favs.length === 0 ? (
        <EmptyState
          compact
          title={t('trade.wl.emptyTitle')}
          hint={t('trade.wl.emptyHint')}
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onMode('full')}>
              {t('trade.wl.browse')}
            </button>
          }
        />
      ) : (
        <>
          <ul className="wl-names" aria-label={t('trade.wl.title')}>
            {favs.map((s) => (
              <li key={s.code}>
                <button type="button" className={`wl-name${s.code === selected ? ' on' : ''}`} aria-current={s.code === selected || undefined} onClick={() => onSelect(s.code)}>
                  <b className="num">{s.code}</b>
                  <small>{symbolName(s, i18n.language)}</small>
                  <StatusTags s={s} />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="wl-manage" onClick={() => onMode('full')}>
            <Icon name="plus" size={14} strokeWidth={2.2} />
            {t('trade.wl.manage')}
          </button>
        </>
      )}
    </div>
  );
}
