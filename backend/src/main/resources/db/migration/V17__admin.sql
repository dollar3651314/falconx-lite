-- V17（S16a）：后台管理员、会话、角色、菜单、审计，系统配置。说明见 技术方案/v1-数据库设计.md 2.34–2.41、第 18 节；方案见 技术方案/v1-后台方案.md

CREATE TABLE admin_user (
  id                   BIGINT       NOT NULL AUTO_INCREMENT,
  username             VARCHAR(40)  NOT NULL,
  display_name         VARCHAR(60)  NOT NULL,
  email                VARCHAR(254) NOT NULL,
  password_hash        VARCHAR(100) NOT NULL COMMENT 'BCrypt',
  status               VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE / DISABLED',
  must_change_password TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '首次登录、重置密码后必须先改密码',
  failed_count         INT          NOT NULL DEFAULT 0 COMMENT '连续登录失败次数',
  locked_until         DATETIME(3)  NULL,
  last_login_at        DATETIME(3)  NULL,
  created_at           DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_user_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='后台管理员';

CREATE TABLE admin_session (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  admin_id     BIGINT      NOT NULL,
  token_hash   CHAR(64)    NOT NULL COMMENT '令牌的 SHA-256，库里不存原值',
  ip           VARCHAR(45) NULL,
  created_at   DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  expires_at   DATETIME(3) NOT NULL COMMENT '最长有效期（8 小时）',
  revoked_at   DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_session_token (token_hash),
  KEY idx_admin_session_admin (admin_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='后台登录会话，和客户的会话分开';

CREATE TABLE admin_role (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  code        VARCHAR(40)  NOT NULL,
  name_zh     VARCHAR(60)  NOT NULL,
  name_en     VARCHAR(60)  NOT NULL,
  description VARCHAR(200) NOT NULL DEFAULT '',
  built_in    TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '内置角色不能删、不能改',
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_role_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色';

CREATE TABLE admin_role_permission (
  role_id    BIGINT      NOT NULL,
  permission VARCHAR(40) NOT NULL COMMENT '权限点，清单在代码里（admin/rbac/Permission.java）',
  PRIMARY KEY (role_id, permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色的权限点；超级管理员不在这里，自动拥有全部';

CREATE TABLE admin_user_role (
  admin_id BIGINT NOT NULL,
  role_id  BIGINT NOT NULL,
  PRIMARY KEY (admin_id, role_id),
  KEY idx_admin_user_role_role (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='管理员的角色';

CREATE TABLE admin_menu (
  menu_key   VARCHAR(40) NOT NULL COMMENT '菜单结构在代码里（admin/rbac/Menus.java），这里只存顺序和是否显示',
  sort_order INT         NOT NULL,
  visible    TINYINT(1)  NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (menu_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='菜单的顺序和显示';

CREATE TABLE admin_audit_log (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  admin_id    BIGINT        NULL COMMENT '登录失败等没有管理员时为空',
  admin_name  VARCHAR(40)   NOT NULL,
  ip          VARCHAR(45)   NULL,
  action      VARCHAR(60)   NOT NULL COMMENT '例如 admin.create、config.update',
  target      VARCHAR(200)  NOT NULL DEFAULT '',
  high_risk   TINYINT(1)    NOT NULL,
  result      VARCHAR(10)   NOT NULL COMMENT 'SUCCESS / FAILURE',
  reason      VARCHAR(500)  NULL COMMENT '高危操作的原因；失败时是错误码',
  before_json TEXT          NULL COMMENT '修改前（密码等字段记成 ***）',
  after_json  TEXT          NULL COMMENT '修改后（密码等字段记成 ***）',
  created_at  DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY idx_admin_audit_time (created_at),
  KEY idx_admin_audit_action (action, id),
  KEY idx_admin_audit_admin (admin_name, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审计日志，只增不改';

CREATE TABLE common_config (
  config_key VARCHAR(60)  NOT NULL,
  value      VARCHAR(1000) NOT NULL,
  updated_by BIGINT       NULL COMMENT '最后修改的管理员；初始值为空',
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统配置（后台可改），键的定义在 common/config/ConfigKey.java';

INSERT INTO admin_role (code, name_zh, name_en, description, built_in)
VALUES ('super_admin', '超级管理员', 'Super admin', '拥有全部权限；只有超级管理员能分配本角色', 1);

-- 初始值和 application.yml 的默认值一致（提现方案、充值方案、后台方案 G2、G5、通知方案 N4）
INSERT INTO common_config (config_key, value) VALUES
('withdraw.minAmount', '10'),
('withdraw.maxSingle', '10000'),
('withdraw.dailyLimit', '30000'),
('withdraw.coolingHours', '2'),
('withdraw.largeThreshold', '3000'),
('withdraw.largeDelayHours', '6'),
('withdraw.fee.ERC20', '5'),
('withdraw.fee.TRC20', '1'),
('withdraw.fee.BSC', '0.5'),
('whitelist.effectiveHours', '24'),
('whitelist.maxAddresses', '10'),
('deposit.confirmations.ERC20', '12'),
('deposit.confirmations.TRC20', '19'),
('deposit.confirmations.BSC', '15'),
('login.lockThreshold', '5'),
('login.lockMinutes', '30'),
('admin.ipWhitelist', ''),
('adjust.singleLimit', '5000'),
('adjust.dailyLimit', '20000'),
('notify.marginCallThrottleMinutes', '5');
