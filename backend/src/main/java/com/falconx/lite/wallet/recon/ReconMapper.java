package com.falconx.lite.wallet.recon;

import com.falconx.lite.wallet.api.WalletReconApi;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 对账的 SQL，见 resources/mapper/wallet/ReconMapper.xml。 */
@Mapper
interface ReconMapper {

  record DepositRow(long id, String chain, String txHash, int logIndex, long userId, BigDecimal amount, String status, long blockNumber, String blockHash,
      LocalDateTime createdAt) {}

  record SuspenseRow(long id, long userId, long depositId, BigDecimal amount, String status) {}

  record WithdrawalRow(long id, long userId, BigDecimal amount, String status) {}

  /** 已入账和已冲正的充值（入过账的） */
  List<DepositRow> creditedDeposits();

  List<SuspenseRow> suspenses();

  List<WithdrawalRow> withdrawals();

  int openIssueCount(@Param("kind") String kind, @Param("refId") String refId);

  int insertIssue(@Param("kind") String kind, @Param("refId") String refId, @Param("userId") Long userId, @Param("expected") BigDecimal expected,
      @Param("actual") BigDecimal actual, @Param("detail") String detail);

  List<WalletReconApi.Issue> issues(@Param("status") String status, @Param("limit") int limit);

  WalletReconApi.Issue lockIssue(@Param("id") long id);

  /** 只改"待处理"的（修复 F5：现有系统把这个条件写反了） */
  int resolveIssue(@Param("id") long id, @Param("adminId") long adminId, @Param("note") String note, @Param("at") LocalDateTime at);

  int resolveSuspense(@Param("id") long id, @Param("at") LocalDateTime at, @Param("note") String note);
}
