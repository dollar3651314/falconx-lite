/**
 * 通用取数 hook：管理加载中 / 出错 / 数据三种状态，场景切换或调用 reload() 时重新加载。
 * fetcher 需要用 useCallback 包好，依赖变化时自动重新请求。
 */
import { useCallback, useEffect, useState } from 'react';
import { useScenarioVersion } from './useScenarioVersion';

export interface ApiState<T> {
  data: T | undefined;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

export function useApi<T>(fetcher: () => Promise<T>): ApiState<T> {
  const version = useScenarioVersion();
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: unknown }>({ data: undefined, loading: true, error: null });

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher().then(
      (data) => alive && setState({ data, loading: false, error: null }),
      (error: unknown) => alive && setState({ data: undefined, loading: false, error }),
    );
    return () => {
      alive = false;
    };
  }, [fetcher, version, tick]);

  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { ...state, reload };
}
