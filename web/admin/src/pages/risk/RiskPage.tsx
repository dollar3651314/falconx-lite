/**
 * 风控看板（效果图 M7）：全局暂停、自动强平开关（高危）；平台总净敞口和阈值；品种净敞口表（暂停/恢复）；
 * 单用户持仓上限；最近风控事件。第一版唯一的自动规则：净敞口超阈值 → 自动禁止新开仓并通知风控。
 */
import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Form, Input, Skeleton, Switch, Tooltip } from 'antd';
import { EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { getRiskOverview, setAutoLiquidation, setGlobalPause, setPerUserLimit, setPlatformThreshold, setSymbolPaused, setSymbolThreshold } from '../../api';
import type { RiskEvent, SymbolExposure } from '../../api/types';
import { useApi } from '../../hooks/useApi';
import { useHighRisk } from '../../hooks/useConfirmDialogs';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState } from '../../components/ErrorState';
import { DataTable } from '../../components/DataTable';
import { PermButton } from '../../components/PermButton';
import { Pill } from '../../components/Pill';
import { Num } from '../../components/Num';
import { exposureTone } from '../../utils/status';
import { formatAmount, usagePercent } from '../../utils/money';
import { localName, shortTime } from '../../utils/display';
import { isPositiveInteger } from '../../utils/validators';

function UsageBar({ net, threshold }: { net: string; threshold: string }) {
  const u = usagePercent(net, threshold);
  const cls = u >= 100 ? 'over' : u >= 80 ? 'warn' : '';
  return (
    <span className="usage">
      <span className={`bar ${cls}`} role="img" aria-label={`${u}%`}>
        <i style={{ width: `${Math.min(u, 100)}%` }} />
      </span>
      <Num className={u >= 100 ? 'down' : u >= 80 ? 'text-warn' : ''}>{u}%</Num>
    </span>
  );
}

