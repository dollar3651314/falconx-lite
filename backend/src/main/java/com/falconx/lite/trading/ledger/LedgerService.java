package com.falconx.lite.trading.ledger;

import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.money.Amounts;
import com.falconx.lite.trading.api.AccountSnapshot;
import com.falconx.lite.trading.api.Bucket;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerCommand;
import com.falconx.lite.trading.api.LedgerResult;
import java.math.BigDecimal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** {@link LedgerApi} 的实现：先锁账户行，再查幂等、改金额、写账本，全部在一个事务里。 */
@Service
class LedgerService implements LedgerApi {

  private final LedgerMapper mapper;

  LedgerService(LedgerMapper mapper) {
    this.mapper = mapper;
  }

  @Override
  @Transactional
  public void openAccount(long userId) {
    mapper.insertAccountIfAbsent(userId);
  }

  @Override
  @Transactional
  public LedgerResult apply(LedgerCommand c) {
    BigDecimal amount = Amounts.normalize(c.amount());
    if (amount.signum() == 0) throw new IllegalArgumentException("变动金额不能为 0");
    if (c.bizType() == null || c.bizType().isBlank() || c.bizId() == null || c.bizId().isBlank()) throw new IllegalArgumentException("必须提供来源业务和单号（幂等键）");

    // 先锁账户行：同一账户的变动排队执行，幂等检查和改金额之间不会插进别的请求
    AccountRow acc = mapper.lockAccount(c.userId());
    if (acc == null) throw new BizException("ACCOUNT_NOT_FOUND", "交易账户不存在：" + c.userId());

    LedgerRow existing = mapper.findEntry(c.bizType(), c.bizId(), c.type().name(), c.bucket().name());
    if (existing != null) return new LedgerResult(existing.id(), existing.valueAfter(), true);

    BigDecimal after = acc.get(c.bucket()).add(amount);
    if (after.signum() < 0) throw new BizException("INSUFFICIENT_FUNDS", "余额不足");

    mapper.updateBucket(acc.id(), column(c.bucket()), after);
    LedgerEntry e = new LedgerEntry();
    e.accountId = acc.id();
    e.bucket = c.bucket().name();
    e.entryType = c.type().name();
    e.amount = amount;
    e.valueAfter = after;
    e.bizType = c.bizType();
    e.bizId = c.bizId();
    e.remark = c.remark();
    mapper.insertEntry(e);
    return new LedgerResult(e.id, after, false);
  }

  @Override
  @Transactional(readOnly = true)
  public AccountSnapshot snapshot(long userId) {
    AccountRow a = mapper.findAccount(userId);
    if (a == null) throw new BizException("ACCOUNT_NOT_FOUND", "交易账户不存在：" + userId);
    return new AccountSnapshot(a.userId(), a.balance(), a.withdrawFrozen(), a.orderFrozen());
  }

  @Override
  @Transactional(propagation = Propagation.MANDATORY)
  public AccountSnapshot lock(long userId) {
    AccountRow a = mapper.lockAccount(userId);
    if (a == null) throw new BizException("ACCOUNT_NOT_FOUND", "交易账户不存在：" + userId);
    return new AccountSnapshot(a.userId(), a.balance(), a.withdrawFrozen(), a.orderFrozen());
  }

  /** 列名只来自这个固定映射，不拼接外部输入 */
  private static String column(Bucket b) {
    return switch (b) {
      case BALANCE -> "balance";
      case WITHDRAW_FROZEN -> "withdraw_frozen";
      case ORDER_FROZEN -> "order_frozen";
    };
  }
}
