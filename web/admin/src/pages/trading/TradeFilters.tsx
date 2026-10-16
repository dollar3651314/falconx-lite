/** 交易监控三个页面共用的筛选条：品种、方向、客户（订单页多一个状态） */
import { useCallback, useState } from 'react';
import { Input, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { listTradeSymbols } from '../../api';
import type { OrderStatus, TradeQuery } from '../../api/types';
import { useApi } from '../../hooks/useApi';
import { FilterBar, FilterItem } from '../../components/FilterBar';

export type TradeFilterValues = Omit<TradeQuery, 'page' | 'pageSize'>;

export function TradeFilters({ onChange, withStatus }: { onChange: (f: TradeFilterValues) => void; withStatus?: boolean }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<TradeFilterValues>({});
  const fetcher = useCallback(() => listTradeSymbols(), []);
  const symbols = useApi(fetcher);
  return (
    <FilterBar onSearch={() => onChange(draft)} onReset={() => { setDraft({}); onChange({}); }}>
      <FilterItem label={t('trading.symbol')}>
        <Select
          aria-label={t('trading.symbol')}
          allowClear
          showSearch
          style={{ width: 130 }}
          placeholder={t('common.all')}
          value={draft.symbol}
          onChange={(v) => setDraft({ ...draft, symbol: v })}
          options={(symbols.data ?? []).map((s) => ({ value: s, label: s }))}
        />
      </FilterItem>
      <FilterItem label={t('trading.side')}>
        <Select aria-label={t('trading.side')} allowClear style={{ width: 100 }} placeholder={t('common.all')} value={draft.side} onChange={(v) => setDraft({ ...draft, side: v })} options={(['buy', 'sell'] as const).map((s) => ({ value: s, label: t(`side.${s}`) }))} />
      </FilterItem>
      {withStatus ? (
        <FilterItem label={t('trading.status')}>
          <Select<OrderStatus>
            aria-label={t('trading.status')}
            allowClear
            style={{ width: 110 }}
            placeholder={t('common.all')}
            value={draft.status}
            onChange={(v) => setDraft({ ...draft, status: v })}
            options={(['filled', 'pending', 'cancelled'] as const).map((s) => ({ value: s, label: t(`orderStatus.${s}`) }))}
          />
        </FilterItem>
      ) : null}
      <FilterItem label={t('funds.user')} htmlFor="t-kw">
        <Input id="t-kw" allowClear style={{ width: 200 }} placeholder={t('trading.keywordPh')} value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} />
      </FilterItem>
    </FilterBar>
  );
}
