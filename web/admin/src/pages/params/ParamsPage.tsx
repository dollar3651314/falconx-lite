/**
 * 交易参数（全局）：追保线（保证金水平 %）和追保通知间隔。
 * 没有账户级强平线：按品种维持保证金率逐仓强平（后台方案 G6、第 9 节），强平线一栏只显示说明文字。
 * 杠杆上限和维持保证金率按品种配置，在"品种与行情"里改。
 */
import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Descriptions, Form, Input, InputNumber, Skeleton } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { getTradingParams, updateTradingParams } from '../../api';
import { useApi } from '../../hooks/useApi';
import { useHighRisk } from '../../hooks/useConfirmDialogs';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState } from '../../components/ErrorState';
import { PermButton } from '../../components/PermButton';
import { Num } from '../../components/Num';
import { isValidPercent } from '../../utils/validators';
import { fullTime } from '../../utils/display';

export function ParamsPage() {
  const { t } = useTranslation();
  const fetcher = useCallback(() => getTradingParams(), []);
  const { data, loading, error, reload } = useApi(fetcher);
  const hr = useHighRisk();

  const edit = () => {
    if (!data) return;
    hr.ask({
      title: t('params.edit'),
      description: t('params.editDesc'),
      initialValues: { marginCallLevel: data.marginCallLevel, marginCallThrottleMinutes: data.marginCallThrottleMinutes },
      extra: (
        <>
          <Form.Item
            name="marginCallLevel"
            label={t('params.marginCall')}
            required
            rules={[{ validator: (_r, v: string | undefined) => (isValidPercent(String(v ?? '')) ? Promise.resolve() : Promise.reject(new Error(t('validation.percentFormat')))) }]}
          >
            <Input suffix="%" inputMode="decimal" />
          </Form.Item>
          <Form.Item
            name="marginCallThrottleMinutes"
            label={t('params.throttle')}
            rules={[{ required: true, type: 'integer', min: 1, max: 100000, message: t('validation.positiveInteger') }]}
          >
            <InputNumber style={{ width: '100%' }} min={1} max={100000} precision={0} addonAfter={t('params.minuteUnit')} />
          </Form.Item>
        </>
      ),
      onConfirm: (v) => updateTradingParams({ marginCallLevel: String(v.marginCallLevel).trim(), marginCallThrottleMinutes: Number(v.marginCallThrottleMinutes) }, v.reason),
      onDone: reload,
    });
  };

  return (
    <>
      <PageHeader
        title={t('params.title')}
        sub={t('params.sub')}
        extra={
          <PermButton perm="params:edit" type="primary" icon={<EditOutlined />} onClick={edit} disabled={!data}>
            {t('common.edit')}
          </PermButton>
        }
      />
      {error ? (
        <div className="card">
          <ErrorState error={error} onRetry={reload} />
        </div>
      ) : !data || loading ? (
        <div className="card card-pad">
          <Skeleton active />
        </div>
      ) : (
        <>
          <section className="detail-grid">
            <div className="card stat">
              <div className="k">{t('params.marginCall')}</div>
              <div className="v">{data.marginCallLevel}%</div>
              <div className="muted">{t('params.marginCallHint')}</div>
            </div>
            <div className="card stat">
              <div className="k">{t('params.liquidation')}</div>
              <div className="v" style={{ fontSize: 14 }}>{t('params.liquidationIsolated')}</div>
              <div className="muted">
                <Link to="/market/symbols">{t('menu.symbols')}</Link>
              </div>
            </div>
            <div className="card stat">
              <div className="k">{t('params.throttle')}</div>
              <div className="v">{t('params.minutes', { count: data.marginCallThrottleMinutes })}</div>
              <div className="muted">{t('params.throttleHint')}</div>
            </div>
            <div className="card stat">
              <div className="k">{t('params.updated')}</div>
              <div className="v" style={{ fontSize: 14 }}>
                <Num>{fullTime(data.updatedAt)}</Num>
              </div>
              <div className="muted">{data.updatedBy ?? '—'}</div>
            </div>
          </section>
          <div className="card card-pad">
            <h2 className="card-title">{t('params.formula')}</h2>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label={t('params.levelLabel')}>{t('params.levelFormula')}</Descriptions.Item>
              <Descriptions.Item label={t('params.marginLabel')}>{t('params.marginFormula')}</Descriptions.Item>
            </Descriptions>
          </div>
          <Alert
            type="info"
            showIcon
            message={
              <span>
                {t('params.perSymbolHint')} <Link to="/market/symbols">{t('menu.symbols')}</Link>
              </span>
            }
          />
        </>
      )}
      {hr.element}
    </>
  );
}
