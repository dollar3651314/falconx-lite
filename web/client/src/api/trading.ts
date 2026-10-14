/** 交易接口。正式环境：/api/trading/*，推送走 WebSocket。 */
import * as mock from '../mocks/trading';
import type { Account, HistoryItem, Page, PendingOrder, PlaceOrderRequest, PlaceOrderResult, Position } from './types';

export const getAccount = (): Promise<Account> => mock.getAccount();
export const listPositions = (): Promise<Position[]> => mock.listPositions();
export const listOrders = (): Promise<PendingOrder[]> => mock.listOrders();
export const listHistory = (page: number, pageSize = 20): Promise<Page<HistoryItem>> => mock.listHistory(page, pageSize);
export const placeOrder = (req: PlaceOrderRequest): Promise<PlaceOrderResult> => mock.placeOrder(req);
export const closePosition = (id: string) => mock.closePosition(id);
export const updateTpSl = (id: string, tp?: string, sl?: string) => mock.updateTpSl(id, tp, sl);
export const addMargin = (id: string, amount: string) => mock.addMargin(id, amount);
export const modifyOrder = (id: string, patch: { limitPrice: string; lots: string; takeProfit?: string; stopLoss?: string }) => mock.modifyOrder(id, patch);
export const cancelOrder = (id: string) => mock.cancelOrder(id);
/** 启动行情驱动的撮合（正式环境在服务端，前端无此调用） */
export const startEngine = (): void => mock.ensureEngine();
export const POSITION_LIMIT_USD = mock.POSITION_LIMIT_USD;
