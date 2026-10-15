/** 资金接口。正式环境：/api/wallet/* */
import * as mock from '../mocks/wallet';
import type { DepositAddress, LedgerItem, LedgerQuery, Network, Page, WhitelistAddress, Withdrawal, WithdrawInfo, WithdrawRequest } from './types';

export const getDepositAddresses = (): Promise<DepositAddress[]> => mock.getDepositAddresses();
export const listLedger = (q: LedgerQuery): Promise<Page<LedgerItem>> => mock.listLedger(q);
export const getWithdrawInfo = (): Promise<WithdrawInfo> => mock.getWithdrawInfo();
export const listWhitelist = (): Promise<WhitelistAddress[]> => mock.listWhitelist();
export const addWhitelist = (f: { network: Network; address: string; label: string }): Promise<WhitelistAddress> => mock.addWhitelist(f);
export const removeWhitelist = (id: string): Promise<void> => mock.removeWhitelist(id);
export const listWithdrawals = (page: number, pageSize = 20): Promise<Page<Withdrawal>> => mock.listWithdrawals(page, pageSize);
export const submitWithdraw = (req: WithdrawRequest): Promise<Withdrawal> => mock.submitWithdraw(req);
export const cancelWithdraw = (id: string): Promise<Withdrawal> => mock.cancelWithdraw(id);
