package com.falconx.lite.account.kyc;

import com.falconx.lite.account.api.KycStatus;
import com.falconx.lite.account.auth.AuthAccess;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** 给 {@code AccountFacade} 用的 KYC 操作。 */
@Component
public class KycAccess {

  private final KycService kyc;
  private final AuthAccess auth;

  KycAccess(KycService kyc, AuthAccess auth) {
    this.kyc = kyc;
    this.auth = auth;
  }

  public KycStatus status(long userId) {
    return kyc.status(userId);
  }

  @Transactional
  public void approve(long applicationId, long reviewerId) {
    kyc.approve(applicationId, reviewerId, auth.email(kyc.userOf(applicationId)));
  }

  @Transactional
  public void reject(long applicationId, long reviewerId, String reason) {
    kyc.reject(applicationId, reviewerId, reason, auth.email(kyc.userOf(applicationId)));
  }
}
