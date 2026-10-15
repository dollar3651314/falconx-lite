import { useMemo, type ReactNode } from 'react';
import { listSymbols } from '../api/market';
import { useAsync } from '../hooks/useAsync';
import { SymbolsContext } from './contexts';

export function SymbolsProvider({ children }: { children: ReactNode }) {
  const s = useAsync(listSymbols, 'symbols');
  const value = useMemo(() => {
    const list = s.data ?? [];
    return { list, map: Object.fromEntries(list.map((x) => [x.code, x])), loading: s.loading, error: s.error, reload: s.reload };
  }, [s.data, s.loading, s.error, s.reload]);
  return <SymbolsContext.Provider value={value}>{children}</SymbolsContext.Provider>;
}
