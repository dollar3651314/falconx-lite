/** 服务端推送事件（正式环境：WebSocket 频道 + Web Push）。 */
import { onServerEvent } from '../mocks/bus';
import type { ServerEvent } from './types';

export const subscribeEvents = (h: (e: ServerEvent) => void): (() => void) => onServerEvent(h);
