import zh from '../i18n/zh-CN.json';
import en from '../i18n/en.json';
import { ApiError, errorKey, FIELD_CODES, fromServer, SERVER_CODES } from './errors';

const has = (o: unknown, key: string) => key.split('.').reduce<unknown>((x, p) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[p] : undefined), o) !== undefined;

describe('后端错误码映射', () => {
  it('每个后端错误码和字段错误码都有中英文翻译（AC-27）', () => {
    const keys = [...Object.values(SERVER_CODES).map((r) => `errors.${r}`), ...Object.values(FIELD_CODES), 'errors.unauthorized', 'errors.forbidden', 'errors.notFound', 'errors.badRequest', 'errors.withdrawInsufficient'];
    expect(keys.filter((k) => !has(zh, k))).toEqual([]);
    expect(keys.filter((k) => !has(en, k))).toEqual([]);
  });

  it('业务错误码换成 reason，不显示错误代码', () => {
    const e = fromServer(400, { code: 'SYMBOL_PAUSED', message: '暂停', fields: [] });
    expect(e.reason).toBe('symbolPaused');
    expect(e.status).toBe(400);
    expect(errorKey(e)).toBe('errors.symbolPaused');
  });

  it('字段错误：两种写法的错误码都能翻译，按字段区分的优先', () => {
    const e = fromServer(400, {
      code: 'VALIDATION_FAILED',
      fields: [
        { field: 'email', code: 'EMAIL_INVALID' },
        { field: 'lots', code: 'lotsMin' },
        { field: 'label', code: 'tooLong' },
        { field: 'clientOrderId', code: 'tooLong' },
        { field: 'x', code: 'SOMETHING_NEW' },
      ],
    });
    expect(e.reason).toBe('validationFailed');
    expect(e.fieldErrors).toEqual({
      email: ['validation.emailFormat'],
      lots: ['validation.lotsMin'],
      label: ['validation.labelTooLong'],
      clientOrderId: ['validation.tooLong'],
      x: ['validation.invalid'],
    });
    // 页面没有逐个字段显示时，显示第一个字段的原因
    expect(errorKey(e)).toBe('validation.emailFormat');
  });

  it('接口特有的含义、字段改名、业务错误标在字段上', () => {
    const e = fromServer(
      400,
      { code: 'CURRENT_PASSWORD_WRONG', fields: [{ field: 'newPassword', code: 'PASSWORD_LENGTH' }] },
      { fieldNames: { newPassword: 'password' }, codeFields: { CURRENT_PASSWORD_WRONG: 'current' } },
    );
    expect(e.reason).toBe('passwordWrong');
    expect(e.fieldErrors).toEqual({ password: ['validation.passwordLength'], current: ['errors.passwordWrong'] });
    expect(fromServer(400, { code: 'INSUFFICIENT_BALANCE' }, { codes: { INSUFFICIENT_BALANCE: 'withdrawInsufficient' } }).reason).toBe('withdrawInsufficient');
  });

  it('没有错误体或不认识的错误码按 HTTP 状态处理', () => {
    expect(fromServer(502, undefined).reason).toBe('server');
    expect(fromServer(401, undefined).reason).toBe('unauthorized');
    expect(fromServer(404, { code: 'WHATEVER' }).reason).toBe('notFound');
    expect(fromServer(409, { code: 'BRAND_NEW' }).reason).toBe('badRequest');
  });

  it('非接口错误显示"服务暂时不可用"', () => {
    expect(errorKey(new Error('x'))).toBe('errors.server');
    expect(errorKey(new ApiError('network'))).toBe('errors.network');
  });
});
