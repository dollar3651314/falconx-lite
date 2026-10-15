-- V1（S3）：第一批表。表名以所属模块开头，每张表只由所属模块的代码读写（00-架构方案.md 3.2、3.4）。
-- 金额一律 DECIMAL(24,8)，不用浮点（项目地图约定 2）。时间一律 UTC，DATETIME(3)。
-- 表结构说明：技术方案/v1-数据库设计.md

-- account 模块：用户（S4 再补登录、验证码等字段和表）
CREATE TABLE account_user (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  email         VARCHAR(254) NOT NULL,
  password_hash VARCHAR(100) NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE / FROZEN',
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_account_user_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户';

-- trading 模块：交易账户。每个用户一个 USDT 账户（只做逐仓、单币种）
CREATE TABLE trading_account (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  user_id         BIGINT        NOT NULL,
  balance         DECIMAL(24,8) NOT NULL DEFAULT 0 COMMENT '余额（含已占用的保证金）',
  withdraw_frozen DECIMAL(24,8) NOT NULL DEFAULT 0 COMMENT '提现冻结',
  order_frozen    DECIMAL(24,8) NOT NULL DEFAULT 0 COMMENT '挂单冻结',
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_trading_account_user (user_id),
  CONSTRAINT ck_trading_account_nonneg CHECK (balance >= 0 AND withdraw_frozen >= 0 AND order_frozen >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='交易账户';

-- trading 模块：账本。账户的每一次变动都有一条记录，和变动在同一个事务里写入（项目地图约定 1）
CREATE TABLE trading_ledger (
  id           BIGINT        NOT NULL AUTO_INCREMENT,
  account_id   BIGINT        NOT NULL,
  bucket       VARCHAR(16)   NOT NULL COMMENT '变动的是哪一项：BALANCE / WITHDRAW_FROZEN / ORDER_FROZEN',
  entry_type   VARCHAR(32)   NOT NULL COMMENT '业务类型，见 trading.api.LedgerEntryType',
  amount       DECIMAL(24,8) NOT NULL COMMENT '变动金额，增加为正、减少为负',
  value_after  DECIMAL(24,8) NOT NULL COMMENT '变动后这一项的值',
  biz_type     VARCHAR(32)   NOT NULL COMMENT '来源业务，例如 DEPOSIT、ORDER',
  biz_id       VARCHAR(64)   NOT NULL COMMENT '来源业务的单号',
  remark       VARCHAR(255)  NULL,
  created_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_trading_ledger_idem (biz_type, biz_id, entry_type, bucket),
  KEY idx_trading_ledger_account (account_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='账本';

-- common：任务表（代替 Kafka，00-架构方案.md 3.3 ③）
CREATE TABLE common_task (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  task_type    VARCHAR(48)  NOT NULL,
  payload      JSON         NOT NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / RUNNING / SUCCEEDED / FAILED',
  attempts     INT          NOT NULL DEFAULT 0,
  max_attempts INT          NOT NULL DEFAULT 8,
  next_run_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  locked_at    DATETIME(3)  NULL COMMENT '开始处理的时间，超时未完成会被回收',
  locked_by    VARCHAR(64)  NULL,
  last_error   VARCHAR(1000) NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_common_task_pick (status, next_run_at),
  KEY idx_common_task_running (status, locked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='异步任务';
