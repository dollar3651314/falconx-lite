package com.falconx.lite.account.api;

/** account 模块对其他模块（主要是后台）开放的操作。 */
public interface AccountApi {

  /** 冻结：状态改为 FROZEN，立即作废该用户的所有登录（AC-04）。已经冻结时什么也不做。 */
  void freeze(long userId);

  /** 解冻：状态改回 ACTIVE；之前的登录不会恢复，需要重新登录。 */
  void unfreeze(long userId);

  /** 用户状态；用户不存在时抛 {@code BizException("USER_NOT_FOUND")}。 */
  UserStatus status(long userId);
}
