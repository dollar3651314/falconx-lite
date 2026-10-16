-- V18（S16b）：后台冻结原因、调余额记录。说明见 技术方案/v1-数据库设计.md 2.40、2.41

ALTER TABLE account_user ADD COLUMN frozen_reason VARCHAR(500) NULL COMMENT '后台冻结时填的原因；解冻后清空' AFTER status;

-- 调余额（后台方案 G5）：每笔一行，用来算每个管理员当天的累计额度；账本里的 ADMIN_ADJUST 以本表 id 为单号
CREATE TABLE admin_balance_adjust (
  id         BIGINT        NOT NULL AUTO_INCREMENT,
  admin_id   BIGINT        NOT NULL,
  user_id    BIGINT        NOT NULL,
  amount     DECIMAL(24,8) NOT NULL COMMENT '加为正、减为负',
  reason     VARCHAR(500)  NOT NULL,
  created_at DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY idx_admin_balance_adjust_admin (admin_id, created_at),
  KEY idx_admin_balance_adjust_user (user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='后台调余额记录';
