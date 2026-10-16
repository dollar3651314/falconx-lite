package com.falconx.lite.wallet.admin;

import com.falconx.lite.wallet.Chain;
import com.falconx.lite.wallet.Confirmations;
import com.falconx.lite.wallet.api.WalletAdminApi;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** {@link WalletAdminApi} 的实现。 */
@Service
class WalletAdmin implements WalletAdminApi {

  private final WalletAdminMapper mapper;
  private final Confirmations confirmations;

  WalletAdmin(WalletAdminMapper mapper, Confirmations confirmations) {
    this.mapper = mapper;
    this.confirmations = confirmations;
  }

  private Deposit deposit(WalletAdminMapper.DepositRow r) {
    int need = confirmations.of(Chain.valueOf(r.chain));
    return new Deposit(r.id, r.userId, r.chain, r.txHash, r.amount, Math.min(r.confirmations, need), need, r.status, r.createdAt, r.creditedAt);
  }

  private static Withdrawal withdrawal(WalletAdminMapper.WithdrawalRow r) {
    return new Withdrawal(r.id, r.userId, r.amount, r.fee, r.network, r.address, r.firstUse, r.whitelistAddedAt, r.status, r.delayEndsAt, r.createdAt,
        r.reviewerId, r.rejectReason, r.txHash);
  }

  /** 客户筛选结果为空时直接返回空页（避免 IN () 的 SQL） */
  private static boolean noUsers(Collection<Long> userIds) {
    return userIds != null && userIds.isEmpty();
  }

  @Override
  @Transactional(readOnly = true)
  public Page<Deposit> deposits(String chain, Collection<String> statuses, String txHash, Collection<Long> userIds, int offset, int limit) {
    if (noUsers(userIds)) return new Page<>(List.of(), 0);
    return new Page<>(mapper.deposits(chain, statuses, txHash, userIds, offset, limit).stream().map(this::deposit).toList(),
        mapper.countDeposits(chain, statuses, txHash, userIds));
  }

  @Override
  @Transactional(readOnly = true)
  public Page<Withdrawal> withdrawals(Collection<String> statuses, String chain, BigDecimal minAmount, BigDecimal maxAmount, Collection<Long> userIds,
      int offset, int limit) {
    if (noUsers(userIds)) return new Page<>(List.of(), 0);
    return new Page<>(mapper.withdrawals(statuses, chain, minAmount, maxAmount, userIds, null, offset, limit).stream().map(WalletAdmin::withdrawal).toList(),
        mapper.countWithdrawals(statuses, chain, minAmount, maxAmount, userIds));
  }

  @Override
  @Transactional(readOnly = true)
  public Optional<Withdrawal> withdrawal(long id) {
    return mapper.withdrawals(null, null, null, null, null, id, 0, 1).stream().findFirst().map(WalletAdmin::withdrawal);
  }

  @Override
  @Transactional(readOnly = true)
  public Summary summary(LocalDateTime startOfToday) {
    Map<String, WalletAdminMapper.BucketRow> open = mapper.openBuckets().stream().collect(Collectors.toMap(b -> b.status, b -> b));
    WalletAdminMapper.BucketRow done = mapper.completedSince(startOfToday);
    return new Summary(bucket(open.get("REVIEWING")), bucket(open.get("DELAYED")), bucket(open.get("COOLING")), bucket(done));
  }

  private static Bucket bucket(WalletAdminMapper.BucketRow b) {
    return b == null ? new Bucket(0, BigDecimal.ZERO) : new Bucket(b.count, b.amount);
  }

  @Override
  @Transactional(readOnly = true)
  public CustomerFunds customerFunds(long userId, int recent) {
    List<Long> one = List.of(userId);
    return new CustomerFunds(mapper.totalDeposit(userId), mapper.deposits(null, List.of("CREDITED"), null, one, 0, recent).stream().map(this::deposit).toList(),
        mapper.withdrawals(List.of("COMPLETED"), null, null, null, one, null, 0, recent).stream().map(WalletAdmin::withdrawal).toList());
  }

  @Override
  @Transactional(readOnly = true)
  public long pendingReview() {
    return mapper.countWithdrawals(List.of("REVIEWING"), null, null, null, null);
  }

  @Override
  @Transactional(readOnly = true)
  public Bucket creditedSince(LocalDateTime since) {
    return bucket(mapper.creditedSince(since));
  }
}
