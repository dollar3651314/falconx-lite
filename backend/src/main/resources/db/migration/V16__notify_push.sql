-- V16（S15b）：Web Push 订阅。说明见 技术方案/v1-数据库设计.md 2.33；方案见 技术方案/v1-通知方案.md
-- 一个客户可以有多台设备；同一个推送地址只属于最后订阅它的客户（同一台设备换了账号登录）
CREATE TABLE notify_push_sub (
  id            BIGINT        NOT NULL AUTO_INCREMENT,
  user_id       BIGINT        NOT NULL,
  endpoint      VARCHAR(1000) NOT NULL COMMENT '浏览器推送服务给的地址',
  endpoint_hash CHAR(64)      NOT NULL COMMENT '地址的 SHA-256（地址太长，不能直接建唯一索引）',
  p256dh        VARCHAR(120)  NOT NULL COMMENT '浏览器的公钥（base64url）',
  auth          VARCHAR(40)   NOT NULL COMMENT '浏览器的认证密钥（base64url）',
  created_at    DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_notify_push_sub_endpoint (endpoint_hash),
  KEY idx_notify_push_sub_user (user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Web Push 订阅';
