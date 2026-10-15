/**
 * 原型面板用到的模拟操作：模拟推送、触发止盈止损和强平、重置数据。
 */
import type { KycStatus } from '../api/types';
import { emit } from './bus';
import { resetDb } from './db';
import { protoTrigger } from './trading';
import { protoKycStatus, protoSetKyc, pushNotification } from './user';

export type PushKind = 'fill' | 'liquidation' | 'withdraw';

export function simulatePush(kind: PushKind): void {
  if (kind === 'fill') {
    pushNotification('fill', ['挂单已成交', 'Limit order filled'], ['XAUUSD 买入 0.20 手已按 4,080.00 成交。（原型模拟推送）', 'XAUUSD buy 0.20 lots filled at 4,080.00. (Prototype push)']);
  } else if (kind === 'liquidation') {
    pushNotification('liquidation', ['持仓被强平', 'Position liquidated'], ['GER40 卖出 0.50 手在 24,551.0 被强制平仓，盈亏 -61.06 USDT。（原型模拟推送）', 'GER40 sell 0.50 lots was liquidated at 24,551.0, P/L -61.06 USDT. (Prototype push)']);
  } else {
    pushNotification('withdraw', ['提现已完成', 'Withdrawal completed'], ['200.00 USDT（BSC）已上链完成，交易号 0x7f3a…e21b。（原型模拟推送）', '200.00 USDT (BSC) has been sent on-chain, tx 0x7f3a…e21b. (Prototype push)']);
    emit({ type: 'withdraw', status: 'completed', amount: '200.00' });
  }
}

export { protoTrigger, protoSetKyc, protoKycStatus };
export type { KycStatus };

export function resetPrototypeData(): void {
  resetDb();
  emit({ type: 'account' });
  emit({ type: 'positions' });
  emit({ type: 'orders' });
}
