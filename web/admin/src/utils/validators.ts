/**
 * 表单校验规则（纯函数，便于单元测试）。返回翻译键列表：一次给出全部问题（规则 C56）。
 */
import { compareAmounts, isValidAmountInput } from './money';

export const PASSWORD_MIN = 10;

/** 新密码规则：至少 10 位，同时包含字母和数字，不能与旧密码相同 */
export function passwordProblems(pw: string, oldPw?: string): string[] {
  const problems: string[] = [];
  if (pw.length < PASSWORD_MIN) problems.push('validation.pwdMin');
  if (!/[A-Za-z]/.test(pw)) problems.push('validation.pwdLetter');
  if (!/\d/.test(pw)) problems.push('validation.pwdDigit');
  if (oldPw && pw === oldPw) problems.push('validation.pwdSame');
  return problems;
}

/** 余额调整金额：正数、最多 2 位小数、不超过单笔上限、今日累计不超过每日上限 */
export function adjustAmountProblems(amount: string, singleLimit: string, dailyRemaining: string): string[] {
  const text = (amount ?? '').trim();
  if (!text) return ['validation.amountRequired'];
  if (!isValidAmountInput(text)) return ['validation.amountFormat'];
  const problems: string[] = [];
  if (compareAmounts(text, singleLimit) > 0) problems.push('validation.overSingle');
  if (compareAmounts(text, dailyRemaining) > 0) problems.push('validation.overDaily');
  return problems;
}

/** 百分比（追保线、强平线）：0 < x ≤ 1000，最多 2 位小数 */
export function isValidPercent(text: string): boolean {
  return isValidAmountInput(text, 2) && compareAmounts(text, '1000') <= 0;
}

/** 正整数（USD 阈值等） */
export function isPositiveInteger(text: string): boolean {
  return /^[1-9]\d{0,12}$/.test((text ?? '').trim());
}

/** 费率：可以为负（隔夜费），最多 8 位小数 */
export function isValidRate(text: string): boolean {
  return /^-?\d+(\.\d{1,8})?$/.test((text ?? '').trim());
}

export const USERNAME_RE = /^[a-z][a-z0-9._-]{2,39}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
