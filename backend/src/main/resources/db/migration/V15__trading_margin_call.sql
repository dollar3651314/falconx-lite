-- V15（S15a）：追保预警状态（AC-15，通知方案 N4）。说明见 技术方案/v1-数据库设计.md 2.32
-- 跌破追保线通知一次；一直在线下不重复；回到线上以后再跌破才再通知，同一客户两次通知至少隔 5 分钟
CREATE TABLE trading_margin_call (
  user_id          BIGINT      NOT NULL,
  below            TINYINT(1)  NOT NULL COMMENT '上次检查时是否在追保线下',
  notified         TINYINT(1)  NOT NULL COMMENT '这一次跌破是否已经通知',
  last_notified_at DATETIME(3) NULL,
  updated_at       DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='追保预警状态';
