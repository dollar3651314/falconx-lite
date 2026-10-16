package com.falconx.lite.account.admin;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 后台查看客户和 KYC 的只读查询（account_* 表）。只有 account 模块使用。 */
@Mapper
interface CustomerAdminMapper {

  class CustomerRow {
    long id;
    String email;
    String status;
    String frozenReason;
    LocalDateTime createdAt;
    LocalDateTime lastLoginAt;
    String firstName;
    String middleName;
    String lastName;
    LocalDate birthDate;
    String nationality;
    String kycStatus;
    String docType;
    String docNumber;
    LocalDateTime kycReviewedAt;
    String kycRejectReason;
  }

  class KycRow {
    long id;
    long userId;
    String email;
    String firstName;
    String middleName;
    String lastName;
    String nationality;
    LocalDate birthDate;
    String docType;
    String docNumber;
    String frontKey;
    String backKey;
    String selfieKey;
    String status;
    LocalDateTime submittedAt;
    Long reviewerId;
    LocalDateTime reviewedAt;
    String rejectReason;
  }

  List<CustomerRow> customers(@Param("keyword") String keyword, @Param("id") Long id, @Param("status") String status, @Param("kycStatus") String kycStatus,
      @Param("offset") int offset, @Param("limit") int limit);

  long countCustomers(@Param("keyword") String keyword, @Param("id") Long id, @Param("status") String status, @Param("kycStatus") String kycStatus);

  List<CustomerRow> byIds(@Param("ids") Collection<Long> ids);

  void setFrozenReason(@Param("id") long id, @Param("reason") String reason);

  List<KycRow> kycs(@Param("status") String status, @Param("keyword") String keyword, @Param("id") Long id, @Param("offset") int offset,
      @Param("limit") int limit);

  long countKycs(@Param("status") String status, @Param("keyword") String keyword, @Param("id") Long id);

  KycRow kyc(@Param("id") long id);

  long pendingKyc();
}
