/**
 * 账户、持仓、挂单的全局状态。数据来自接口，净值和浮动盈亏按实时报价在前端计算（仅展示）；
 * 可用余额按后端口径（浮动盈利不计入，lib/trading.ts 的 availableFunds）。
 */
import { useMemo, type ReactNode } from 'react';
import { getAccount, listOrders, listPositions } from '../api/trading';
import { useAsync } from '../hooks/useAsync';
import { useQuotes } from '../hooks/useQuotes';
import { useServerEvent } from '../hooks/useServerEvent';
import { add, dec, sum, ZERO } from '../lib/decimal';
import { availableFunds, marginLevel, positionPnl } from '../lib/trading';
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
    const perPosition = pos.data.map((p) => {
      const info = map[p.symbol];
      const q = quotes[p.symbol];
      // 没有报价或没有汇率时，这一笔的浮动盈亏按 0 计（和没有报价时一样）
      return { margin: dec(p.margin), pnl: (info && q ? positionPnl(p, info, q) : null) ?? ZERO };
    });
    const pnl = sum(perPosition.map((x) => x.pnl));
    const balance = dec(acc.data.balance);
    const equity = add(balance, pnl);
    const used = sum(perPosition.map((x) => x.margin));
    const orderFrozen = dec(acc.data.orderFrozen);
    return {
      balance,
      equity,
      usedMargin: used,
      // 浮动盈利不计入可用（和后端同一口径，DF-02）
      available: availableFunds(balance, orderFrozen, perPosition),
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
