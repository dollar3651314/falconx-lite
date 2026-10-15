/**
 * 入金对账：列出链上和账上不一致的记录，标记已处理（必填备注）。修复 fxsystem F5。
 */
import { useState } from 'react';
import { Alert, Select, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { listRecon, resolveRecon } from '../../api';
import type { ReconItem, ReconQuery } from '../../api/types';
import { CHAINS } from '../../config/constants';
import { usePagedList } from '../../hooks/usePagedList';
import { useNoteDialog } from '../../hooks/useConfirmDialogs';
import { PageHeader } from '../../components/PageHeader';
import { FilterBar, FilterItem } from '../../components/FilterBar';
import { DataTable } from '../../components/DataTable';
import { PermButton } from '../../components/PermButton';
import { ChainTag, Pill } from '../../components/Pill';
import { Amount, Num } from '../../components/Num';
import { reconTone } from '../../utils/status';
import { shortHash, shortTime } from '../../utils/display';

type Filters = Omit<ReconQuery, 'page' | 'pageSize'>;
const INITIAL: Filters = { status: 'open' };

export function ReconPage() {
  const { t } = useTranslation();
  const list = usePagedList<ReconItem, Filters>(listRecon, INITIAL);
  const [draft, setDraft] = useState<Filters>(INITIAL);
  const note = useNoteDialog();

  return (
    <>
      <PageHeader title={t('recon.title')} sub={t('recon.sub')} />
      <Alert type="info" showIcon message={t('recon.hint')} />
      <FilterBar onSearch={() => list.setFilters(draft)} onReset={() => { setDraft(INITIAL); list.setFilters(INITIAL); }}>
        <FilterItem label={t('recon.status')}>
          <Select
            aria-label={t('recon.status')}
            allowClear
            style={{ width: 120 }}
            placeholder={t('common.all')}
            value={draft.status}
            onChange={(v) => setDraft({ ...draft, status: v })}
            options={(['open', 'resolved'] as const).map((s) => ({ value: s, label: t(`reconStatus.${s}`) }))}
          />
        </FilterItem>
        <FilterItem label={t('funds.chain')}>
          <Select aria-label={t('funds.chain')} allowClear style={{ width: 100 }} placeholder={t('common.all')} value={draft.chain} onChange={(v) => setDraft({ ...draft, chain: v })} options={CHAINS.map((c) => ({ value: c, label: c }))} />
        </FilterItem>
      </FilterBar>
      <DataTable<ReconItem>
        rowKey="id"
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        dataSource={list.data?.items}
        total={list.data?.total ?? 0}
        page={list.page}
        pageSize={list.pageSize}
        onPageChange={list.onPageChange}
        emptyText={t('recon.empty')}
        columns={[
          { title: t('recon.id'), dataIndex: 'id', render: (v: string) => <Num>{v}</Num> },
          { title: t('recon.type'), dataIndex: 'type', render: (v: string) => t(`reconType.${v}`) },
          { title: t('funds.chain'), dataIndex: 'chain', render: (v: string) => <ChainTag chain={v} /> },
          {
            title: t('deposits.txHash'),
            dataIndex: 'txHash',
            render: (v: string) => (
              <Tooltip title={v}>
                <Typography.Text className="num" copyable={{ text: v, tooltips: [t('common.copy'), t('common.copied')] }}>
                  {shortHash(v, 8, 6)}
                </Typography.Text>
              </Tooltip>
            ),
          },
          { title: t('funds.user'), key: 'u', render: (_, r) => (r.customerName ? <span className="ellipsis" style={{ maxWidth: 180 }} title={r.customerName}>{r.customerName}</span> : <span className="muted">{t('recon.unknownCustomer')}</span>) },
          { title: t('recon.chainAmount'), dataIndex: 'chainAmount', align: 'right', render: (v: string) => <Amount value={v} decimals={6} /> },
          { title: t('recon.ledgerAmount'), dataIndex: 'ledgerAmount', align: 'right', render: (v: string) => <Amount value={v} decimals={6} /> },
          { title: t('recon.diff'), dataIndex: 'diff', align: 'right', render: (v: string) => <Amount value={v} decimals={6} signed strong /> },
          { title: t('recon.detectedAt'), dataIndex: 'detectedAt', render: (v: string) => <Num>{shortTime(v)}</Num> },
          { title: t('recon.status'), dataIndex: 'status', render: (v: string) => <Pill tone={reconTone[v]}>{t(`reconStatus.${v}`)}</Pill> },
          { title: t('recon.note'), dataIndex: 'note', render: (v: string | null, r) => (v ? <span title={v}>{r.handler} · <span className="ellipsis" style={{ maxWidth: 200 }}>{v}</span></span> : '—') },
          {
            title: t('common.actions'),
            key: 'op',
            fixed: 'right',
            render: (_, r) =>
              r.status === 'open' ? (
                <PermButton
                  perm="recon:resolve"
                  size="small"
                  onClick={() =>
                    note.ask({
                      title: t('recon.resolve'),
                      label: t('recon.note'),
                      placeholder: t('recon.notePh'),
                      okText: t('recon.resolve'),
                      onConfirm: (n) => resolveRecon(r.id, n),
                      onDone: list.reload,
                    })
                  }
                >
                  {t('recon.resolve')}
                </PermButton>
              ) : (
                <span className="muted">{t('reconStatus.resolved')}</span>
              ),
          },
        ]}
      />
      {note.element}
    </>
  );
}
