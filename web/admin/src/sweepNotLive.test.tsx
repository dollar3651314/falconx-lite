/**
 * v2 资金归集：后端上线前（SWEEP_UI = false，真实接口模式下就是这样），对账页不显示"资金归集"入口，四个归集页面只显示"未上线"。
 */
import { screen } from '@testing-library/react';
import { renderAs } from './test/render';
import { ReconPage } from './pages/funds/ReconPage';
import { SweepRecordsPage } from './pages/funds/sweep/SweepRecordsPage';
import { SweepNewPage } from './pages/funds/sweep/SweepNewPage';
import { SweepSettingsPage } from './pages/funds/sweep/SweepSettingsPage';

vi.mock('./config/sweep', async (orig) => ({ ...(await orig<typeof import('./config/sweep')>()), SWEEP_UI: false }));

describe('资金归集没上线时', () => {
  it('对账页没有入口', async () => {
    renderAs(<ReconPage />);
    expect(await screen.findByRole('heading', { name: '对账' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '资金归集' })).toBeNull();
  });

  it.each([
    ['归集记录', <SweepRecordsPage key="r" />],
    ['生成 / 执行', <SweepNewPage key="n" />],
    ['归集设置', <SweepSettingsPage key="s" />],
  ])('%s 页显示"未上线"', (_name, ui) => {
    renderAs(ui);
    expect(screen.getByText('未上线')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /执行归集|生成待签名清单|保存/ })).toBeNull();
  });
});
