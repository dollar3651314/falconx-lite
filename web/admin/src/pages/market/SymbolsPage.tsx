/**
 * 品种列表（第一版 50 个）和编辑：最小 / 最大手数、手数步长、最大杠杆、维持保证金率、开仓手续费率、
 * 多空隔夜费率（没有费率的标红：不收隔夜费）、统一加点、热门标记、排序、启用/停用。
 * 字段按后端（后台方案第 9 节）：没有报价映射（S20 接 LP 时再定）和按点数的加点；合约大小只读。
 * 改维持保证金率、手续费率只影响以后开的仓；有持仓或挂单的品种不能停用。
 * v2 E3：右上角"新增品种"（高危，SymbolCreateDrawer），新增后默认暂停开仓，在"编辑"里打开（暂停开仓开关）。
 * v2 E6："最后报价时间"列：开市时超过 1 分钟没报价标红，从没报价显示"暂无报价"，休市不标红；每 5 秒静默刷新（可暂停）。
 */
import { useState } from 'react';
import { Alert, Button, Drawer, Form, Input, InputNumber, Select, Space, Switch, Tooltip } from 'antd';
import { EditOutlined, FireFilled, PlusOutlined, WarningFilled } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { listSymbols, setSymbolEnabled, updateSymbol } from '../../api';
import type { SymbolPatch, SymbolQuery, TradingSymbol } from '../../api/types';
import { CATEGORIES } from '../../config/constants';
import { usePagedList } from '../../hooks/usePagedList';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import { AutoRefreshControl } from '../../components/AutoRefreshControl';
import { SymbolCreateDrawer } from './SymbolCreateDrawer';
import { useHighRisk } from '../../hooks/useConfirmDialogs';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader } from '../../components/PageHeader';
import { FilterBar, FilterItem } from '../../components/FilterBar';
import { DataTable } from '../../components/DataTable';
import { PermButton } from '../../components/PermButton';
import { Pill } from '../../components/Pill';
import { Num } from '../../components/Num';
import { compareAmounts, formatAmount, formatRatePercent } from '../../utils/money';
import { localName, quoteFreshness, shortTime, fullTime } from '../../utils/display';
import { isValidRate } from '../../utils/validators';

type Filters = Omit<SymbolQuery, 'page' | 'pageSize'>;

/** 手数：正数，最多 8 位小数（后端口径） */
const LOTS_RE = /^(0\.\d{1,8}|[1-9]\d*(\.\d{1,8})?)$/;

interface EditValues {
  contractSize: string;
  minLots: string;
  maxLots: string;
  lotStep: string;
  maxLeverage: number;
  maintenanceMarginRate: string;
  openFeeRate: string;
  swapLong: string;
  swapShort: string;
  markup: string;
  hot: boolean;
  sortOrder: number;
  openPaused: boolean;
}

function SwapCell({ value }: { value: string | null }) {
  const { t } = useTranslation();
  if (value === null)
    return (
      <span className="swap-missing">
        <WarningFilled /> {t('symbols.swapMissing')}
      </span>
    );
  return <Num className={value.startsWith('-') ? 'down' : 'up'}>{formatRatePercent(value, 4)}</Num>;
}

/** 最后报价时间（v2 E6） */
function QuoteTimeCell({ s }: { s: TradingSymbol }) {
  const { t } = useTranslation();
  const f = quoteFreshness(s);
  if (f === 'disabled') return <span className="muted">—</span>;
  if (f === 'none')
    return (
      <span className={`quote-time${s.tradingOpen ? ' stale' : ' muted'}`} title={t('symbols.noQuoteHint')}>
        {s.tradingOpen ? <WarningFilled /> : null} {t('symbols.noQuote')}
      </span>
    );
  return (
    <span className={`quote-time${f === 'stale' ? ' stale' : ''}`} title={f === 'stale' ? t('symbols.quoteStaleHint', { time: fullTime(s.lastQuoteAt) }) : fullTime(s.lastQuoteAt)}>
      {f === 'stale' ? <WarningFilled aria-label={t('symbols.quoteStale')} /> : null} <Num>{shortTime(s.lastQuoteAt)}</Num>
      {f === 'closed' ? <span className="muted"> · {t('symbols.marketClosed')}</span> : null}
    </span>
  );
}

