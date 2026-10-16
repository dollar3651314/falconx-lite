package com.falconx.lite.wallet.api;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

/** 后台查看充值和提现（S16b）。只读；审核操作走 {@link WithdrawAdminApi}。 */
public interface WalletAdminApi {

  record Page<T>(List<T> items, long total) {}

  /**
   * 一笔充值。status：PENDING / CREDITED / DROPPED / BELOW_MIN / REVERSED。
   */
  record Deposit(long id, long userId, String chain, String txHash, BigDecimal amount, int confirmations, int requiredConfirmations, String status,
      LocalDateTime detectedAt, LocalDateTime creditedAt) {}

  /**
   * 一笔提现。status 是数据库状态（COOLING / REVIEWING / APPROVED / DELAYED / BROADCASTING / COMPLETED / REJECTED / CANCELLED / FAILED_REFUNDED）；
   * firstUse：这个客户第一次往这个地址提现；whitelistAddedAt：地址加入白名单的时间（白名单已删除时为空）。
   */
  record Withdrawal(long id, long userId, BigDecimal amount, BigDecimal fee, String chain, String address, boolean firstUse,
      LocalDateTime whitelistAddedAt, String status, LocalDateTime delayEndsAt, LocalDateTime submittedAt, Long reviewerId, String rejectReason,
      String txHash) {}

  /** 某个状态的笔数和金额 */
  record Bucket(long count, BigDecimal amount) {}

  record Summary(Bucket reviewing, Bucket delayed, Bucket cooling, Bucket completedToday) {}

  /** 客户的资金概况（出金审核详情页） */
  record CustomerFunds(BigDecimal totalDeposit, List<Deposit> recentDeposits, List<Withdrawal> recentWithdrawals) {}

  /** userIds 不为空时只查这些客户；txHash 不为空时按交易哈希匹配 */
  Page<Deposit> deposits(String chain, Collection<String> statuses, String txHash, Collection<Long> userIds, int offset, int limit);

  Page<Withdrawal> withdrawals(Collection<String> statuses, String chain, BigDecimal minAmount, BigDecimal maxAmount, Collection<Long> userIds,
      int offset, int limit);

  Optional<Withdrawal> withdrawal(long id);

  /** 今天按 UTC 算 */
  Summary summary(LocalDateTime startOfToday);

  CustomerFunds customerFunds(long userId, int recent);

  long pendingReview();

  /** 仪表盘（S16c）：从 since 起入账的充值（按入账时间） */
  Bucket creditedSince(LocalDateTime since);
}
