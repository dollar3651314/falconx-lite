/**
 * 接口错误。页面只显示 reason 对应的文案（i18n 键 errors.<reason>），不显示错误代码。
 */
import type { OrderRejectReason } from './types';

export type ApiErrorReason =
  | 'network'
  | 'server'
  | 'timeout'
  | 'unauthorized'
  | 'invalidCredentials'
  | 'accountLocked'
  | 'emailTaken'
  | 'codeInvalid'
  | 'codeTooFrequent'
  | 'passwordWrong'
  | 'kycRequired'
  | 'whitelistFull'
  | 'whitelistDuplicate'
  | 'withdrawNotCancellable'
  | 'withdrawInvalid'
  | 'notFound'
  | 'marginInsufficient'
  | OrderRejectReason;

export class ApiError extends Error {
  readonly reason: ApiErrorReason;
  /** 字段级错误：键是字段名，值是 i18n 键（用于一次显示全部错误） */
  readonly fieldErrors?: Record<string, string[]>;

  constructor(reason: ApiErrorReason, fieldErrors?: Record<string, string[]>) {
    super(reason);
    this.name = 'ApiError';
    this.reason = reason;
    this.fieldErrors = fieldErrors;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** 把任意错误转换成 i18n 键 */
export function errorKey(e: unknown): string {
  return isApiError(e) ? `errors.${e.reason}` : 'errors.server';
}
