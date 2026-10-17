/**
 * v2 提现自动审批：后端上线前（AUTO_APPROVE_UI = false，真实接口模式下就是这样），出金审核页不显示规则判定的列、筛选、卡片和入口，
 * 规则设置页只显示"未上线"。
 */
import { screen } from '@testing-library/react';
import { renderAs } from './test/render';
import { WithdrawalsPage } from './pages/funds/WithdrawalsPage';
import { AutoApprovePage } from './pages/funds/AutoApprovePage';

vi.mock('./config/autoApprove', async (orig) => ({ ...(await orig<typeof import('./config/autoApprove')>()), AUTO_APPROVE_UI: false }));

describe('自动审批没上线时', () => {
  it('出金审核页没有规则判定', async () => {
    renderAs(<WithdrawalsPage />);
    expect(await screen.findByText('103763725516804414')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '规则判定' })).toBeNull();
    expect(screen.queryByRole('region', { name: '规则判定' })).toBeNull();
    expect(screen.queryByRole('button', { name: /自动审批规则/ })).toBeNull();
  });

  it('规则设置页显示"未上线"', () => {
    renderAs(<AutoApprovePage />);
    expect(screen.getByText('未上线')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
