package com.falconx.lite.account.auth;

import com.falconx.lite.account.api.UserStatus;
import com.falconx.lite.account.auth.AuthMapper.UserInsert;
import com.falconx.lite.account.auth.AuthRequests.Register;
import com.falconx.lite.account.auth.Rows.Profile;
import com.falconx.lite.account.auth.Rows.UserRow;
import com.falconx.lite.common.error.BizException;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.wallet.api.WalletApi;
import java.util.Locale;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 注册、登录、密码和冻结。会话见 {@link SessionService}，失败计数见 {@link LoginLimiter}。 */
@Service
class AuthService {

  private final AuthMapper mapper;
  private final EmailCodeService codes;
  private final SessionService sessions;
  private final LoginLimiter limiter;
  private final LedgerApi ledger;
  private final WalletApi wallet;
  private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(10);

  AuthService(AuthMapper mapper, EmailCodeService codes, SessionService sessions, LoginLimiter limiter, LedgerApi ledger, WalletApi wallet) {
    this.mapper = mapper;
    this.codes = codes;
    this.sessions = sessions;
    this.limiter = limiter;
    this.ledger = ledger;
    this.wallet = wallet;
  }

  static String normalizeEmail(String email) {
    return email.trim().toLowerCase(Locale.ROOT);
  }

  /** 发验证码。注册：邮箱已注册时直接提示；重置密码：邮箱不存在时假装已发送，不暴露哪些邮箱注册过。 */
  void sendCode(String rawEmail, EmailCodeService.Purpose purpose) {
    String email = normalizeEmail(rawEmail);
    boolean exists = mapper.findUserByEmail(email) != null;
    if (purpose == EmailCodeService.Purpose.REGISTER && exists) throw new BizException("EMAIL_TAKEN", "邮箱已注册");
    if (purpose == EmailCodeService.Purpose.RESET_PASSWORD && !exists) return;
    codes.send(email, purpose);
  }

  /** 注册：建用户、资料、交易账户，返回用户 ID。同一个事务。 */
  @Transactional
  long register(Register r) {
    String email = normalizeEmail(r.email());
    if (mapper.findUserByEmail(email) != null) throw new BizException("EMAIL_TAKEN", "邮箱已注册");
    if (!codes.verifyAndConsume(email, EmailCodeService.Purpose.REGISTER, r.code())) throw new BizException("CODE_INVALID", "验证码错误或已失效");
    UserInsert u = new UserInsert(email, encoder.encode(r.password()));
    try {
      mapper.insertUser(u);
    } catch (DuplicateKeyException e) {
      throw new BizException("EMAIL_TAKEN", "邮箱已注册"); // 同一邮箱同时注册，唯一键兜底
    }
    mapper.insertProfile(new Profile(u.id, r.firstName().trim(), r.middleName() == null ? "" : r.middleName().trim(), r.lastName().trim(), r.birthDate(), r.nationality()));
    ledger.openAccount(u.id);
    // 注册时同步分配充值地址（需求 4.4-1）；服务器还没配置 xpub 时跳过，打开资产页时补分配
    wallet.allocateAddresses(u.id);
    return u.id;
  }

  /** 登录：成功返回用户；锁定、密码错误、冻结分别抛不同的错误码。用户不存在和密码错误用同一个错误码。 */
  UserRow login(String rawEmail, String password, String ip) {
    String email = normalizeEmail(rawEmail);
    if (limiter.isLocked(email, ip)) throw new BizException("LOGIN_LOCKED", "失败次数过多，请稍后再试");
    UserRow u = mapper.findUserByEmail(email);
    if (u == null || u.passwordHash() == null || !encoder.matches(password, u.passwordHash())) {
      limiter.recordFailure(email, ip);
      throw new BizException("INVALID_CREDENTIALS", "邮箱或密码错误");
    }
    if (!UserStatus.ACTIVE.name().equals(u.status())) throw new BizException("USER_FROZEN", "账号已冻结");
    limiter.clear(email, ip);
    mapper.touchLogin(u.id());
    return u;
  }

  /** 忘记密码：验证码重置，成功后所有登录失效（AC-03） */
  @Transactional
  void resetPassword(String rawEmail, String code, String password) {
    String email = normalizeEmail(rawEmail);
    UserRow u = mapper.findUserByEmail(email);
    if (u == null || !codes.verifyAndConsume(email, EmailCodeService.Purpose.RESET_PASSWORD, code)) throw new BizException("CODE_INVALID", "验证码错误或已失效");
    mapper.updatePassword(u.id(), encoder.encode(password));
    sessions.revokeAll(u.id(), null);
  }

  /** 修改密码：需要原密码；成功后其他设备的登录失效，当前设备保留（AC-03） */
  @Transactional
  void changePassword(long userId, String currentPassword, String newPassword, String currentToken) {
    UserRow u = mapper.findUserById(userId);
    if (u == null || !encoder.matches(currentPassword, u.passwordHash())) throw new BizException("CURRENT_PASSWORD_WRONG", "原密码错误");
    mapper.updatePassword(userId, encoder.encode(newPassword));
    sessions.revokeAll(userId, currentToken);
  }

  UserRow user(long userId) {
    UserRow u = mapper.findUserById(userId);
    if (u == null) throw new BizException("USER_NOT_FOUND", "用户不存在");
    return u;
  }

  @Transactional
  void freeze(long userId) {
    user(userId);
    mapper.updateStatus(userId, UserStatus.FROZEN.name());
    sessions.revokeAll(userId, null);
  }

  @Transactional
  void unfreeze(long userId) {
    user(userId);
    mapper.updateStatus(userId, UserStatus.ACTIVE.name());
  }

  UserStatus status(long userId) {
    return UserStatus.valueOf(user(userId).status());
  }
}
