/**
 * 交易：下单、持仓、挂单、止盈止损、强平、隔夜费（S7–S10）。
 * <p>模块边界（00-架构方案.md 3.2，ArchUnit 测试 {@code ModuleBoundaryTest} 强制）：其他模块只能调用本模块 {@code api} 包里的类，
 * 不能访问本模块的其他包和数据表。
 */
package com.falconx.lite.trading;
