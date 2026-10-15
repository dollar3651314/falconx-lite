package com.falconx.lite.trading.api;

/**
 * 账户和账本：所有模块改余额都只能走这里（00-架构方案.md 3.3 ②）。
 * <ul>
 *   <li>余额变动和账本记录在同一个数据库事务里；调用方已有事务时加入调用方的事务，一起提交或一起回滚。</li>
 *   <li>同一个幂等键（bizType、bizId、type、bucket）只记一次账，重复调用返回第一次的结果。</li>
 *   <li>任何一项不能变成负数，余额不足抛 {@code BizException("INSUFFICIENT_FUNDS")}。</li>
 *   <li>同一账户的变动按行锁排队，并发安全。</li>
 * </ul>
 */
public interface LedgerApi {

  /** 开户：已有账户时什么也不做。 */
  void openAccount(long userId);

  LedgerResult apply(LedgerCommand command);

  AccountSnapshot snapshot(long userId);
}
