/**
 * v2 资金归集（技术方案/v2-半自动归集.md 第 6 节，推荐路线 (b)）：模拟层口径（门槛、跳过原因、合计、TRON 导入核对、广播部分成功、
 * 冷钱包地址 24 小时延迟、参数版本号）和四个页面（原型模式）。
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  broadcastSweep,
  cancelTronSweepTarget,
  demoSweepSignedFile,
  getSweepBatch,
  getSweepOverview,
  getSweepSettings,
  importSweepSigned,
  listAuditLogs,
  listSweepBatches,
  previewSweep,
  requestTronSweepTarget,
  runSweep,
  switchIdentity,
  updateSweepSettings,
} from './api';
import { ApiError } from './api/types';
import { renderAs } from './test/render';
import { SWEEP_MODE } from './config/sweep';
import { DEMO_TRON_BATCH } from './mocks/data/sweep';
import { SweepRecordsPage } from './pages/funds/sweep/SweepRecordsPage';
import { SweepNewPage } from './pages/funds/sweep/SweepNewPage';
import { SweepBatchPage } from './pages/funds/sweep/SweepBatchPage';
import { SweepSettingsPage } from './pages/funds/sweep/SweepSettingsPage';
import { ReconPage } from './pages/funds/ReconPage';
import { Route, Routes } from 'react-router-dom';

afterEach(async () => {
  await switchIdentity('super');
});

describe('资金归集：模拟层', () => {
  it('路线 (b)：以太坊、BSC 合约自动，TRON 离线签名', async () => {
    expect(SWEEP_MODE).toEqual({ ERC20: 'contract', BSC: 'contract', TRC20: 'offline' });
    const o = await getSweepOverview();
    expect(o.map((x) => [x.chain, x.mode])).toEqual([
      ['ERC20', 'contract'],
      ['BSC', 'contract'],
      ['TRC20', 'offline'],
    ]);
    // 以太坊、BSC 共用同一个冷钱包（parent）和发起账户；TRON 没有发起账户
    expect(o[0].destination).toBe(o[1].destination);
    expect(o[2].operatorBalance).toBeNull();
    expect(o[2].activeBatch).toBe(DEMO_TRON_BATCH);
  });

  it('预览：只列达到门槛的地址，按余额从大到小；跳过的有原因；合计只算不跳过的', async () => {
    for (const chain of ['ERC20', 'BSC', 'TRC20'] as const) {
      const p = await previewSweep(chain);
      const th = Number(p.threshold);
      expect(p.candidates.every((c) => Number(c.usdt) >= th)).toBe(true);
      const amounts = p.candidates.map((c) => Number(c.usdt));
      expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
      const ok = p.candidates.filter((c) => !c.skip);
      expect(p.totals.count).toBe(ok.length);
      expect(p.totals.skipped).toBe(p.candidates.length - ok.length);
      expect(Number(p.totals.usdt)).toBeCloseTo(ok.reduce((s, c) => s + Number(c.usdt), 0), 2);
    }
    const reasons = (await previewSweep('ERC20')).candidates.map((c) => c.skip);
    expect(reasons).toContain('pendingDeposit');
    expect(reasons).toContain('feeRatio');
    // TRON：已在进行中批次里的地址跳过；以太坊体系不补手续费，TRON 要补 TRX
    const tron = await previewSweep('TRC20');
    expect(tron.candidates.map((c) => c.skip)).toContain('inBatch');
    expect((await previewSweep('BSC')).candidates.every((c) => c.topup === '0')).toBe(true);
    expect(tron.candidates.some((c) => Number(c.topup) > 0)).toBe(true);
  });

  it('以太坊、BSC 执行归集：一批完成、写审计；原因必填；TRON 有进行中的批次时不能再生成', async () => {
    await expect(runSweep('BSC', ' ')).rejects.toBeInstanceOf(ApiError);
    const before = (await previewSweep('BSC')).totals;
    const { no } = await runSweep('BSC', '测试归集');
    const d = await getSweepBatch(no);
    expect(d.status).toBe('confirmed');
    expect(d.addressCount).toBe(before.count);
    expect(d.sweptUsdt).toBe(before.usdt);
    expect(d.items.every((i) => i.status === 'swept')).toBe(true);
    expect((await listAuditLogs({ page: 1, pageSize: 5 })).items[0]).toMatchObject({ action: 'sweep.run', target: no, highRisk: true, reason: '测试归集' });
    // 归集完的地址余额归零，下次预览不再出现
    expect((await previewSweep('BSC')).totals.count).toBe(0);
    await expect(runSweep('TRC20', '再来一批')).rejects.toMatchObject({ reasonKey: 'errors.sweepBatchActive' });
  });

  it('TRON：导入演示签名文件 → 最后一笔核对不通过；广播后部分成功', async () => {
    await expect(importSweepSigned(DEMO_TRON_BATCH, 'not json')).rejects.toMatchObject({ reasonKey: 'errors.sweepBadFile' });
    await expect(importSweepSigned(DEMO_TRON_BATCH, JSON.stringify({ kind: 'signed', batchNo: '1', items: [] }))).rejects.toMatchObject({ reasonKey: 'errors.sweepBatchMismatch' });
    const r = await importSweepSigned(DEMO_TRON_BATCH, await demoSweepSignedFile(DEMO_TRON_BATCH));
    const d = await getSweepBatch(DEMO_TRON_BATCH);
    expect(r.rejected).toEqual([{ itemNo: d.items.length, reason: 'contentMismatch' }]);
    expect(r.accepted).toBe(d.items.length - 1);
    expect(d.status).toBe('signed');
    await broadcastSweep(DEMO_TRON_BATCH, '广播测试');
    const after = await getSweepBatch(DEMO_TRON_BATCH);
    expect(after.status).toBe('partial');
    expect(after.items.filter((i) => i.status === 'failed').map((i) => i.failReason)).toEqual(['outOfEnergy']);
    expect(after.items.find((i) => i.itemNo === d.items.length)!.status).toBe('sign_rejected');
  });

  it('TRON 冷钱包地址：格式、不能用热钱包地址、24 小时后生效、可取消；以太坊、BSC 的冷钱包不能改', async () => {
    await expect(requestTronSweepTarget('0x1234', '换地址')).rejects.toMatchObject({ reasonKey: 'errors.sweepAddressInvalid' });
    await expect(requestTronSweepTarget('TUiRdTFS88JN9k1joQ5Hw6zgBBP9MtLobc', '换地址')).rejects.toMatchObject({ reasonKey: 'errors.sweepAddressForbidden' });
    const target = 'TAbcdefghijkmnopqrstuvwxyz12345678';
    await requestTronSweepTarget(target, '换冷钱包');
    const s = await getSweepSettings();
    expect(s.tronTarget.address).not.toBe(target);
    expect(s.tronTarget.pending).toMatchObject({ address: target, reason: '换冷钱包' });
    await expect(requestTronSweepTarget(target.replace('1', '2'), '再换')).rejects.toMatchObject({ reasonKey: 'errors.sweepTargetPending' });
    await cancelTronSweepTarget('提交错了');
    expect((await getSweepSettings()).tronTarget.pending).toBeNull();
    expect((await listAuditLogs({ page: 1, pageSize: 5 })).items[0].action).toBe('sweep.target_cancel');
    expect(Object.keys(s.evm)).toContain('parent');
  });

  it('参数：版本号防覆盖、没有修改报错、运营没有权限', async () => {
    const s = await getSweepSettings();
    const input = { ...s, reason: '调门槛', expectedVersion: s.version };
    await expect(updateSweepSettings(input)).rejects.toMatchObject({ reasonKey: 'errors.sweepNoChange' });
    await expect(updateSweepSettings({ ...input, expectedVersion: s.version - 1, thresholds: { ...s.thresholds, BSC: '20' } })).rejects.toMatchObject({ reasonKey: 'errors.configChanged' });
    await updateSweepSettings({ ...input, thresholds: { ...s.thresholds, BSC: '20' } });
    const s2 = await getSweepSettings();
    expect(s2.version).toBe(s.version + 1);
    expect(s2.thresholds.BSC).toBe('20');
    await updateSweepSettings({ ...s2, reason: '改回', expectedVersion: s2.version, thresholds: { ...s2.thresholds, BSC: s.thresholds.BSC } });
    await switchIdentity('ops');
    await expect(updateSweepSettings({ ...s2, reason: 'x', expectedVersion: s2.version + 1 })).rejects.toMatchObject({ reasonKey: 'errors.forbidden' });
  });

  it('批次列表按链筛选', async () => {
    const all = await listSweepBatches({ page: 1, pageSize: 100 });
    const tron = await listSweepBatches({ page: 1, pageSize: 100, chain: 'TRC20' });
    expect(tron.items.length).toBeGreaterThan(0);
    expect(tron.items.every((b) => b.chain === 'TRC20' && b.mode === 'offline')).toBe(true);
    expect(all.total).toBeGreaterThan(tron.total);
  });
});

describe('资金归集：页面', () => {
  it('对账页右上角有"资金归集"入口（原型模式）', async () => {
    renderAs(<ReconPage />);
    expect(await screen.findByRole('button', { name: '资金归集' })).toBeInTheDocument();
  });

  it('归集记录：三张链卡片和批次列表', async () => {
    renderAs(<SweepRecordsPage />);
    for (const c of ['ERC20', 'BSC', 'TRC20']) expect(await screen.findByRole('region', { name: c })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'TRC20' })).getByText('离线签名')).toBeInTheDocument();
    expect(await screen.findAllByRole('button', { name: /详\s?情/ })).not.toHaveLength(0);
  });

  it('生成 / 执行：以太坊显示"执行归集"和首次部署，TRON 显示"生成待签名清单"和要补的 TRX', async () => {
    renderAs(<SweepNewPage />, { path: '/funds/reconciliation/sweep/new?chain=ERC20' });
    expect(await screen.findByRole('button', { name: '执行归集' })).toBeInTheDocument();
    expect((await screen.findAllByText('首次部署')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('手续费占比过高').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText(/TRC20 · 离线签名/));
    expect(await screen.findByRole('button', { name: '生成待签名清单' })).toBeInTheDocument();
    expect(await screen.findByText('要补的 TRX')).toBeInTheDocument();
  });

  it('风控身份没有执行权限：按钮不可用', async () => {
    renderAs(<SweepNewPage />, { adminId: 3, path: '/funds/reconciliation/sweep/new?chain=ERC20' });
    const btn = await screen.findByRole('button', { name: '执行归集' });
    await waitFor(() => expect(btn).toBeDisabled());
  });

  it('TRON 过期的批次：能下载待签名文件，不能导入、广播，没有演示签名文件', async () => {
    renderAs(
      <Routes>
        <Route path="/funds/reconciliation/sweep/batches/:no" element={<SweepBatchPage />} />
      </Routes>,
      { path: `/funds/reconciliation/sweep/batches/${(await listSweepBatches({ page: 1, pageSize: 100, chain: 'TRC20' })).items.find((b) => b.status === 'expired')!.no}` },
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /下载待签名文件/ })).toBeInTheDocument(), { timeout: 5000 });
    // 过期的批次不能导入、不能广播
    await waitFor(() => expect(screen.getByRole('button', { name: /导入签名文件/ })).toBeDisabled());
    expect(screen.getByRole('button', { name: /^广\s?播$/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '使用演示签名文件' })).toBeNull();
  });

  it('归集设置：以太坊、BSC 的冷钱包只读；TRON 冷钱包可改', async () => {
    renderAs(<SweepSettingsPage />);
    const evm = await screen.findByRole('region', { name: '合约和冷钱包（从链上读取）' });
    expect(within(evm).getByText('只读')).toBeInTheDocument();
    expect(within(evm).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: '修改冷钱包地址' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /保\s?存/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('归集门槛 TRC20'), { target: { value: '150' } });
    expect(screen.getByRole('button', { name: /保\s?存/ })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('归集门槛 TRC20'), { target: { value: 'abc' } });
    expect(screen.getByRole('button', { name: /保\s?存/ })).toBeDisabled();
  });

  it('英文界面能渲染', async () => {
    renderAs(<SweepRecordsPage />, { lang: 'en' });
    expect(await screen.findByText('Sweep history')).toBeInTheDocument();
    expect((await screen.findAllByText('Offline signing')).length).toBeGreaterThan(0);
  });
});
