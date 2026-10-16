/** 交易接口。real：/api/trading/*，推送走 WebSocket（events.ts）；mock：原型模拟层（见 mode.ts）。 */
import * as mock from '../mocks/trading';
import { IS_MOCK } from './mode';
import * as real from './real/trading';
import type { Account, HistoryItem, Page, PendingOrder, PlaceOrderRequest, PlaceOrderResult, Position } from './types';

const done = (): void => undefined;

export const getAccount = (): Promise<Account> => (IS_MOCK ? mock.getAccount() : real.getAccount());
export const listPositions = (): Promise<Position[]> => (IS_MOCK ? mock.listPositions() : real.listPositions());
export const listOrders = (): Promise<PendingOrder[]> => (IS_MOCK ? mock.listOrders() : real.listOrders());
export const listHistory = (page: number, pageSize = 20): Promise<Page<HistoryItem>> => (IS_MOCK ? mock.listHistory(page, pageSize) : real.listHistory(page, pageSize));
export const placeOrder = (req: PlaceOrderRequest): Promise<PlaceOrderResult> => (IS_MOCK ? mock.placeOrder(req) : real.placeOrder(req));
export const closePosition = (id: string): Promise<{ pnl: string; price: string }> => (IS_MOCK ? mock.closePosition(id) : real.closePosition(id));
/** 不传表示取消 */
export const updateTpSl = (id: string, tp?: string, sl?: string): Promise<void> => (IS_MOCK ? mock.updateTpSl(id, tp, sl).then(done) : real.updateTpSl(id, tp, sl));
export const addMargin = (id: string, amount: string): Promise<Position> => (IS_MOCK ? mock.addMargin(id, amount) : real.addMargin(id, amount));
export const modifyOrder = (id: string, patch: { limitPrice: string; lots: string; takeProfit?: string; stopLoss?: string }): Promise<void> =>
  IS_MOCK ? mock.modifyOrder(id, patch).then(done) : real.modifyOrder(id, patch);
export const cancelOrder = (id: string): Promise<void> => (IS_MOCK ? mock.cancelOrder(id) : real.cancelOrder(id));
/** 原型：启动浏览器内的撮合（真实环境撮合在服务端，这里什么都不做） */
export const startEngine = (): void => {
  if (IS_MOCK) mock.ensureEngine();
};
