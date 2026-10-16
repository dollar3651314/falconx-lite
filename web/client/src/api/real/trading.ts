/** 交易的真实接口：`/api/trading/*`（`trading/order/TradingController.java`）。推送见 events.ts。 */
import { del, get, post, put } from '../http';
import type { Account, HistoryItem, Page, PendingOrder, PlaceOrderRequest, PlaceOrderResult, Position } from '../types';

/** 追加保证金时余额不足，后端的错误码按"可用余额不足"显示 */
const MARGIN_CODES = { codes: { INSUFFICIENT_BALANCE: 'marginInsufficient' as const } };

export const getAccount = (): Promise<Account> => get<Account>('/api/trading/account');
export const listPositions = (): Promise<Position[]> => get<Position[]>('/api/trading/positions');
export const listOrders = (): Promise<PendingOrder[]> => get<PendingOrder[]>('/api/trading/orders');
export const listHistory = (page: number, pageSize: number): Promise<Page<HistoryItem>> => get<Page<HistoryItem>>('/api/trading/history', { query: { page, pageSize } });

export const placeOrder = (req: PlaceOrderRequest): Promise<PlaceOrderResult> => post<PlaceOrderResult>('/api/trading/orders', req);

export const closePosition = (id: string): Promise<{ pnl: string; price: string }> => post<{ pnl: string; price: string }>(`/api/trading/positions/${encodeURIComponent(id)}/close`);

/** 不传表示取消 */
export async function updateTpSl(id: string, takeProfit?: string, stopLoss?: string): Promise<void> {
  await put<void>(`/api/trading/positions/${encodeURIComponent(id)}/tpsl`, { takeProfit, stopLoss });
}

export const addMargin = (id: string, amount: string): Promise<Position> => post<Position>(`/api/trading/positions/${encodeURIComponent(id)}/margin`, { amount }, MARGIN_CODES);

export async function modifyOrder(id: string, patch: { limitPrice: string; lots: string; takeProfit?: string; stopLoss?: string }): Promise<void> {
  await put<void>(`/api/trading/orders/${encodeURIComponent(id)}`, patch);
}

export async function cancelOrder(id: string): Promise<void> {
  await del<void>(`/api/trading/orders/${encodeURIComponent(id)}`);
}