export function RiskPage() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const fetcher = useCallback(() => getRiskOverview(), []);
  const { data, loading, error, reload } = useApi(fetcher);
  const hr = useHighRisk();

  const thresholdField = (name: string, label: string) => (
    <Form.Item
      name={name}
      label={label}
      required
      rules={[{ validator: (_r, v: string | undefined) => (isPositiveInteger(v ?? '') ? Promise.resolve() : Promise.reject(new Error(t('validation.positiveInteger')))) }]}
    >
      <Input inputMode="numeric" suffix="USD" />
    </Form.Item>
  );

  const toggleGlobal = (on: boolean) =>
    hr.ask({
      title: on ? t('risk.globalPauseOn') : t('risk.globalPauseOff'),
      description: on ? t('risk.globalPauseOnDesc') : t('risk.globalPauseOffDesc'),
      onConfirm: (v) => setGlobalPause(on, v.reason),
      onDone: reload,
    });

  const toggleAutoLiq = (on: boolean) =>
    hr.ask({
      title: on ? t('risk.autoLiqOn') : t('risk.autoLiqOff'),
      description: on ? t('risk.autoLiqOnDesc') : t('risk.autoLiqOffDesc'),
      onConfirm: (v) => setAutoLiquidation(on, v.reason),
      onDone: reload,
    });

  const pauseSymbol = (e: SymbolExposure, pause: boolean) =>
    hr.ask({
      title: pause ? t('risk.pauseSymbol', { symbol: e.symbol }) : t('risk.resumeSymbol', { symbol: e.symbol }),
      description: pause
        ? t('risk.pauseDesc', { symbol: e.symbol })
        : e.status === 'auto_blocked'
          ? t('risk.resumeAutoDesc', { symbol: e.symbol, net: formatAmount(e.netUsd, { decimals: 0, showPlus: true }), threshold: formatAmount(e.thresholdUsd, { decimals: 0 }) })
          : t('risk.resumeDesc', { symbol: e.symbol }),
      onConfirm: (v) => setSymbolPaused(e.symbol, pause, v.reason),
      onDone: reload,
    });

  const editSymbolThreshold = (e: SymbolExposure) =>
    hr.ask({
      title: t('risk.editThreshold', { symbol: e.symbol }),
      description: t('risk.thresholdDesc', { current: formatAmount(e.thresholdUsd, { decimals: 0 }) }),
      initialValues: { threshold: e.thresholdUsd },
      extra: thresholdField('threshold', t('risk.newThreshold')),
      onConfirm: (v) => setSymbolThreshold(e.symbol, String(v.threshold).trim(), v.reason),
      onDone: reload,
    });

  const editPlatform = () =>
    data &&
    hr.ask({
      title: t('risk.editPlatformThreshold'),
      description: t('risk.platformThresholdDesc', { current: formatAmount(data.settings.platformThresholdUsd, { decimals: 0 }) }),
      initialValues: { threshold: data.settings.platformThresholdUsd },
      extra: thresholdField('threshold', t('risk.newThreshold')),
      onConfirm: (v) => setPlatformThreshold(String(v.threshold).trim(), v.reason),
      onDone: reload,
    });

  const editUserLimit = () =>
    data &&
    hr.ask({
      title: t('risk.editUserLimit'),
      description: t('risk.userLimitDesc', { current: formatAmount(data.settings.perUserLimitUsd, { decimals: 0 }) }),
      initialValues: { limit: data.settings.perUserLimitUsd },
      extra: thresholdField('limit', t('risk.userLimit')),
      onConfirm: (v) => setPerUserLimit(String(v.limit).trim(), v.reason),
      onDone: reload,
    });

  const eventText = (e: RiskEvent) =>
    t(`riskEvent.${e.type}`, {
      symbol: e.symbol ?? '',
      value: e.value && /^\d+$/.test(e.value) ? formatAmount(e.value, { decimals: 0 }) : e.value ?? '',
      threshold: e.threshold ? formatAmount(e.threshold, { decimals: 0 }) : '',
      reason: e.reason ?? '',
    });

  const s = data?.settings;
  const platformUsage = s ? usagePercent(s.platformNetUsd, s.platformThresholdUsd) : 0;

  return (
    <>
      <PageHeader
        title={t('risk.title')}
        sub={s ? t('risk.sub', { time: s.updatedAt.slice(11) }) : t('risk.subLoading')}
        extra={
          <Button icon={<ReloadOutlined />} onClick={reload} loading={loading}>
            {t('common.refresh')}
          </Button>
        }
      />
      <Alert type="info" showIcon message={t('risk.ruleTitle')} description={t('risk.ruleDesc')} />
      {error ? (
        <div className="card">
          <ErrorState error={error} onRetry={reload} />
        </div>
      ) : !data || !s ? (
        <div className="card card-pad">
          <Skeleton active paragraph={{ rows: 8 }} />
        </div>
      ) : (
        <>
          {s.globalPause ? <Alert type="error" showIcon message={t('risk.globalPausedBanner')} /> : null}
          <section className="risk-top">
            <div className="card switch-card">
              <div>
                <div className="t">
                  {t('risk.globalPause')} <span className="pill pill-danger">{t('highRisk.tag')}</span>
                </div>
                <div className="d">{t('risk.globalPauseHint')}</div>
              </div>
              <span>
                <span className="state">{s.globalPause ? t('common.on') : t('common.off')}</span>
                <Tooltip title={can('risk:global_pause') ? undefined : t('common.noPermission')}>
                  <Switch checked={s.globalPause} disabled={!can('risk:global_pause')} onChange={(v) => toggleGlobal(v)} aria-label={t('risk.globalPause')} />
                </Tooltip>
              </span>
            </div>
            <div className="card switch-card">
              <div>
                <div className="t">
                  {t('risk.autoLiq')} <span className="pill pill-danger">{t('highRisk.tag')}</span>
                </div>
                <div className="d">{t('risk.autoLiqHint')}</div>
              </div>
              <span>
                <span className="state">{s.autoLiquidation ? t('common.on') : t('common.off')}</span>
                <Tooltip title={can('risk:auto_liquidation') ? undefined : t('common.noPermission')}>
                  <Switch checked={s.autoLiquidation} disabled={!can('risk:auto_liquidation')} onChange={(v) => toggleAutoLiq(v)} aria-label={t('risk.autoLiq')} />
                </Tooltip>
              </span>
            </div>
            <div className="card exposure-card">
              <div className="row1">
                <span>{t('risk.platformNet')}</span>
                <span>
                  {t('risk.threshold')} <b className="num">{formatAmount(s.platformThresholdUsd, { decimals: 0 })}</b> USD{' '}
                  <PermButton perm="risk:threshold" type="link" size="small" icon={<EditOutlined />} aria-label={t('risk.editPlatformThreshold')} onClick={() => editPlatform()} />
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '2px 0 8px', flexWrap: 'wrap' }}>
                <span className="big">{formatAmount(s.platformNetUsd, { decimals: 0 })}</span>
                <Num className="muted">USD · {platformUsage}%</Num>
                {s.platformBlocked ? <Pill tone="danger">{t('exposureStatus.auto_blocked')}</Pill> : null}
              </div>
              <div className={`bar ${platformUsage >= 100 ? 'over' : platformUsage >= 80 ? 'warn' : ''}`}>
                <i style={{ width: `${Math.min(platformUsage, 100)}%` }} />
              </div>
            </div>
          </section>

          <DataTable<SymbolExposure>
            rowKey="symbol"
            dataSource={data.exposures}
            emptyText={t('risk.emptyExposure')}
            rowClassName={(r) => (r.status === 'auto_blocked' ? 'row-alert' : '')}
            columns={[
              {
                title: t('risk.symbol'),
                dataIndex: 'symbol',
                render: (v: string, r) => (
                  <span className="nowrap">
                    <b className="num">{v}</b> <span className="muted">{localName(i18n.language, r.nameZh, r.nameEn)}</span>
                  </span>
                ),
              },
              { title: t('risk.long'), dataIndex: 'longUsd', align: 'right', render: (v: string) => <Num>{formatAmount(v, { decimals: 0 })}</Num> },
              { title: t('risk.short'), dataIndex: 'shortUsd', align: 'right', render: (v: string) => <Num>{formatAmount(v, { decimals: 0 })}</Num> },
              {
                title: t('risk.net'),
                dataIndex: 'netUsd',
                align: 'right',
                render: (v: string) => <Num className={v.startsWith('-') ? 'down strong' : 'up strong'}>{formatAmount(v, { decimals: 0, showPlus: true })}</Num>,
              },
              {
                title: t('risk.thresholdUsd'),
                dataIndex: 'thresholdUsd',
                align: 'right',
                render: (v: string, r) => (
                  <span className="nowrap">
                    <Num>{formatAmount(v, { decimals: 0 })}</Num>
                    <PermButton perm="risk:threshold" type="link" size="small" icon={<EditOutlined />} aria-label={t('risk.editThreshold', { symbol: r.symbol })} onClick={() => editSymbolThreshold(r)} />
                  </span>
                ),
              },
              { title: t('risk.usage'), key: 'usage', align: 'right', render: (_, r) => <UsageBar net={r.netUsd} threshold={r.thresholdUsd} /> },
              { title: t('risk.status'), dataIndex: 'status', render: (v: string) => <Pill tone={exposureTone[v]}>{t(`exposureStatus.${v}`)}</Pill> },
              {
                title: t('common.actions'),
                key: 'op',
                fixed: 'right',
                render: (_, r) =>
                  r.status === 'auto_blocked' || r.status === 'manual_paused' ? (
                    <PermButton perm="risk:symbol_pause" size="small" type="primary" onClick={() => pauseSymbol(r, false)}>
                      {t('risk.resume')}
                    </PermButton>
                  ) : (
                    <PermButton perm="risk:symbol_pause" size="small" danger onClick={() => pauseSymbol(r, true)}>
                      {t('risk.pause')}
                    </PermButton>
                  ),
              },
            ]}
          />

          <div className="card card-pad">
            <h2 className="card-title">
              <span>{t('risk.userLimitTitle')}</span>
              <PermButton perm="risk:user_limit" size="small" icon={<EditOutlined />} onClick={() => editUserLimit()}>
                {t('common.edit')}
              </PermButton>
            </h2>
            <div>
              <span className="big num" style={{ fontSize: 20, fontWeight: 700 }}>{formatAmount(s.perUserLimitUsd, { decimals: 0 })}</span> <span className="muted">USD</span>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('risk.userLimitHint')}</div>
          </div>

          <div className="card card-pad">
            <h2 className="card-title">
              <span>{t('risk.events')}</span>
              {can('audit:view') ? <Link to="/system/audit">{t('risk.viewAll')}</Link> : null}
            </h2>
            {data.events.length ? (
              <div className="events">
                {data.events.map((e) => (
                  <div className="ev" key={e.id}>
                    <Num className="muted">{shortTime(e.time)}</Num>
                    <span>
                      <Pill tone={e.actorType === 'system' ? 'sys' : 'admin'}>{e.actorType === 'system' ? t('risk.system') : t('risk.adminActor', { name: e.actorName })}</Pill>
                    </span>
                    <span>{eventText(e)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">{t('risk.noEvents')}</div>
            )}
          </div>
        </>
      )}
      {hr.element}
    </>
  );
}
