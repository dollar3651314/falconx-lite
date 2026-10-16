/**
 * 交易时段和休市日（后台方案第 9 节）：
 * - 交易时段按品种配置（UTC），第一版只读（改时段影响开仓和隔夜费）；
 * - 休市日挂在品种上（"*" 表示全部品种），只有全天休市，可以增删。
 */
import { useCallback, useMemo, useState } from 'react';
import { Alert, Button, DatePicker, Form, Grid, Input, Modal, Popconfirm, Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { addHoliday, deleteHoliday, listHolidays, listSessions } from '../../api';
import type { Holiday, HolidayInput, TradingSession } from '../../api/types';
import { useApi } from '../../hooks/useApi';
import { useAction } from '../../hooks/useConfirmDialogs';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader } from '../../components/PageHeader';
import { FilterBar, FilterItem } from '../../components/FilterBar';
import { DataTable } from '../../components/DataTable';
import { PermButton } from '../../components/PermButton';
import { Pill } from '../../components/Pill';
import { Num } from '../../components/Num';

const ALL = '*';
const DATE_FMT = 'YYYY-MM-DD';
/** 今天的 UTC 日期（休市日按 UTC，后端拒绝早于今天的日期） */
const todayUtc = () => new Date().toISOString().slice(0, 10);

/** 后端 day：1 = 周一 … 7 = 周日；翻译键 weekday.0 = 周日 */
const weekdayKey = (day: number) => `weekday.${day % 7}`;

export function SessionsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const run = useAction();
  const sFetcher = useCallback(() => listSessions(), []);
  const hFetcher = useCallback(() => listHolidays(), []);
  const sessions = useApi(sFetcher);
  const holidays = useApi(hFetcher);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<HolidayInput>();
  // 手机宽度下点日期框只弹日历、不弹键盘（键盘会把日历顶出屏幕）
  const screens = Grid.useBreakpoint();

  const rows = useMemo(
    () => (sessions.data ?? []).filter((s) => !filter || s.symbol.toLowerCase().includes(filter.toLowerCase())),
    [sessions.data, filter],
  );
  const symbolLabel = (s: string) => (s === ALL ? t('sessions.allSymbols') : s);

  const submit = async () => {
    let v: HolidayInput;
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    setBusy(true);
    const ok = await run(() => addHoliday({ symbol: v.symbol, date: v.date.trim(), reason: v.reason?.trim() || undefined }), t('sessions.added'), holidays.reload);
    setBusy(false);
    if (ok) {
      setAdding(false);
      form.resetFields();
    }
  };

  return (
    <>
      <PageHeader title={t('sessions.title')} sub={t('sessions.sub')} />
      <Alert type="info" showIcon message={t('sessions.utcHint')} description={t('sessions.readOnlyHint')} />
      <FilterBar onSearch={() => setFilter(keyword.trim())} onReset={() => { setKeyword(''); setFilter(''); }}>
        <FilterItem label={t('sessions.symbol')} htmlFor="ss-kw">
          <Input id="ss-kw" allowClear style={{ width: 180 }} placeholder={t('symbols.keywordPh')} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </FilterItem>
      </FilterBar>
      <DataTable<TradingSession>
        rowKey="symbol"
        loading={sessions.loading}
        error={sessions.error}
        onRetry={sessions.reload}
        dataSource={rows}
        columns={[
          { title: t('sessions.symbol'), dataIndex: 'symbol', render: (v: string) => <b className="num">{v}</b> },
          {
            title: t('sessions.ranges'),
            key: 'r',
            render: (_, r) => (
              <span className="session-ranges">
                {r.ranges.map((x, i) => (
                  <Num key={i}>
                    {t(weekdayKey(x.day))} {x.open}–{x.close}
                  </Num>
                ))}
              </span>
            ),
          },
        ]}
      />
      <div className="page-header">
        <div className="page-header-text">
          <h1 style={{ fontSize: 15 }}>{t('sessions.holidays')}</h1>
          <span className="page-sub">{t('sessions.holidaysSub')}</span>
        </div>
        <div className="page-header-extra">
          <PermButton perm="session:edit" type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
            {t('sessions.addHoliday')}
          </PermButton>
        </div>
      </div>
      <DataTable<Holiday>
        rowKey="id"
        loading={holidays.loading}
        error={holidays.error}
        onRetry={holidays.reload}
        dataSource={holidays.data}
        emptyText={t('sessions.noHolidays')}
        columns={[
          { title: t('sessions.date'), dataIndex: 'date', render: (v: string) => <Num>{v}</Num> },
          { title: t('sessions.symbol'), dataIndex: 'symbol', render: (v: string) => (v === ALL ? <Pill tone="danger">{symbolLabel(v)}</Pill> : <b className="num">{v}</b>) },
          { title: t('sessions.holidayReason'), dataIndex: 'reason', render: (v: string | null) => v ?? '—' },
          { title: t('sessions.closure'), key: 'c', render: () => <Pill tone="danger">{t('sessions.full')}</Pill> },
          {
            title: t('common.actions'),
            key: 'op',
            fixed: 'right',
            render: (_, r) =>
              can('session:edit') ? (
                <Popconfirm title={t('sessions.deleteConfirm')} okText={t('common.delete')} cancelText={t('common.cancel')} onConfirm={() => run(() => deleteHoliday(r.id), t('common.deleted'), holidays.reload)}>
                  <Button size="small" danger>
                    {t('common.delete')}
                  </Button>
                </Popconfirm>
              ) : (
                <PermButton perm="session:edit" size="small" danger>
                  {t('common.delete')}
                </PermButton>
              ),
          },
        ]}
      />
      <Modal open={adding} title={t('sessions.addHoliday')} okText={t('common.save')} cancelText={t('common.cancel')} confirmLoading={busy} onOk={() => void submit()} onCancel={() => setAdding(false)} destroyOnClose>
        <Form form={form} layout="vertical" name="holiday" initialValues={{ symbol: ALL }} preserve={false}>
          {/* 休市日是"在日历上选一天"（近期、要看星期几），用 antd DatePicker；表单值仍是 YYYY-MM-DD 字符串（技术方案/v2-日期输入.md） */}
          <Form.Item
            name="date"
            label={t('sessions.date')}
            extra={t('sessions.dateHint')}
            rules={[{ required: true, message: t('validation.required') }]}
            getValueProps={(v: string | undefined) => ({ value: v ? dayjs(v) : null })}
            normalize={(d: Dayjs | null) => (d ? d.format(DATE_FMT) : '')}
          >
            <DatePicker
              style={{ width: '100%' }}
              format={DATE_FMT}
              placeholder={DATE_FMT}
              disabledDate={(d) => d.format(DATE_FMT) < todayUtc()}
              inputReadOnly={!screens.md}
              showNow={false}
            />
          </Form.Item>
          <Form.Item name="symbol" label={t('sessions.symbol')} rules={[{ required: true, message: t('validation.required') }]}>
            <Select
              showSearch
              options={[{ value: ALL, label: symbolLabel(ALL) }, ...(sessions.data ?? []).map((s) => ({ value: s.symbol, label: s.symbol }))]}
            />
          </Form.Item>
          <Form.Item name="reason" label={t('sessions.holidayReason')} rules={[{ max: 128 }]}>
            <Input maxLength={128} placeholder={t('sessions.reasonPh')} />
          </Form.Item>
          <Alert type="info" showIcon message={t('sessions.fullOnlyHint')} />
        </Form>
      </Modal>
    </>
  );
}
