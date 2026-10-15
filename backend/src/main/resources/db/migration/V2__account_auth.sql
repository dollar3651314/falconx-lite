-- V2（S4）：账户模块的登录相关表。说明见 技术方案/v1-数据库设计.md 第 2.5–2.7 节。

ALTER TABLE account_user
  ADD COLUMN last_login_at DATETIME(3) NULL AFTER status;

-- 注册时填写的 5 项资料（需求 4.1-1）。KYC 通过后锁定（S5）
CREATE TABLE account_profile (
  user_id     BIGINT      NOT NULL,
  first_name  VARCHAR(64) NOT NULL,
  middle_name VARCHAR(64) NOT NULL DEFAULT '',
  last_name   VARCHAR(64) NOT NULL,
  birth_date  DATE        NOT NULL,
  nationality CHAR(2)     NOT NULL COMMENT 'ISO 3166-1 两位字母',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户资料';

-- 邮箱验证码：只存哈希；10 分钟有效；最多试 5 次；用过即作废
CREATE TABLE account_email_code (
  id          BIGINT      NOT NULL AUTO_INCREMENT,
  email       VARCHAR(254) NOT NULL,
  purpose     VARCHAR(16) NOT NULL COMMENT 'REGISTER / RESET_PASSWORD',
  code_hash   CHAR(64)    NOT NULL,
  attempts    INT         NOT NULL DEFAULT 0,
  expires_at  DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_account_email_code (email, purpose, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='邮箱验证码';

-- 登录会话：浏览器里只有随机令牌（HttpOnly Cookie），库里只存令牌的哈希
CREATE TABLE account_session (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  user_id      BIGINT       NOT NULL,
  token_hash   CHAR(64)     NOT NULL,
  ip           VARCHAR(45)  NULL,
  user_agent   VARCHAR(255) NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at   DATETIME(3)  NOT NULL,
  revoked_at   DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_account_session_token (token_hash),
  KEY idx_account_session_user (user_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='登录会话';
