package com.falconx.lite.account.auth;

import com.falconx.lite.account.auth.Rows.EmailCodeRow;
import com.falconx.lite.account.auth.Rows.Profile;
import com.falconx.lite.account.auth.Rows.SessionRow;
import com.falconx.lite.account.auth.Rows.UserRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 账户模块的 SQL，见 resources/mapper/account/AuthMapper.xml。 */
@Mapper
interface AuthMapper {

  UserRow findUserByEmail(@Param("email") String email);

  UserRow findUserById(@Param("id") long id);

  int insertUser(UserInsert user);

  int insertProfile(Profile profile);

  int updatePassword(@Param("id") long id, @Param("passwordHash") String passwordHash);

  int updateStatus(@Param("id") long id, @Param("status") String status);

  int touchLogin(@Param("id") long id);

  int insertEmailCode(@Param("email") String email, @Param("purpose") String purpose, @Param("codeHash") String codeHash, @Param("ttlMinutes") int ttlMinutes);

  /** 发验证码时用，不加锁（见 XML 注释，压测 LT-1） */
  EmailCodeRow latestEmailCodeForSend(@Param("email") String email, @Param("purpose") String purpose);

  EmailCodeRow latestEmailCode(@Param("email") String email, @Param("purpose") String purpose);

  /** 最近 hours 小时内给这个邮箱发过几次这种用途的验证码 */
  int countEmailCodesSince(@Param("email") String email, @Param("purpose") String purpose, @Param("hours") int hours);

  int incrementCodeAttempts(@Param("id") long id);

  int consumeCode(@Param("id") long id);

  int insertSession(@Param("userId") long userId, @Param("tokenHash") String tokenHash, @Param("ip") String ip, @Param("userAgent") String userAgent, @Param("ttlHours") int ttlHours);

  SessionRow findActiveSession(@Param("tokenHash") String tokenHash);

  int extendSession(@Param("id") long id, @Param("ttlHours") int ttlHours);

  int revokeSession(@Param("tokenHash") String tokenHash);

  int revokeUserSessions(@Param("userId") long userId, @Param("exceptTokenHash") String exceptTokenHash);

  /** 插入用户时 MyBatis 回填 id */
  final class UserInsert {
    Long id;
    final String email;
    final String passwordHash;

    UserInsert(String email, String passwordHash) {
      this.email = email;
      this.passwordHash = passwordHash;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getEmail() { return email; }
    public String getPasswordHash() { return passwordHash; }
  }
}
