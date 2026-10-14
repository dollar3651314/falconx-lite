/**
 * 分页列表 hook：保存筛选条件和页码，筛选变化时回到第 1 页。
 */
import { useCallback, useState } from 'react';
import type { Page, PageQuery } from '../api/types';
import { useApi } from './useApi';

export function usePagedList<T, F extends object>(fetch: (q: PageQuery & F) => Promise<Page<T>>, initialFilters: F, pageSize = 10) {
  const [filters, setFiltersState] = useState<F>(initialFilters);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);

  const fetcher = useCallback(() => fetch({ ...filters, page, pageSize: size }), [fetch, filters, page, size]);
  const state = useApi(fetcher);

  const setFilters = useCallback((next: F) => {
    setFiltersState(next);
    setPage(1);
  }, []);

  const onPageChange = useCallback((p: number, s: number) => {
    setPage(p);
    setSize(s);
  }, []);

  return { ...state, filters, setFilters, page, pageSize: size, onPageChange };
}