export function SymbolsPage() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const list = usePagedList<TradingSymbol, Filters>(listSymbols, {}, 20);
  const [draft, setDraft] = useState<Filters>({});
  const [editing, setEditing] = useState<TradingSymbol | null>(null);
  const [creating, setCreating] = useState(false);
  const auto = useAutoRefresh(list.refresh, 5000);
  const [form] = Form.useForm<EditValues>();
  const hr = useHighRisk();

  const openEdit = (s: TradingSymbol) => {
    setEditing(s);
    form.setFieldsValue({ ...s, swapLong: s.swapLong ?? '', swapShort: s.swapShort ?? '' });
  };

  const save = async () => {
    if (!editing) return;
    let v: EditValues;
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    const patch: SymbolPatch = {
      minLots: v.minLots.trim(),
      maxLots: v.maxLots.trim(),
      lotStep: v.lotStep.trim(),
      maxLeverage: v.maxLeverage,
      maintenanceMarginRate: v.maintenanceMarginRate.trim(),
      openFeeRate: v.openFeeRate.trim(),
      markup: v.markup.trim(),
      hot: v.hot,
      sortOrder: v.sortOrder,
      openPaused: v.openPaused,
      swapLong: v.swapLong.trim() === '' ? null : v.swapLong.trim(),
      swapShort: v.swapShort.trim() === '' ? null : v.swapShort.trim(),
    };
    const code = editing.code;
    hr.ask({
      title: t('symbols.saveConfirm', { code }),
      description: t('symbols.saveDesc'),
      onConfirm: (r) => updateSymbol(code, patch, r.reason),
      onDone: () => {
        setEditing(null);
        list.reload();
      },
    });
  };

  const toggleEnabled = (s: TradingSymbol) =>
    hr.ask({
      title: s.enabled ? t('symbols.pauseConfirm', { code: s.code }) : t('symbols.enableConfirm', { code: s.code }),
      description: s.enabled ? t('symbols.pauseDesc') : t('symbols.enableDesc'),
      onConfirm: (r) => setSymbolEnabled(s.code, !s.enabled, r.reason),
      onDone: list.reload,
    });

  const rateRule = (required: boolean) => ({
    validator: (_r: unknown, v: string | undefined) => {
      const text = (v ?? '').trim();
      if (!text) return required ? Promise.reject(new Error(t('validation.required'))) : Promise.resolve();
      return isValidRate(text) ? Promise.resolve() : Promise.reject(new Error(t('validation.rateFormat')));
    },
  });

  return (
    <>
      <PageHeader
        title={t('symbols.title')}
        sub={t('symbols.sub')}
        extra={
          <>
            <AutoRefreshControl auto={auto} />
            <PermButton perm="symbol:create" type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              {t('symbols.create')}
            </PermButton>
          </>
        }
      />
      <FilterBar onSearch={() => list.setFilters(draft)} onReset={() => { setDraft({}); list.setFilters({}); }}>
        <FilterItem label={t('symbols.category')}>
          <Select aria-label={t('symbols.category')} allowClear style={{ width: 150 }} placeholder={t('common.all')} value={draft.category} onChange={(v) => setDraft({ ...draft, category: v })} options={CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) }))} />
        </FilterItem>
        <FilterItem label={t('symbols.enabled')}>
          <Select
            aria-label={t('symbols.enabled')}
            allowClear
            style={{ width: 110 }}
            placeholder={t('common.all')}
            value={draft.enabled === undefined ? undefined : String(draft.enabled)}
            onChange={(v) => setDraft({ ...draft, enabled: v === undefined ? undefined : v === 'true' })}
            options={[
              { value: 'true', label: t('symbols.on') },
              { value: 'false', label: t('symbols.off') },
            ]}
          />
        </FilterItem>
        <FilterItem label={t('symbols.keyword')} htmlFor="s-kw">
          <Input id="s-kw" allowClear style={{ width: 180 }} placeholder={t('symbols.keywordPh')} value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} />
        </FilterItem>
        <FilterItem label={t('symbols.swap')}>
          <Select
            aria-label={t('symbols.swap')}
            allowClear
            style={{ width: 140 }}
            placeholder={t('common.all')}
            value={draft.missingSwap ? 'missing' : undefined}
            onChange={(v) => setDraft({ ...draft, missingSwap: v === 'missing' ? true : undefined })}
            options={[{ value: 'missing', label: t('symbols.onlyMissingSwap') }]}
          />
        </FilterItem>
      </FilterBar>
      <Alert type="warning" showIcon message={t('symbols.swapHint')} />
      <DataTable<TradingSymbol>
        rowKey="code"
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        dataSource={list.data?.items}
        total={list.data?.total ?? 0}
        page={list.page}
        pageSize={list.pageSize}
        onPageChange={list.onPageChange}
        columns={[
          {
            title: t('symbols.code'),
            dataIndex: 'code',
            fixed: 'left',
            render: (v: string, r) => (
              <div className="user-cell">
                <b className="num">
                  {v} {r.hot ? <FireFilled style={{ color: '#ea580c' }} aria-label={t('symbols.hot')} /> : null}
                </b>
                <small>{localName(i18n.language, r.nameZh, r.nameEn)}</small>
              </div>
            ),
          },
          { title: t('symbols.category'), dataIndex: 'category', render: (v: string) => t(`category.${v}`) },
          { title: t('symbols.contractSize'), dataIndex: 'contractSize', align: 'right', render: (v: string) => <Num>{formatAmount(v, { decimals: 0 })}</Num> },
          { title: t('symbols.lotsRange'), key: 'lots', align: 'right', render: (_, r) => <Num>{r.minLots} – {r.maxLots} / {r.lotStep}</Num> },
          { title: t('symbols.maxLeverage'), dataIndex: 'maxLeverage', align: 'right', render: (v: number) => <Num>{v}x</Num> },
          { title: t('symbols.mmr'), dataIndex: 'maintenanceMarginRate', align: 'right', render: (v: string) => <Num>{formatRatePercent(v, 2)}</Num> },
          { title: t('symbols.fee'), dataIndex: 'openFeeRate', align: 'right', render: (v: string) => <Num>{formatRatePercent(v, 3)}</Num> },
          { title: t('symbols.swapLong'), dataIndex: 'swapLong', align: 'right', render: (v: string | null) => <SwapCell value={v} /> },
          { title: t('symbols.swapShort'), dataIndex: 'swapShort', align: 'right', render: (v: string | null) => <SwapCell value={v} /> },
          { title: t('symbols.spread'), dataIndex: 'markup', align: 'right', render: (v: string) => <Num>{v}</Num> },
          { title: t('symbols.lastQuoteAt'), key: 'lastQuoteAt', render: (_, r) => <QuoteTimeCell s={r} /> },
          {
            title: t('symbols.enabled'),
            dataIndex: 'enabled',
            render: (v: boolean, r) => (
              <Space size={4}>
                <Pill tone={v ? 'ok' : 'pend'}>{v ? t('symbols.on') : t('symbols.off')}</Pill>
                {r.openPaused ? <Pill tone="danger">{t('symbols.openPaused')}</Pill> : null}
              </Space>
            ),
          },
          {
            title: t('common.actions'),
            key: 'op',
            fixed: 'right',
            render: (_, r) => (
              <Space size={4}>
                <PermButton perm="symbol:edit" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
                  {t('common.edit')}
                </PermButton>
                <PermButton perm="symbol:edit" size="small" danger={r.enabled} onClick={() => toggleEnabled(r)}>
                  {r.enabled ? t('symbols.pause') : t('symbols.enable')}
                </PermButton>
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? t('symbols.editTitle', { code: editing.code }) : ''}
        rootClassName="menu-drawer-root"
        width={Math.min(480, typeof window !== 'undefined' ? window.innerWidth : 480)}
        destroyOnClose
        footer={
          <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
            <Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Tooltip title={can('symbol:edit') ? undefined : t('common.noPermission')}>
              <Button type="primary" onClick={() => void save()} disabled={!can('symbol:edit')}>
                {t('common.save')}
              </Button>
            </Tooltip>
          </Space>
        }
      >
        {editing ? (
          <Form form={form} layout="vertical" name="symbol-edit" requiredMark>
            <Form.Item name="contractSize" label={t('symbols.contractSize')} extra={t('symbols.contractReadOnly')}>
              <Input disabled />
            </Form.Item>
            <Form.Item name="minLots" label={t('symbols.minLots')} rules={[{ required: true, pattern: LOTS_RE, message: t('validation.lotsFormat') }]}>
              <Input inputMode="decimal" />
            </Form.Item>
            <Form.Item
              name="maxLots"
              label={t('symbols.maxLots')}
              dependencies={['minLots']}
              rules={[
                { required: true, pattern: LOTS_RE, message: t('validation.lotsFormat') },
                ({ getFieldValue }) => ({
                  validator: (_r, v: string | undefined) =>
                    !v || !LOTS_RE.test(v) || !LOTS_RE.test(getFieldValue('minLots') ?? '') || compareAmounts(v, getFieldValue('minLots'), 8) >= 0
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('validation.maxLotsBelowMin'))),
                }),
              ]}
            >
              <Input inputMode="decimal" />
            </Form.Item>
            <Form.Item name="lotStep" label={t('symbols.lotStep')} rules={[{ required: true, pattern: LOTS_RE, message: t('validation.lotsFormat') }]}>
              <Input inputMode="decimal" />
            </Form.Item>
            <Form.Item name="maxLeverage" label={t('symbols.maxLeverage')} extra={t('symbols.leverageHint')} rules={[{ required: true, type: 'integer', min: 1, max: 1000, message: t('validation.leverageRange') }]}>
              <InputNumber style={{ width: '100%' }} min={1} max={1000} precision={0} addonAfter="x" />
            </Form.Item>
            <Form.Item name="maintenanceMarginRate" label={t('symbols.mmr')} extra={t('symbols.rateHint')} rules={[rateRule(true)]}>
              <Input inputMode="decimal" />
            </Form.Item>
            <Form.Item name="openFeeRate" label={t('symbols.fee')} extra={t('symbols.rateHint')} rules={[rateRule(true)]}>
              <Input inputMode="decimal" />
            </Form.Item>
            <Form.Item name="swapLong" label={t('symbols.swapLong')} extra={t('symbols.swapEditHint')} rules={[rateRule(false)]}>
              <Input inputMode="decimal" placeholder={t('symbols.swapMissing')} />
            </Form.Item>
            <Form.Item name="swapShort" label={t('symbols.swapShort')} extra={t('symbols.swapEditHint')} rules={[rateRule(false)]}>
              <Input inputMode="decimal" placeholder={t('symbols.swapMissing')} />
            </Form.Item>
            <Form.Item name="markup" label={t('symbols.spread')} extra={t('symbols.markupHint')} rules={[{ required: true, pattern: /^\d+(\.\d{1,8})?$/, message: t('validation.nonNegativeNumber') }]}>
              <Input inputMode="decimal" />
            </Form.Item>
            <Form.Item name="hot" label={t('symbols.hot')} valuePropName="checked" extra={t('symbols.hotHint')}>
              <Switch />
            </Form.Item>
            <Form.Item name="openPaused" label={t('symbols.openPausedLabel')} valuePropName="checked" extra={t('symbols.openPausedHint')}>
              <Switch />
            </Form.Item>
            <Form.Item name="sortOrder" label={t('symbols.sortOrder')} extra={t('symbols.sortOrderHint')} rules={[{ required: true, type: 'integer', min: 0, max: 100000, message: t('validation.positiveInteger') }]}>
              <InputNumber style={{ width: '100%' }} min={0} max={100000} precision={0} />
            </Form.Item>
          </Form>
        ) : null}
      </Drawer>
      <SymbolCreateDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(code) => {
          setCreating(false);
          setDraft({ keyword: code });
          list.setFilters({ keyword: code });
        }}
      />
      {hr.element}
    </>
  );
}
