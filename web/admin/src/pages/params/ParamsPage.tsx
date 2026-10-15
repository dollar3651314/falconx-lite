/**
 * 交易参数（全局）：追保线、强平线（保证金水平 %）。杠杆上限和维持保证金率按品种配置，在"品种与行情"里改。
 */
import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Descriptions, Form, Input, Skeleton } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { getTradingParams, updateTradingParams } from '../../api';
import { useApi } from '../../hooks/useApi';
import { useHighRisk } from '../../hooks/useConfirmDialogs';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState } from '../../components/ErrorState';
import { PermButton } from '../../components/PermButton';
import { Num } from '../../components/Num';
import { compareAmounts } from '../../utils/money';
import { isValidPercent } from '../../utils/validators';

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
      initialValues: { marginCallLevel: data.marginCallLevel, liquidationLevel: data.liquidationLevel },
      extra: (
        <>
          <Form.Item
            name="marginCallLevel"
            label={t('params.marginCall')}
            required
            rules={[{ validator: (_r, v: string | undefined) => (isValidPercent(v ?? '') ? Promise.resolve() : Promise.reject(new Error(t('validation.percentFormat')))) }]}
          >
            <Input suffix="%" inputMode="decimal" />
          </Form.Item>
          <Form.Item
            name="liquidationLevel"
            label={t('params.liquidation')}
            required
            dependencies={['marginCallLevel']}
            rules={[
              ({ getFieldValue }) => ({
                validator: (_r, v: string | undefined) => {
                  if (!isValidPercent(v ?? '')) return Promise.reject(new Error(t('validation.percentFormat')));
                  const call = getFieldValue('marginCallLevel') as string;
                  if (isValidPercent(call ?? '') && compareAmounts(v!, call) >= 0) return Promise.reject(new Error(t('validation.liqBelowCall')));
                  return Promise.resolve();
                },
              }),
            ]}
          >
            <Input suffix="%" inputMode="decimal" />
          </Form.Item>
        </>
      ),
      onConfirm: (v) => updateTradingParams({ marginCallLevel: String(v.marginCallLevel).trim(), liquidationLevel: String(v.liquidationLevel).trim() }, v.reason),
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
              <div className="v down">{data.liquidationLevel}%</div>
              <div className="muted">{t('params.liquidationHint')}</div>
            </div>
            <div className="card stat">
              <div className="k">{t('params.throttle')}</div>
              <div className="v">{t('params.minutes', { count: data.marginCallThrottleMinutes })}</div>
              <div className="muted">{t('params.throttleHint')}</div>
            </div>
            <div className="card stat">
              <div className="k">{t('params.updated')}</div>
              <div className="v" style={{ fontSize: 14 }}>
                <Num>{data.updatedAt}</Num>
              </div>
              <div className="muted">{data.updatedBy}</div>
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
