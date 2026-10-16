package com.falconx.lite.account.api;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** 后台查看客户和 KYC（S16b）。只读；冻结、审核走 {@link AccountApi}。 */
public interface CustomerAdminApi {

  /** 一页结果 */
  record Page<T>(List<T> items, long total) {}

  /**
   * 客户摘要。
   *
   * @param status ACTIVE / FROZEN
   * @param kycStatus NONE / PENDING / APPROVED / REJECTED
   */
  record Customer(long id, String email, String name, String nationality, String status, String kycStatus, LocalDateTime registeredAt,
      LocalDateTime lastLoginAt) {}

  /** 客户详情：资料和最近一次 KYC */
  record CustomerDetail(Customer customer, String firstName, String middleName, String lastName, LocalDate birthDate, String frozenReason,
      String docType, String docNumber, LocalDateTime kycReviewedAt, String kycRejectReason) {}

  /** KYC 申请；status PENDING / APPROVED / REJECTED，docType ID_CARD / PASSPORT */
  record KycApplication(long id, long userId, String name, String email, String nationality, LocalDate birthDate, String docType, String docNumber,
      String status, LocalDateTime submittedAt, Long reviewerId, LocalDateTime reviewedAt, String rejectReason) {}

  /** 证件照片 */
  record Image(byte[] content, String contentType) {}

  /** keyword 匹配邮箱、姓名、客户号；status、kycStatus 为空表示不筛选 */
  Page<Customer> customers(String keyword, String status, String kycStatus, int offset, int limit);

  Optional<CustomerDetail> customer(long id);

  /** 按客户号批量取摘要（后台列表显示客户名） */
  Map<Long, Customer> customers(Collection<Long> ids);

  /** 按邮箱、姓名、客户号找客户的客户号，最多 limit 个（后台各列表按客户搜索时用） */
  List<Long> search(String keyword, int limit);

  /** 冻结（填原因）或解冻；冻结后该客户所有登录立即失效（AC-04） */
  void setFrozen(long userId, boolean frozen, String reason);

  Page<KycApplication> kycApplications(String status, String keyword, int offset, int limit);

  Optional<KycApplication> kycApplication(long id);

  /** side：front / back / selfie */
  Optional<Image> kycImage(long applicationId, String side);

  long pendingKyc();
}
