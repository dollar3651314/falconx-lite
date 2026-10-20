/**
 * v2 资金归集（技术方案/v2-半自动归集.md，推荐路线 (b)）：页面路径、链、归集方式、手续费币、权限点、地址格式校验。
 * - 以太坊（ERC20）、BSC：合约转发地址（BitGo ForwarderV4）+ 服务器自动批量归集，钱只能进 Safe 多签冷钱包（parent，写在合约里，后台只读）；
 * - TRON（TRC20）：普通地址 + Amos 离线签名（方案附录 B）；广播前给每个充值地址租能量（Amos 10-20：直接租能量，方案 v1.1 第 4.3 节），
 *   租不到时回退到热钱包补 TRX；冷钱包地址在后台配置、24 小时后生效。
 *
 * 现在只有原型：合约、后端、离线签名工具都还没实现，真实接口模式下对账页不显示"资金归集"入口，四个归集页面显示"未上线"。
 * 原型借用已有权限点（不改前后端一致的权限点清单）：查看 recon:view，执行 / 生成 / 导入 / 广播 / 作废 recon:resolve，改设置 config:edit；
 * 正式版换成方案 SW-12 的 sweep:view、sweep:operate、sweep:config。后端上线后把 SWEEP_UI 改成 true。
 *
 * Fund sweeping (prototype only until contracts, backend and the offline signer ship).
 */
import { IS_MOCK } from '../api/mode';
import type { SweepChain, SweepMode } from '../api/types';

/** 归集界面是否显示：现在只在原型（模拟数据）模式下显示 */
export const SWEEP_UI = IS_MOCK;

export const SWEEP_BASE = '/funds/reconciliation/sweep';

export const SWEEP_CHAINS: SweepChain[] = ['ERC20', 'BSC', 'TRC20'];

/** 每条链的归集方式（路线 (b)） */
export const SWEEP_MODE: Record<SweepChain, SweepMode> = { ERC20: 'contract', BSC: 'contract', TRC20: 'offline' };

/** 每条链的手续费币 */
export const GAS_ASSET: Record<SweepChain, string> = { ERC20: 'ETH', BSC: 'BNB', TRC20: 'TRX' };

/**
 * 归集门槛和手续费占比上限的默认值（Amos 10-20 审核 SW-6："归集门槛可以让我在后台改，默认值使用你的建议"）。
 * 后台归集设置页可改（高危、原因必填、审计），页面上显示默认值方便对照。
 */
export const SWEEP_DEFAULTS = {
  thresholds: { ERC20: '100', BSC: '10', TRC20: '100' } as Record<SweepChain, string>,
  maxFeeRatioPct: '3',
};

/** 原型借用的权限点（正式版：sweep:view / sweep:operate / sweep:config） */
export const SWEEP_PERM = { view: 'recon:view', operate: 'recon:resolve', config: 'config:edit' } as const;

const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** TRON 冷钱包地址格式：T 开头的 34 位 Base58（正式版再做校验和） */
export function isTronAddress(address: string): boolean {
  return TRON_RE.test(address.trim());
}

/** 门槛、上限等数值：非负、最多 6 位小数 */
export function isSweepNumber(v: string | undefined): boolean {
  return /^\d+(\.\d{1,6})?$/.test((v ?? '').trim());
}
