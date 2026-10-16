package com.falconx.lite.account.auth;

import com.falconx.lite.account.auth.Rows.EmailCodeRow;
import com.falconx.lite.common.error.RetryLaterException;
import com.falconx.lite.notification.api.MailApi;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 邮箱验证码：6 位数字，10 分钟有效，60 秒内不能重发，最多试 5 次，用过即作废。库里只存哈希。
 */
@Service
class EmailCodeService {

  enum Purpose { REGISTER, RESET_PASSWORD }

  private final AuthMapper mapper;
  private final MailApi mail;
  private final AuthProperties props;

  EmailCodeService(AuthMapper mapper, MailApi mail, AuthProperties props) {
    this.mapper = mapper;
    this.mail = mail;
    this.props = props;
  }

  private static String hash(String email, Purpose purpose, String code) {
    return Secrets.sha256(email + ":" + purpose + ":" + code);
  }

  /**
   * 发送验证码。60 秒内重发抛 {@link RetryLaterException}（429，带剩余秒数）。
   *
   * @return 下次可以重发前要等的秒数（客户端按它倒计时）
   */
  @Transactional
  int send(String email, Purpose purpose) {
    EmailCodeRow last = mapper.latestEmailCode(email, purpose.name());
    if (last != null && last.ageSeconds() < props.codeResendSeconds()) {
      throw new RetryLaterException("CODE_TOO_FREQUENT", "发送太频繁，请稍后再试", props.codeResendSeconds() - last.ageSeconds());
    }
    String code = Secrets.newCode();
    mapper.insertEmailCode(email, purpose.name(), hash(email, purpose, code), props.codeTtlMinutes());
    mail.send(email, "EMAIL_CODE", Map.of("code", code, "purpose", purpose.name()));
    return props.codeResendSeconds();
  }

  /** 两次发送之间的冷却秒数（配置值） */
  int cooldownSeconds() {
    return props.codeResendSeconds();
  }

  /**
   * 校验并作废验证码。单独提交（REQUIRES_NEW）：校验失败时尝试次数也要记下来，不能随调用方的事务回滚。
   *
   * @return 是否通过
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  boolean verifyAndConsume(String email, Purpose purpose, String code) {
    EmailCodeRow row = mapper.latestEmailCode(email, purpose.name());
    if (row == null || row.expired() || row.consumed() || row.attempts() >= props.codeMaxAttempts()) return false;
    if (code == null || !hash(email, purpose, code.trim()).equals(row.codeHash())) {
      mapper.incrementCodeAttempts(row.id());
      return false;
    }
    return mapper.consumeCode(row.id()) == 1;
  }
}
