import { screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { setProtoState } from '../api/prototype';
import { resetDb } from '../mocks/db';
import { protoSetKyc } from '../mocks/user';
import { renderPage } from '../test/renderApp';
import Markets from './Markets';
import Notifications from './me/Notifications';
import Withdraw from './assets/Withdraw';

afterEach(() => {
  act(() => setProtoState({ scenario: 'normal', forceReject: 'none' }));
  resetDb();
});

describe('关键页面渲染', () => {
  it('行情页显示 50 个品种和"暂停开仓"', async () => {
    renderPage(<Markets />, '/markets');
    expect(await screen.findByText('显示 50 / 50 个品种')).toBeInTheDocument();
    expect(screen.getAllByText('暂停开仓').length).toBeGreaterThan(0);
    expect(screen.getByText('XAUUSD')).toBeInTheDocument();
  });

  it('行情页空数据', async () => {
    act(() => setProtoState({ scenario: 'empty' }));
    renderPage(<Markets />, '/markets');
    expect(await screen.findByText('暂无可交易品种')).toBeInTheDocument();
  });

  it('行情页接口出错时显示原因和重试，不显示错误代码', async () => {
    act(() => setProtoState({ scenario: 'error' }));
    renderPage(<Markets />, '/markets');
    expect(await screen.findByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.getByText(/服务暂时不可用/)).toBeInTheDocument();
  });

  it('通知中心：未读数和空状态', async () => {
    renderPage(<Notifications />, '/me/notifications');
    expect(await screen.findByText('5 条未读')).toBeInTheDocument();
    act(() => setProtoState({ scenario: 'empty' }));
    expect(await screen.findByText('暂无通知')).toBeInTheDocument();
  });

  it('提现：KYC 未通过时提示去认证', async () => {
    protoSetKyc('none');
    renderPage(<Withdraw />, '/assets/withdraw');
    expect(await screen.findByRole('button', { name: '去认证' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交提现' })).not.toBeInTheDocument();
  });

  it('提现：已认证时显示表单和各状态的记录', async () => {
    renderPage(<Withdraw />, '/assets/withdraw');
    expect(await screen.findByRole('button', { name: '提交提现' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('冷静期中')).toBeInTheDocument());
    expect(screen.getByText('失败已退款')).toBeInTheDocument();
  });
});

import { fireEvent } from '@testing-library/react';
import { OrderPanel } from '../components/OrderPanel';
import { SYMBOL_SEEDS } from '../mocks/data/symbols';

describe('下单面板手数', () => {
  it('输入框、预估和确认按钮始终使用同一个手数', async () => {
    const xau = SYMBOL_SEEDS.find((s) => s.info.code === 'XAUUSD')!.info;
    renderPage(<OrderPanel symbol={xau} inline />, '/trade/XAUUSD');
    const input = (await screen.findByLabelText('数量（手）')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0.2510' } });
    expect(input.value).toBe('0.10');
    expect(screen.getByRole('button', { name: '确认买入 0.10 手 XAUUSD' })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '0.25' } });
    expect(input.value).toBe('0.25');
    expect(screen.getByRole('button', { name: '确认买入 0.25 手 XAUUSD' })).toBeInTheDocument();
    // 名义价值按 0.25 手计算：0.25 × 100 盎司 × 买价
    await waitFor(() => {
      const row = screen.getByText('名义价值').parentElement!;
      const notional = Number(row.querySelector('dd')!.textContent!.replace(/,/g, ''));
      expect(notional).toBeGreaterThan(0.25 * 100 * 4000);
      expect(notional).toBeLessThan(0.25 * 100 * 4300);
    });
  });
});

import { DepositCard } from './assets/DepositCard';

describe('充值', () => {
  it('选网络后显示最小充值金额；下方显示充值记录的各种状态（AC-41）', async () => {
    renderPage(<DepositCard />, '/assets');
    expect(await screen.findByText('低于最小充值金额')).toBeInTheDocument();
    expect(screen.getByText(/待确认 7\/20/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /TRC20/ }));
    expect(await screen.findByText('单笔最少 1 USDT，低于该金额不会入账')).toBeInTheDocument();
  });
});
