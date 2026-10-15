-- V13（S14）：对账发现的问题（修复 F5）。说明见 技术方案/v1-数据库设计.md 2.27、第 16 节。
-- 同一类问题、同一个对象只保留一条待处理的；处理以后再次发现会新开一条
CREATE TABLE wallet_recon_issue (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  kind        VARCHAR(32)   NOT NULL COMMENT '问题类型，见数据库设计第 16 节',
  ref_id      VARCHAR(120)  NOT NULL COMMENT '涉及的对象：充值"链:交易:序号"、提现单号、挂账号、用户号',
  user_id     BIGINT        NULL,
  expected    DECIMAL(24,8) NULL COMMENT '应该是多少',
  actual      DECIMAL(24,8) NULL COMMENT '实际是多少',
  detail      VARCHAR(500)  NULL,
  status      VARCHAR(12)   NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN 待处理 / RESOLVED 已处理',
  resolved_by BIGINT        NULL,
  resolved_at DATETIME(3)   NULL,
  note        VARCHAR(500)  NULL COMMENT '处理说明',
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_wallet_recon_issue_status (status, id),
  KEY idx_wallet_recon_issue_ref (kind, ref_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='对账问题';
