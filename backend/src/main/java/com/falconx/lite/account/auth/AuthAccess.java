package com.falconx.lite.account.auth;

import com.falconx.lite.account.api.UserStatus;
import org.springframework.stereotype.Component;

/** 给 account 模块其他包（例如 {@code AccountFacade}）用的登录相关操作，auth 包的内部类不对外。 */
@Component
public class AuthAccess {

  private final AuthService auth;

  AuthAccess(AuthService auth) {
    this.auth = auth;
  }

  public void freeze(long userId) {
    auth.freeze(userId);
  }

  public void unfreeze(long userId) {
    auth.unfreeze(userId);
  }

  public UserStatus status(long userId) {
    return auth.status(userId);
  }

  public String email(long userId) {
    return auth.user(userId).email();
  }
}
