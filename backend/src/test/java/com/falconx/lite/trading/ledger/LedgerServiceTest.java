package com.falconx.lite.trading.ledger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.falconx.lite.common.error.BizException;
import com.falconx.lite.trading.api.Bucket;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerCommand;
import com.falconx.lite.trading.api.LedgerEntryType;
import com.falconx.lite.trading.api.LedgerResult;
import java.math.BigDecimal;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicLong;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.support.TransactionTemplate;

/** 账户和账本，用真实的 MySQL（C37）。每个测试用新的用户 ID，互不影响。 */
@SpringBootTest
@ActiveProfiles("test")
class LedgerServiceTest {

  private static final AtomicLong IDS = new AtomicLong(System.currentTimeMillis() * 1000);

  @Autowired LedgerApi ledger;
  @Autowired JdbcTemplate jdbc;
  @Autowired TransactionTemplate tx;

  private long newUser() {
    long id = IDS.incrementAndGet();
    ledger.openAccount(id);
    return id;
  }

  private static LedgerCommand cmd(long user, String amount, LedgerEntryType type, String bizId) {
    return new LedgerCommand(user, Bucket.BALANCE, new BigDecimal(amount), type, "TEST", bizId, null);
  }

  private BigDecimal balance(long user) {
    return ledger.snapshot(user).balance();
  }

  /** 约定 1 的检查：账本里 BALANCE 的变动加起来等于账户余额 */
  private void assertLedgerMatches(long user) {
    BigDecimal sum = jdbc.queryForObject(
        "SELECT COALESCE(SUM(l.amount),0) FROM trading_ledger l JOIN trading_account a ON a.id = l.account_id WHERE a.user_id = ? AND l.bucket = 'BALANCE'", BigDecimal.class, user);
    assertThat(sum).isEqualByComparingTo(balance(user));
  }

  private int entries(long user) {
    return jdbc.queryForObject("SELECT COUNT(*) FROM trading_ledger l JOIN trading_account a ON a.id = l.account_id WHERE a.user_id = ?", Integer.class, user);
  }

  @Test
  void 入账增加余额并写一条账本() {
    long u = newUser();
    LedgerResult r = ledger.apply(cmd(u, "100.12345678", LedgerEntryType.DEPOSIT, "d-" + u));
    assertThat(r.duplicate()).isFalse();
    assertThat(r.valueAfter()).isEqualByComparingTo("100.12345678");
    assertThat(entries(u)).isEqualTo(1);
    assertLedgerMatches(u);
  }

  @Test
  void 余额不足时拒绝且不写账本() {
    long u = newUser();
    ledger.apply(cmd(u, "10", LedgerEntryType.DEPOSIT, "d-" + u));
    assertThatThrownBy(() -> ledger.apply(cmd(u, "-10.00000001", LedgerEntryType.TRADE_FEE, "f-" + u)))
        .isInstanceOf(BizException.class).extracting("code").isEqualTo("INSUFFICIENT_FUNDS");
    assertThat(balance(u)).isEqualByComparingTo("10");
    assertThat(entries(u)).isEqualTo(1);
  }

  @Test
  void 同一幂等键只记一次账() {
    long u = newUser();
    LedgerResult first = ledger.apply(cmd(u, "50", LedgerEntryType.DEPOSIT, "same-" + u));
    LedgerResult second = ledger.apply(cmd(u, "50", LedgerEntryType.DEPOSIT, "same-" + u));
    assertThat(second.duplicate()).isTrue();
    assertThat(second.entryId()).isEqualTo(first.entryId());
    assertThat(balance(u)).isEqualByComparingTo("50");
    assertThat(entries(u)).isEqualTo(1);
  }

  @Test
  void 调用方事务回滚时余额和账本一起回滚() {
    long u = newUser();
    ledger.apply(cmd(u, "20", LedgerEntryType.DEPOSIT, "d-" + u));
    assertThatThrownBy(() -> tx.executeWithoutResult(s -> {
      ledger.apply(cmd(u, "-5", LedgerEntryType.TRADE_FEE, "f-" + u));
      throw new IllegalStateException("调用方后续步骤失败");
    })).isInstanceOf(IllegalStateException.class);
    assertThat(balance(u)).isEqualByComparingTo("20");
    assertThat(entries(u)).isEqualTo(1);
  }

  @Test
  void 金额超过8位小数被拒绝() {
    long u = newUser();
    assertThatThrownBy(() -> ledger.apply(cmd(u, "1.123456789", LedgerEntryType.DEPOSIT, "d-" + u))).isInstanceOf(IllegalArgumentException.class);
    assertThat(entries(u)).isZero();
  }

  @Test
  void 并发扣款不会扣成负数也不会少记账() throws Exception {
    long u = newUser();
    ledger.apply(cmd(u, "100", LedgerEntryType.DEPOSIT, "d-" + u));
    ExecutorService pool = Executors.newFixedThreadPool(8);
    List<Future<Boolean>> results = new ArrayList<>();
    for (int i = 0; i < 25; i++) {
      String biz = "fee-" + u + "-" + i;
      results.add(pool.submit(() -> {
        try {
          ledger.apply(cmd(u, "-10", LedgerEntryType.TRADE_FEE, biz));
          return true;
        } catch (BizException e) {
          return false;
        }
      }));
    }
    int ok = 0;
    for (Future<Boolean> f : results) if (f.get()) ok++;
    pool.shutdown();
    assertThat(ok).isEqualTo(10);
    assertThat(balance(u)).isEqualByComparingTo("0");
    assertThat(entries(u)).isEqualTo(11);
    assertLedgerMatches(u);
  }

  @Test
  void 冻结和余额分开记账() {
    long u = newUser();
    ledger.apply(cmd(u, "30", LedgerEntryType.DEPOSIT, "d-" + u));
    ledger.apply(new LedgerCommand(u, Bucket.WITHDRAW_FROZEN, new BigDecimal("12"), LedgerEntryType.WITHDRAW_FREEZE, "WITHDRAW", "w-" + u, null));
    var s = ledger.snapshot(u);
    assertThat(s.balance()).isEqualByComparingTo("30");
    assertThat(s.withdrawFrozen()).isEqualByComparingTo("12");
    assertThat(s.orderFrozen()).isEqualByComparingTo("0");
    assertThatThrownBy(() -> ledger.apply(new LedgerCommand(u, Bucket.ORDER_FROZEN, new BigDecimal("-1"), LedgerEntryType.ORDER_UNFREEZE, "ORDER", "o-" + u, null)))
        .isInstanceOf(BizException.class);
  }
}
