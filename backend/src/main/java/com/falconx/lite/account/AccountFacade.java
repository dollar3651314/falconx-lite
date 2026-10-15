package com.falconx.lite.account;

import com.falconx.lite.account.api.AccountApi;
import com.falconx.lite.account.api.KycStatus;
import com.falconx.lite.account.api.UserStatus;
import com.falconx.lite.account.auth.AuthAccess;
import com.falconx.lite.account.kyc.KycAccess;
import org.springframework.stereotype.Service;

/** {@link AccountApi} 的实现：把登录和 KYC 两部分的对外操作合在一起。 */
@Service
class AccountFacade implements AccountApi {

  private final AuthAccess auth;
  private final KycAccess kyc;

  AccountFacade(AuthAccess auth, KycAccess kyc) {
    this.auth = auth;
    this.kyc = kyc;
  }

  @Override
  public void freeze(long userId) {
    auth.freeze(userId);
  }

  @Override
  public void unfreeze(long userId) {
    auth.unfreeze(userId);
  }

  @Override
  public UserStatus status(long userId) {
    return auth.status(userId);
  }

  @Override
  public String email(long userId) {
    return auth.email(userId);
  }

  @Override
  public KycStatus kycStatus(long userId) {
    return kyc.status(userId);
  }

  @Override
  public void approveKyc(long applicationId, long reviewerId) {
    kyc.approve(applicationId, reviewerId);
  }

  @Override
  public void rejectKyc(long applicationId, long reviewerId, String reason) {
    kyc.reject(applicationId, reviewerId, reason);
  }
}
