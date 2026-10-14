/**
 * 账户、持仓、挂单的全局状态。数据来自接口，净值和浮动盈亏按实时报价在前端计算（仅展示）。
 */
import { useMemo, type ReactNode } from 'react';
import { getAccount, listOrders, listPositions } from '../api/trading';
import { useAsync } from '../hooks/useAsync';
import { useQuotes } from '../hooks/useQuotes';
import { useServerEvent } from '../hooks/useServerEvent';
import { add, dec, sub, sum, ZERO } from '../lib/decimal';
import { marginLevel, positionPnl } from '../lib/trading';
import { AccountContext, useSymbols, type AccountMetrics } from './contexts';

export function AccountProvider({ children }: { children: ReactNode }) {
  const acc = useAsync(getAccount, 'account');
  const pos = useAsync(listPositions, 'positions');
  const ord = useAsync(listOrders, 'orders');
  const { map } = useSymbols();
  const quotes = useQuotes();

  useServerEvent((e) => {
    if (e.type === 'account') acc.reload();
    if (e.type === 'positions') pos.reload();
    if (e.type === 'orders') ord.reload();
  });

  const metrics = useMemo<AccountMetrics | undefined>(() => {
    if (!acc.data || !pos.data) return undefined;
    let pnl = ZERO;
    for (const p of pos.data) {
      const info = map[p.symbol];
      const q = quotes[p.symbol];
      if (info && q) pnl = add(pnl, positionPnl(p, info, q));
    }
    const balance = dec(acc.data.balance);
    const equity = add(balance, pnl);
    const used = sum(pos.data.map((p) => dec(p.margin)));
    const orderFrozen = dec(acc.data.orderFrozen);
    return {
      balance,
      equity,
      usedMargin: used,
      available: sub(sub(equity, used), orderFrozen),
      floatingPnl: pnl,
      marginLevel: marginLevel(equity, used),
      withdrawFrozen: dec(acc.data.withdrawFrozen),
      orderFrozen,
    };
  }, [acc.data, pos.data, map, quotes]);

  const value = useMemo(
    () => ({
      // 只有首次加载（还没有数据）才算加载中，推送触发的刷新不闪烁
      loading: (acc.loading && !acc.data) || (pos.loading && !pos.data) || (ord.loading && !ord.data),
      error: acc.error ?? pos.error ?? ord.error,
      account: acc.data,
      positions: pos.data ?? [],
      orders: ord.data ?? [],
      metrics,
      reload: () => {
        acc.reload();
        pos.reload();
        ord.reload();
      },
    }),
    [acc, pos, ord, metrics],
  );
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
