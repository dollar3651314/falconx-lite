/**
 * 客户详情：资料、KYC、账户余额、持仓、最近资金流水；冻结/解冻、调整余额（高危）。
 */
import { useCallback } from 'react';
import { Alert, Button, Descriptions, Form, Input, Radio, Skeleton, Space } from 'antd';
import { ArrowLeftOutlined, LockOutlined, UnlockOutlined, DollarOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { adjustBalance, getAdjustLimits, getCustomer, setCustomerFrozen } from '../../api';
import type { LedgerEntry, Position } from '../../api/types';
import { useApi } from '../../hooks/useApi';
import { useHighRisk } from '../../hooks/useConfirmDialogs';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState } from '../../components/ErrorState';
import { DataTable } from '../../components/DataTable';
import { PermButton } from '../../components/PermButton';
import { Pill } from '../../components/Pill';
import { Amount, Num } from '../../components/Num';
import { customerTone, kycTone } from '../../utils/status';
import { formatAmount, subtractAmounts } from '../../utils/money';
import { adjustAmountProblems } from '../../utils/validators';
import { shortTime } from '../../utils/display';

export function CustomerDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const customerId = Number(id);
  const fetcher = useCallback(() => getCustomer(customerId), [customerId]);
  const { data: c, loading, error, reload } = useApi(fetcher);
  const hr = useHighRisk();

  const askFreeze = () => {
    if (!c) return;
    const freezing = c.status === 'active';
    hr.ask({
      title: freezing ? t('customers.freeze') : t('customers.unfreeze'),
      description: (
        <>
          <div>{t('customers.targetLine', { name: c.name, id: c.id, email: c.email })}</div>
          <div>{freezing ? t('customers.freezeImpact') : t('customers.unfreezeImpact')}</div>
        </>
      ),
      confirmText: freezing ? t('customers.confirmFreeze') : t('customers.confirmUnfreeze'),
      onConfirm: (v) => setCustomerFrozen(c.id, freezing, v.reason),
      onDone: reload,
    });
  };

  const askAdjust = async () => {
    if (!c) return;
    const limits = await getAdjustLimits();
    const remaining = subtractAmounts(limits.dailyLimit, limits.usedToday);
    hr.ask({
      title: t('customers.adjust'),
      description: (
        <>
          <div>{t('customers.adjustTarget', { name: c.name, id: c.id, balance: formatAmount(c.account.balance) })}</div>
          <div>
            {t('customers.adjustLimits', {
              single: formatAmount(limits.singleLimit),
              used: formatAmount(limits.usedToday),
              daily: formatAmount(limits.dailyLimit),
              remaining: formatAmount(remaining),
            })}
          </div>
        </>
      ),
      initialValues: { direction: 'credit' },
      extra: (
        <>
          <Form.Item name="direction" label={t('customers.direction')} rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { value: 'credit', label: t('customers.credit') },
                { value: 'debit', label: t('customers.debit') },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="amount"
            label={t('customers.adjustAmount')}
            rules={[
              {
                validator: (_r, value: string | undefined) => {
                  const p = adjustAmountProblems(value ?? '', limits.singleLimit, remaining);
                  return p.length
                    ? Promise.reject(new Error(p.map((k) => t(k, { single: formatAmount(limits.singleLimit), remaining: formatAmount(remaining) })).join('；')))
                    : Promise.resolve();
                },
              },
            ]}
          >
            <Input inputMode="decimal" suffix="USDT" placeholder="0.00" />
          </Form.Item>
        </>
      ),
      confirmText: t('customers.confirmAdjust'),
      onConfirm: (v) => adjustBalance(c.id, v.direction as 'credit' | 'debit', String(v.amount).trim(), v.reason),
      onDone: reload,
    });
  };

  return (
    <>
      <PageHeader
        title={
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />} aria-label={t('common.back')} onClick={() => navigate('/customers')} />
            {c ? <span className="ellipsis" style={{ maxWidth: 360 }} title={c.name}>{c.name}</span> : t('customers.detail')}
            {c ? <Pill tone={customerTone[c.status]}>{t(`customerStatus.${c.status}`)}</Pill> : null}
          </Space>
        }
        extra={
          c ? (
            <>
              <PermButton perm="customer:freeze" danger icon={c.status === 'active' ? <LockOutlined /> : <UnlockOutlined />} onClick={askFreeze}>
                {c.status === 'active' ? t('customers.freeze') : t('customers.unfreeze')}
              </PermButton>
              <PermButton perm="customer:adjust_balance" icon={<DollarOutlined />} onClick={() => void askAdjust()}>
                {t('customers.adjust')}
              </PermButton>
            </>
          ) : null
        }
      />
      {error ? (
        <div className="card">
          <ErrorState error={error} onRetry={reload} />
        </div>
      ) : !c || loading ? (
        <div className="card card-pad">
          <Skeleton active paragraph={{ rows: 8 }} />
        </div>
      ) : (
        <>
          {c.status === 'frozen' ? <Alert type="error" showIcon message={t('customers.frozenBanner')} description={c.frozenReason ? t('customers.frozenReasonLine', { reason: c.frozenReason }) : undefined} /> : null}
          <section className="detail-grid" aria-label={t('customers.account')}>
            <div className="card stat">
              <div className="k">{t('customers.balance')}</div>
              <div className="v"><Amount value={c.account.balance} /></div>
            </div>
            <div className="card stat">
              <div className="k">{t('customers.usedMargin')}</div>
              <div className="v"><Amount value={c.account.usedMargin} /></div>
            </div>
            <div className="card stat">
              <div className="k">{t('customers.available')}</div>
              <div className="v"><Amount value={c.account.available} /></div>
            </div>
            <div className="card stat">
              <div className="k">{t('customers.floatingPnl')}</div>
              <div className="v"><Amount value={c.account.floatingPnl} signed /></div>
              <div className="muted">
                {t('customers.frozenWithdraw')} <Num>{formatAmount(c.account.frozenWithdraw)}</Num>
              </div>
            </div>
          </section>

          <div className="card card-pad">
            <h2 className="card-title">{t('customers.profile')}</h2>
            <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
              <Descriptions.Item label={t('customers.id')}><Num>{c.id}</Num></Descriptions.Item>
              <Descriptions.Item label={t('customers.email')}>{c.email}</Descriptions.Item>
              <Descriptions.Item label={t('customers.nationality')}>{c.nationality}</Descriptions.Item>
              <Descriptions.Item label={t('customers.firstName')}>{c.firstName}</Descriptions.Item>
              <Descriptions.Item label={t('customers.middleName')}>{c.middleName || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('customers.lastName')}>{c.lastName}</Descriptions.Item>
              <Descriptions.Item label={t('customers.birthDate')}><Num>{c.birthDate}</Num></Descriptions.Item>
              <Descriptions.Item label={t('customers.registeredAt')}><Num>{c.registeredAt}</Num></Descriptions.Item>
              <Descriptions.Item label={t('customers.lastLogin')}>{c.lastLoginAt ? <Num>{c.lastLoginAt}</Num> : t('customers.neverLogin')}</Descriptions.Item>
            </Descriptions>
          </div>

          <div className="card card-pad">
            <h2 className="card-title">
              <span>{t('customers.kycTitle')}</span>
              {c.kyc.status === 'pending' ? <Link to="/kyc">{t('customers.goKyc')}</Link> : null}
            </h2>
            <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
              <Descriptions.Item label={t('customers.kyc')}>
                <Pill tone={kycTone[c.kyc.status]}>{t(`kycStatus.${c.kyc.status}`)}</Pill>
              </Descriptions.Item>
              <Descriptions.Item label={t('kyc.docType')}>{c.kyc.docType ? t(`kyc.doc.${c.kyc.docType}`) : '—'}</Descriptions.Item>
              <Descriptions.Item label={t('kyc.docNumber')}>{c.kyc.docNumber ? <Num>{c.kyc.docNumber}</Num> : '—'}</Descriptions.Item>
              <Descriptions.Item label={t('kyc.reviewedAt')}>{c.kyc.reviewedAt ? <Num>{c.kyc.reviewedAt}</Num> : '—'}</Descriptions.Item>
              {c.kyc.rejectReason ? <Descriptions.Item label={t('kyc.rejectReason')}>{c.kyc.rejectReason}</Descriptions.Item> : null}
            </Descriptions>
          </div>

          <div className="card card-pad">
            <h2 className="card-title">{t('customers.positionsTitle', { count: c.positions.length })}</h2>
            <DataTable<Position>
              bare
              rowKey="id"
              dataSource={c.positions}
              emptyText={t('customers.noPositions')}
              columns={[
                { title: t('trading.positionId'), dataIndex: 'id', render: (v: string) => <Num>{v}</Num> },
                { title: t('trading.symbol'), dataIndex: 'symbol', render: (v: string) => <b>{v}</b> },
                { title: t('trading.side'), dataIndex: 'side', render: (v: string) => <span className={v === 'buy' ? 'up' : 'down'}>{t(`side.${v}`)}</span> },
                { title: t('trading.lots'), dataIndex: 'lots', align: 'right', render: (v: string) => <Num>{v}</Num> },
                { title: t('trading.openPrice'), dataIndex: 'openPrice', align: 'right', render: (v: string) => <Num>{v}</Num> },
                { title: t('trading.margin'), dataIndex: 'margin', align: 'right', render: (v: string) => <Amount value={v} /> },
                { title: t('trading.pnl'), dataIndex: 'pnl', align: 'right', render: (v: string) => <Amount value={v} signed /> },
                { title: t('trading.openedAt'), dataIndex: 'openedAt', render: (v: string) => <Num>{shortTime(v)}</Num> },
              ]}
            />
          </div>

          <div className="card card-pad">
            <h2 className="card-title">{t('customers.ledgerTitle')}</h2>
            <DataTable<LedgerEntry>
              bare
              rowKey="id"
              dataSource={c.ledger}
              emptyText={t('customers.noLedger')}
              columns={[
                { title: t('customers.time'), dataIndex: 'time', render: (v: string) => <Num>{v}</Num> },
                { title: t('customers.ledgerType'), dataIndex: 'type', render: (v: string) => t(`ledger.${v}`) },
                { title: t('customers.amount'), dataIndex: 'amount', align: 'right', render: (v: string) => <Amount value={v} signed /> },
                { title: t('customers.balanceAfter'), dataIndex: 'balanceAfter', align: 'right', render: (v: string) => <Amount value={v} /> },
                { title: t('customers.ref'), dataIndex: 'ref', render: (v: string) => <Num>{v}</Num> },
              ]}
            />
          </div>
        </>
      )}
      {hr.element}
    </>
  );
}
