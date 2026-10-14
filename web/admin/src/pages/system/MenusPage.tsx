/**
 * 菜单管理：查看后台菜单树（10 个一级菜单），调整排序。每个页面都必须有菜单入口（AC-35）。
 * 菜单是否显示由权限点决定：管理员没有该页面的查看权限时，菜单自动隐藏。
 */
import { useCallback, useState } from 'react';
import { Alert, InputNumber, Space, Table } from 'antd';
import { useTranslation } from 'react-i18next';
import { listMenus, updateMenu } from '../../api';
import type { MenuNode } from '../../api/types';
import { useApi } from '../../hooks/useApi';
import { useAction } from '../../hooks/useConfirmDialogs';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState } from '../../components/ErrorState';
import { PermButton } from '../../components/PermButton';
import { Num } from '../../components/Num';

export function MenusPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const run = useAction();
  const fetcher = useCallback(() => listMenus(), []);
  const { data, loading, error, reload } = useApi(fetcher);
  const [orders, setOrders] = useState<Record<string, number>>({});

  return (
    <>
      <PageHeader title={t('menus.title')} sub={t('menus.sub')} />
      <Alert type="info" showIcon message={t('menus.hint')} />
      <div className="card table-card">
        {error ? (
          <ErrorState error={error} onRetry={reload} compact />
        ) : (
          <Table<MenuNode>
            rowKey="key"
            size="middle"
            loading={loading}
            dataSource={data}
            pagination={false}
            scroll={{ x: 'max-content' }}
            expandable={{ defaultExpandAllRows: true }}
            locale={{ emptyText: t('common.empty') }}
            columns={[
              { title: t('menus.name'), dataIndex: 'labelKey', render: (v: string, r) => (r.children ? <b>{t(v)}</b> : t(v)) },
              { title: t('menus.path'), dataIndex: 'path', render: (v: string | null) => (v ? <Num>/admin{v}</Num> : <span className="muted">{t('menus.group')}</span>) },
              { title: t('menus.permission'), dataIndex: 'permission', render: (v: string | null) => (v ? <Num>{v}</Num> : '—') },
              {
                title: t('menus.order'),
                key: 'order',
                render: (_, r) => (
                  <Space size={4}>
                    <InputNumber
                      size="small"
                      min={0}
                      max={999}
                      precision={0}
                      aria-label={t('menus.order')}
                      value={orders[r.key] ?? r.order}
                      disabled={!can('menu:edit')}
                      onChange={(v) => setOrders({ ...orders, [r.key]: v ?? 0 })}
                      style={{ width: 72 }}
                    />
                    <PermButton
                      perm="menu:edit"
                      size="small"
                      disabled={orders[r.key] === undefined || orders[r.key] === r.order}
                      disabledReason={t('menus.noChange')}
                      onClick={() => void run(() => updateMenu(r.key, { order: orders[r.key] }), t('common.saved'), reload)}
                    >
                      {t('common.save')}
                    </PermButton>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </div>
    </>
  );
}
