/**
 * 钱包的真实接口：`/api/wallet/*`（`wallet/web/WalletController.java`、`wallet/withdraw/WithdrawController.java`）。
 * 资金流水：后端还没有客户端接口（S17 汇报的缺口），这里按约定的 `GET /api/trading/ledger` 调用，接口补上后即可使用。
 */
import { del, get, post } from '../http';
import type { DepositAddress, DepositRecord, LedgerItem, LedgerQuery, Network, Page, WhitelistAddress, Withdrawal, WithdrawInfo, WithdrawRequest } from '../types';

export const getDepositAddresses = (): Promise<DepositAddress[]> => get<DepositAddress[]>('/api/wallet/addresses');

/** 最近 50 条充值记录 */
export const listDeposits = (): Promise<DepositRecord[]> => get<DepositRecord[]>('/api/wallet/deposits');

export const listLedger = (q: LedgerQuery): Promise<Page<LedgerItem>> =>
  get<Page<LedgerItem>>('/api/trading/ledger', { query: { type: q.type === 'all' ? undefined : q.type, range: q.range, page: q.page, pageSize: q.pageSize } });

export const getWithdrawInfo = (): Promise<WithdrawInfo> => get<WithdrawInfo>('/api/wallet/withdraw-info');

export const listWhitelist = (): Promise<WhitelistAddress[]> => get<WhitelistAddress[]>('/api/wallet/whitelist');

export const addWhitelist = (f: { network: Network; address: string; label: string }): Promise<WhitelistAddress> =>
  post<WhitelistAddress>('/api/wallet/whitelist', { network: f.network, address: f.address.trim(), label: f.label.trim() });

export async function removeWhitelist(id: string): Promise<void> {
  await del<void>(`/api/wallet/whitelist/${encodeURIComponent(id)}`);
}

export const listWithdrawals = (page: number, pageSize: number): Promise<Page<Withdrawal>> => get<Page<Withdrawal>>('/api/wallet/withdrawals', { query: { page, pageSize } });

/** 提现的 INSUFFICIENT_BALANCE 是"超过可提金额" */
export const submitWithdraw = (req: WithdrawRequest): Promise<Withdrawal> =>
  post<Withdrawal>('/api/wallet/withdrawals', { whitelistId: req.whitelistId, amount: req.amount.trim() }, { codes: { INSUFFICIENT_BALANCE: 'withdrawInsufficient' } });

export const cancelWithdraw = (id: string): Promise<Withdrawal> => post<Withdrawal>(`/api/wallet/withdrawals/${encodeURIComponent(id)}/cancel`);
