/**
 * 汇率监控：非美元报价品种的盈亏和保证金按实时汇率折算成 USDT；汇率失效时相关品种自动禁止新开仓。
 */
import { useCallback } from 'react';
import { Alert, Button, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { listFxRates } from '../../api';
import type { FxRate } from '../../api/types';
import { useApi } from '../../hooks/useApi';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import { Pill } from '../../components/Pill';
import { Num } from '../../components/Num';

export function FxPage() {
  const { t } = useTranslation();
  const fetcher = useCallback(() => listFxRates(), []);
  const { data, loading, error, reload } = useApi(fetcher);
  const stale = data?.filter((r) => r.status === 'stale') ?? [];
  return (
    <>
      <PageHeader
        title={t('fx.title')}
        sub={t('fx.sub')}
        extra={
          <Button icon={<ReloadOutlined />} onClick={reload} loading={loading}>
            {t('common.refresh')}
          </Button>
        }
      />
      {stale.length ? (
        <Alert type="error" showIcon message={t('fx.staleAlert', { pairs: stale.map((s) => s.pair).join(', '), symbols: stale.flatMap((s) => s.affectedSymbols).join(', ') })} />
      ) : null}
      <DataTable<FxRate>
        rowKey="pair"
        loading={loading}
        error={error}
        onRetry={reload}
        dataSource={data}
        rowClassName={(r) => (r.status === 'stale' ? 'row-alert' : '')}
        columns={[
          { title: t('fx.pair'), dataIndex: 'pair', render: (v: string) => <b className="num">{v}</b> },
          { title: t('fx.rate'), dataIndex: 'rate', align: 'right', render: (v: string) => <Num>{v}</Num> },
          { title: t('fx.source'), dataIndex: 'source' },
          { title: t('fx.updatedAt'), dataIndex: 'updatedAt', render: (v: string) => <Num>{v}</Num> },
          { title: t('fx.age'), dataIndex: 'ageSeconds', align: 'right', render: (v: number) => <Num className={v > 60 ? 'down strong' : ''}>{t('fx.seconds', { count: v })}</Num> },
          { title: t('fx.status'), dataIndex: 'status', render: (v: string) => <Pill tone={v === 'ok' ? 'ok' : 'danger'}>{t(`fx.st.${v}`)}</Pill> },
          {
            title: t('fx.affected'),
            dataIndex: 'affectedSymbols',
            render: (v: string[]) => (
              <Space size={4} wrap style={{ maxWidth: 360 }}>
                {v.map((s) => (
                  <span key={s} className="chain-tag">{s}</span>
                ))}
              </Space>
            ),
          },
        ]}
      />
      <Alert type="info" showIcon message={t('fx.hint')} />
    </>
  );
}
