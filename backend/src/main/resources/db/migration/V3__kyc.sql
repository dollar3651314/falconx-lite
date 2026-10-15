-- V3（S5）：KYC 申请。每次提交一行，用户当前的 KYC 状态看最新一行。证件图片在对象存储里，这里只存路径（AC-05）。
CREATE TABLE account_kyc_application (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  user_id       BIGINT       NOT NULL,
  doc_type      VARCHAR(16)  NOT NULL COMMENT 'ID_CARD / PASSPORT',
  doc_number    VARCHAR(64)  NOT NULL,
  front_key     VARCHAR(255) NOT NULL COMMENT '对象存储路径：证件正面',
  back_key      VARCHAR(255) NOT NULL COMMENT '对象存储路径：证件反面',
  selfie_key    VARCHAR(255) NOT NULL COMMENT '对象存储路径：手持证件自拍',
  status        VARCHAR(16)  NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / APPROVED / REJECTED',
  reject_reason VARCHAR(500) NULL,
  reviewer_id   BIGINT       NULL COMMENT '审核的管理员',
  submitted_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reviewed_at   DATETIME(3)  NULL,
  PRIMARY KEY (id),
  KEY idx_account_kyc_user (user_id, id),
  KEY idx_account_kyc_doc (doc_type, doc_number),
  KEY idx_account_kyc_status (status, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='KYC 申请';
