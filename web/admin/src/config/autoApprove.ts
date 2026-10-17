/**
 * v2 提现自动审批的规则定义（技术方案/v2-提现自动审批.md 第 4 节）：12 条规则的编号、数值参数、单位、默认值和取值范围。
 * 规则名称、说明、判定结果的文字在翻译文件的 autoRule 下（中英文）。
 *
 * 现在只有原型：后端还没实现，真实接口模式下这些界面不显示（出金审核页不显示"规则判定"列、筛选和卡片，
 * 规则设置页显示"未上线"）。后端上线后把 AUTO_APPROVE_UI 改成 true（或改成看后端返回的开关）。
 *
 * Auto-approval rule definitions (prototype only until the backend ships).
 */
import type { AutoRuleCode } from '../api/types';
import { IS_MOCK } from '../api/mode';

/** 自动审批的界面是否显示：现在只在原型（模拟数据）模式下显示 */
export const AUTO_APPROVE_UI = IS_MOCK;

export type RuleParamUnit = 'usdt' | 'hours' | 'days' | 'times' | 'multiple' | 'percent';

export interface RuleParamDef {
  key: string;
  unit: RuleParamUnit;
  /** 默认值（Amos 2026-10-17 确认的规则表） */
  defaultValue: string;
  min: number;
  max: number;
  /** 最多几位小数；0 表示整数 */
  decimals: number;
}

export interface AutoRuleDef {
  code: AutoRuleCode;
  params: RuleParamDef[];
}

const usdt = (key: string, defaultValue: string, max = 1_000_000): RuleParamDef => ({ key, unit: 'usdt', defaultValue, min: 0.01, max, decimals: 2 });

export const AUTO_RULES: AutoRuleDef[] = [
  { code: 'R1', params: [usdt('maxAmount', '500')] },
  { code: 'R2', params: [usdt('maxUser24h', '2000')] },
  { code: 'R3', params: [usdt('maxPlatform24h', '20000', 100_000_000)] },
  { code: 'R4', params: [] },
  { code: 'R5', params: [] },
  { code: 'R6', params: [{ key: 'hours', unit: 'hours', defaultValue: '48', min: 1, max: 720, decimals: 0 }] },
  { code: 'R7', params: [{ key: 'days', unit: 'days', defaultValue: '7', min: 0, max: 365, decimals: 0 }] },
  { code: 'R8', params: [{ key: 'multiple', unit: 'multiple', defaultValue: '1', min: 0, max: 100, decimals: 2 }] },
  { code: 'R9', params: [] },
  { code: 'R10', params: [usdt('maxProfit7d', '5000'), { key: 'maxProfitPct', unit: 'percent', defaultValue: '50', min: 1, max: 1000, decimals: 0 }] },
  { code: 'R11', params: [{ key: 'maxCount', unit: 'times', defaultValue: '3', min: 1, max: 50, decimals: 0 }] },
  { code: 'R12', params: [] },
];

export const AUTO_RULE_CODES: AutoRuleCode[] = AUTO_RULES.map((r) => r.code);

/** 数值参数的校验：返回翻译键和参数，合法时返回 null */
export function ruleParamProblem(def: RuleParamDef, raw: string | undefined): { key: string; params?: Record<string, string | number> } | null {
  const v = (raw ?? '').trim();
  if (!v) return { key: 'autoApprove.errRequired' };
  const re = def.decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${def.decimals}})?$`);
  if (!re.test(v)) return def.decimals === 0 ? { key: 'autoApprove.errInteger' } : { key: 'autoApprove.errDecimals', params: { n: def.decimals } };
  const n = Number(v);
  if (n < def.min || n > def.max) return { key: 'autoApprove.errRange', params: { min: def.min, max: def.max } };
  return null;
}

/** 规则之间的关系：单笔 ≤ 客户 24 小时 ≤ 全平台 24 小时（否则后面的规则没有意义），返回出问题的参数位置 */
export function crossRuleProblems(params: Partial<Record<AutoRuleCode, Record<string, string>>>): { code: AutoRuleCode; key: string; msg: string }[] {
  const r1 = Number(params.R1?.maxAmount);
  const r2 = Number(params.R2?.maxUser24h);
  const r3 = Number(params.R3?.maxPlatform24h);
  const out: { code: AutoRuleCode; key: string; msg: string }[] = [];
  if (Number.isFinite(r1) && Number.isFinite(r2) && r1 > r2) out.push({ code: 'R2', key: 'maxUser24h', msg: 'autoApprove.errR2LtR1' });
  if (Number.isFinite(r2) && Number.isFinite(r3) && r2 > r3) out.push({ code: 'R3', key: 'maxPlatform24h', msg: 'autoApprove.errR3LtR2' });
  return out;
}
