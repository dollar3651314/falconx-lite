import type { TFunction } from 'i18next';
import { ApiError } from '../api/types';

/** 把接口错误转成给人看的具体原因（不显示错误代码） */
export function errorText(t: TFunction, err: unknown): string {
  if (err instanceof ApiError) return t(err.reasonKey, err.params ?? {});
  return t('errors.unknown');
}
