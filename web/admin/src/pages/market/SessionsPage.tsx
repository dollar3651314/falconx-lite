/**
 * 交易时段和假期：时段按品种分类配置（UTC），假期可整天休市或提前收盘。
 */
import { useCallback, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Radio, Select, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { addHoliday, deleteHoliday, listHolidays, listSessions } from '../../api';
import type { Holiday, TradingSession } from '../../api/types';
import { useApi } from '../../hooks/useApi';
import { useAction } from '../../hooks/useConfirmDialogs';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import { PermButton } from '../../components/PermButton';
import { Pill } from '../../components/Pill';
import { Num } from '../../components/Num';
import { localName } from '../../utils/display';

interface HolidayForm {
  date: string;
  sessionId: string;
  nameZh: string;
  nameEn: string;
  closure: 'full' | 'early';
  closeTime?: string;
}

export function SessionsPage() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const run = useAction();
  const sFetcher = useCallback(() => listSessions(), []);
  const hFetcher = useCallback(() => listHolidays(), []);
  const sessions = useApi(sFetcher);
  const holidays = useApi(hFetcher);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<HolidayForm>();

  const sessionName = (id: string) => {
    const s = sessions.data?.find((x) => x.id === id);
    return s ? localName(i18n.language, s.nameZh, s.nameEn) : id;
  };

  const submit = async () => {
    let v: HolidayForm;
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    setBusy(true);
    const ok = await run(() => addHoliday({ ...v, closeTime: v.closure === 'early' ? v.closeTime ?? null : null }), t('sessions.added'), holidays.reload);
    setBusy(false);
    if (ok) {
      setAdding(false);
      form.resetFields();
    }
  };

  return (
    <>
      <PageHeader title={t('sessions.title')} sub={t('sessions.sub')} />
      <DataTable<TradingSession>
        rowKey="id"
        loading={sessions.loading}
        error={sessions.error}
        onRetry={sessions.reload}
        dataSource={sessions.data}
        columns={[
          { title: t('sessions.name'), key: 'n', render: (_, r) => <b>{localName(i18n.language, r.nameZh, r.nameEn)}</b> },
          {
            title: t('sessions.ranges'),
            key: 'r',
            render: (_, r) => (
              <Space direction="vertical" size={0}>
                {r.ranges.map((x, i) => (
                  <Num key={i}>
                    {t(`weekday.${x.fromDay}`)} {x.fromTime} – {t(`weekday.${x.toDay}`)} {x.toTime}
                  </Num>
                ))}
              </Space>
            ),
          },
          { title: t('sessions.dailyBreak'), dataIndex: 'dailyBreak', render: (v: string | null) => (v ? <Num>{v}</Num> : t('sessions.noBreak')) },
          { title: t('sessions.symbolCount'), dataIndex: 'symbolCount', align: 'right', render: (v: number) => <Num>{v}</Num> },
        ]}
      />
      <Alert type="info" showIcon message={t('sessions.utcHint')} />
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
          { title: t('sessions.market'), dataIndex: 'sessionId', render: (v: string) => sessionName(v) },
          { title: t('sessions.holidayName'), key: 'n', render: (_, r) => localName(i18n.language, r.nameZh, r.nameEn) },
          {
            title: t('sessions.closure'),
            key: 'c',
            render: (_, r) => (r.closure === 'full' ? <Pill tone="danger">{t('sessions.full')}</Pill> : <Pill tone="pend">{t('sessions.earlyAt', { time: r.closeTime })}</Pill>),
          },
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
        <Form form={form} layout="vertical" name="holiday" initialValues={{ closure: 'full' }} preserve={false}>
          <Form.Item name="date" label={t('sessions.date')} rules={[{ required: true, pattern: /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, message: t('validation.dateFormat') }]}>
            <Input placeholder="2026-12-31" inputMode="numeric" />
          </Form.Item>
          <Form.Item name="sessionId" label={t('sessions.market')} rules={[{ required: true, message: t('validation.required') }]}>
            <Select options={(sessions.data ?? []).map((s) => ({ value: s.id, label: localName(i18n.language, s.nameZh, s.nameEn) }))} />
          </Form.Item>
          <Form.Item name="nameZh" label={t('sessions.nameZh')} rules={[{ required: true, whitespace: true, message: t('validation.required') }]}>
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item name="nameEn" label={t('sessions.nameEn')} rules={[{ required: true, whitespace: true, message: t('validation.required') }]}>
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item name="closure" label={t('sessions.closure')}>
            <Radio.Group
              options={[
                { value: 'full', label: t('sessions.full') },
                { value: 'early', label: t('sessions.early') },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.closure !== b.closure}>
            {({ getFieldValue }) =>
              getFieldValue('closure') === 'early' ? (
                <Form.Item name="closeTime" label={t('sessions.closeTime')} rules={[{ required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: t('validation.timeFormat') }]}>
                  <Input placeholder="18:00" />
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
