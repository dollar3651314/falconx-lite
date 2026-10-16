/**
 * 交易推送 `WS /api/ws/trading`（需要登录，只推本人，`trading/order/TradingPush.java`）：
 * `account`、`positions`、`orders`、`trade`、`withdraw`、`deposit`、`notification`，格式和 types.ts 的 ServerEvent 一致。
 * 断线自动重连；重连后补发一次 account / positions / orders，让页面重新拉取断线期间可能漏掉的变化。
 */
import type { ServerEvent } from '../types';
import { ReconnectingSocket } from '../ws';
import { isLoggedIn, onSessionChange } from './session';

type Handler = (e: ServerEvent) => void;
const handlers = new Set<Handler>();

const TYPES = new Set<ServerEvent['type']>(['account', 'positions', 'orders', 'trade', 'withdraw', 'deposit', 'notification']);

function emit(e: ServerEvent): void {
  handlers.forEach((h) => h(e));
}

export function handleTradingMessage(msg: unknown): void {
  const e = msg as ServerEvent | undefined;
  if (!e || !TYPES.has(e.type)) return;
  if (e.type === 'notification' && !e.item) return;
  emit(e);
}

const socket = new ReconnectingSocket('/api/ws/trading', {
  onMessage: handleTradingMessage,
  onOpen: (_send, reconnect) => {
    if (!reconnect) return;
    emit({ type: 'account' });
    emit({ type: 'positions' });
    emit({ type: 'orders' });
  },
});

function sync(): void {
  if (isLoggedIn() && handlers.size > 0) socket.start();
  else if (!isLoggedIn()) socket.stop();
}
onSessionChange(sync);

export function subscribeEvents(h: Handler): () => void {
  handlers.add(h);
  sync();
  return () => {
    handlers.delete(h);
  };
}
