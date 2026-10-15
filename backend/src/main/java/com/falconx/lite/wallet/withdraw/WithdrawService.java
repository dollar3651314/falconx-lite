package com.falconx.lite.wallet.withdraw;

import com.falconx.lite.account.api.AccountApi;
import com.falconx.lite.account.api.KycStatus;
import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.trading.api.Bucket;
import com.falconx.lite.trading.api.FundsApi;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerCommand;
import com.falconx.lite.trading.api.LedgerEntryType;
import com.falconx.lite.trading.api.UserEventsApi;
import com.falconx.lite.wallet.Chain;
import com.falconx.lite.wallet.api.WithdrawAdminApi;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 提现（技术方案/v1-提现方案.md）。状态：
 * 冷静期 → 待审核 → 已审核待上链（大额先延迟 6 小时）→ 上链中 → 已完成；
 * 任何失败路径（撤销、驳回、紧急取消、确定没上链）都把冻结金额完整退回。
 * 每次状态变化都在锁住提现单之后按"从哪个状态到哪个状态"条件更新，并记一条提现事件。
 */
@Service
@EnableConfigurationProperties(WithdrawProperties.class)
public class WithdrawService implements WithdrawAdminApi {

  private static final Logger log = LoggerFactory.getLogger(WithdrawService.class);
  static final String BIZ_WITHDRAW = "WITHDRAW";
  private static final Pattern AMOUNT = Pattern.compile("\\d{1,12}(\\.\\d{1,8})?");

  private final WithdrawMapper mapper;
  private final LedgerApi ledger;
  private final FundsApi funds;
  private final AccountApi account;
  private final UserEventsApi events;
  private final WithdrawSenders senders;
  private final WithdrawProperties props;
  private final TransactionTemplate tx;
  private final Clock clock;

  WithdrawService(WithdrawMapper mapper, LedgerApi ledger, FundsApi funds, AccountApi account, UserEventsApi events, WithdrawSenders senders,
      WithdrawProperties props, TransactionTemplate tx, Clock clock) {
    this.mapper = mapper;
    this.ledger = ledger;
    this.funds = funds;
    this.account = account;
    this.events = events;
    this.senders = senders;
    this.props = props;
    this.tx = tx;
    this.clock = clock;
  }

  LocalDateTime now() {
    return LocalDateTime.now(clock.withZone(ZoneOffset.UTC));
  }

  /** 今天（UTC）已经用掉的额度 */
  BigDecimal usedToday(long userId) {
    return mapper.usedSince(userId, now().toLocalDate().atStartOfDay());
  }

  // ---------- 客户 ----------

  /**
   * 提交提现（AC-17）。顺序：字段 → KYC → 白名单（存在、已生效）→ 最小、单笔 → 锁账户后查当日累计和可提金额 → 冻结。
   */
  WithdrawalRow submit(long userId, String whitelistId, String amountText) {
    ValidationException.Collector errs = new ValidationException.Collector();
    BigDecimal amount = null;
    String a = amountText == null ? "" : amountText.trim();
    if (a.isEmpty()) errs.add("amount", "required");
    else if (!AMOUNT.matcher(a).matches() || new BigDecimal(a).signum() <= 0) errs.add("amount", "positiveNumber");
    else if (new BigDecimal(a).scale() > 2) errs.add("amount", "amountDigits");
    else amount = new BigDecimal(a);
    Long wid = null;
    try {
      wid = whitelistId == null ? null : Long.valueOf(whitelistId);
    } catch (NumberFormatException e) {
      wid = null;
    }
    if (wid == null) errs.add("whitelistId", "selectAddress");
    errs.throwIfAny();

    if (account.kycStatus(userId) != KycStatus.APPROVED) throw new BizException("KYC_REQUIRED", "提现前需要通过身份认证");
    WhitelistRow w = mapper.whitelistById(userId, wid);
    if (w == null) throw new BizException("NOT_WHITELISTED", "只能提到白名单地址");
    if (w.activeAt.isAfter(now())) throw new BizException("WHITELIST_NOT_ACTIVE", "白名单地址添加满 24 小时后才能使用");
    if (amount.compareTo(props.minAmount()) < 0) throw new BizException("AMOUNT_BELOW_MIN", "低于最小提现金额");
    if (amount.compareTo(props.maxPerTx()) > 0) throw new BizException("AMOUNT_ABOVE_MAX", "超过单笔提现上限");
    Chain network = Chain.valueOf(w.network);
    BigDecimal fee = props.fee(network);
    if (amount.compareTo(fee) <= 0) throw new BizException("AMOUNT_BELOW_MIN", "金额不够付手续费");
    final BigDecimal amt = amount;

    WithdrawalRow r = tx.execute(st -> {
      ledger.lock(userId);
      // 当日累计必须严格小于上限（需求 4.4-4，和客户端一致）；锁住账户后再算，并发提交不会一起超过
      if (usedToday(userId).add(amt).compareTo(props.dailyLimit()) >= 0) throw new BizException("DAILY_LIMIT_EXCEEDED", "超过当日提现累计上限");
      if (amt.compareTo(funds.withdrawable(userId)) > 0) throw new BizException("INSUFFICIENT_BALANCE", "可提金额不足");
      WithdrawalRow n = new WithdrawalRow();
      n.userId = userId;
      n.network = network.name();
      n.address = w.address;
      n.amount = amt;
      n.fee = fee;
      n.status = "COOLING";
      n.createdAt = now();
      n.coolingEndsAt = n.createdAt.plus(props.cooling());
      mapper.insertWithdrawal(n);
      ledger.apply(new LedgerCommand(userId, Bucket.BALANCE, amt.negate(), LedgerEntryType.WITHDRAW_FREEZE, BIZ_WITHDRAW, String.valueOf(n.id), "提现冻结"));
      ledger.apply(new LedgerCommand(userId, Bucket.WITHDRAW_FROZEN, amt, LedgerEntryType.WITHDRAW_FREEZE, BIZ_WITHDRAW, String.valueOf(n.id), "提现冻结"));
      mapper.insertEvent(n.id, null, "COOLING", "user:" + userId, null);
      return n;
    });
    notify(r);
    return r;
  }

  /** 冷静期内撤销（AC-18）：冻结立即退回；过了冷静期不能撤销 */
  WithdrawalRow cancel(long userId, long id) {
    WithdrawalRow r = tx.execute(st -> {
      WithdrawalRow w = mapper.lock(id);
      if (w == null || w.userId != userId) throw new BizException("NOT_FOUND", "提现不存在");
      if (!"COOLING".equals(w.status) || !now().isBefore(w.coolingEndsAt)) throw new BizException("WITHDRAW_NOT_CANCELLABLE", "冷静期已过，不能撤销");
      move(w, "CANCELLED", "user:" + userId, null);
      refund(w);
      return w;
    });
    notify(r);
    return r;
  }

  // ---------- 后台 ----------

  @Override
  public void approve(long withdrawalId, long adminId) {
    WithdrawalRow r = tx.execute(st -> {
      WithdrawalRow w = reviewing(withdrawalId);
      boolean large = w.amount.compareTo(props.largeAmount()) >= 0;
      LocalDateTime delay = large ? now().plus(props.largeDelay()) : null;
      mapper.setReview(w.id, adminId, now(), null, delay);
      move(w, large ? "DELAYED" : "APPROVED", "admin:" + adminId, large ? "大额，延迟到 " + delay : null);
      w.delayEndsAt = delay;
      return w;
    });
    notify(r);
    if ("APPROVED".equals(r.status)) send(r.id);
  }

  @Override
  public void reject(long withdrawalId, long adminId, String reason) {
    if (reason == null || reason.isBlank()) throw new ValidationException(java.util.List.of(new ValidationException.Field("reason", "required")));
    if (reason.length() > 500) throw new ValidationException(java.util.List.of(new ValidationException.Field("reason", "tooLong")));
    WithdrawalRow r = tx.execute(st -> {
      WithdrawalRow w = reviewing(withdrawalId);
      mapper.setReview(w.id, adminId, now(), reason.trim(), null);
      move(w, "REJECTED", "admin:" + adminId, reason.trim());
      refund(w);
      w.rejectReason = reason.trim();
      return w;
    });
    notify(r);
  }

  @Override
  public void emergencyCancel(long withdrawalId, long adminId, String reason) {
    if (reason == null || reason.isBlank()) throw new ValidationException(java.util.List.of(new ValidationException.Field("reason", "required")));
    WithdrawalRow r = tx.execute(st -> {
      WithdrawalRow w = mapper.lock(withdrawalId);
      if (w == null) throw new BizException("NOT_FOUND", "提现不存在");
      if (!"DELAYED".equals(w.status)) throw new BizException("WITHDRAW_NOT_CANCELLABLE", "只有延迟期内的大额提现可以紧急取消");
      move(w, "CANCELLED", "admin:" + adminId, "紧急取消：" + reason.trim());
      refund(w);
      return w;
    });
    notify(r);
  }

  private WithdrawalRow reviewing(long id) {
    WithdrawalRow w = mapper.lock(id);
    if (w == null) throw new BizException("NOT_FOUND", "提现不存在");
    if (!"REVIEWING".equals(w.status)) throw new BizException("WITHDRAW_NOT_REVIEWABLE", "只能审核待审核的提现");
    return w;
  }

  // ---------- 系统（定时任务） ----------

  /** 推进到期的状态：冷静期满 → 待审核；大额延迟满 → 待上链（修复 F1：直接进入上链，不依赖别的事件）；然后发送所有待上链的 */
  void advance() {
    LocalDateTime now = now();
    for (Long id : mapper.due("COOLING", "cooling_ends_at", now)) systemMove(id, "COOLING", "REVIEWING", "冷静期结束");
    for (Long id : mapper.due("DELAYED", "delay_ends_at", now)) systemMove(id, "DELAYED", "APPROVED", "延迟期结束，进入上链");
    for (Long id : mapper.withStatus("APPROVED")) send(id);
  }

  private void systemMove(long id, String from, String to, String note) {
    WithdrawalRow r = tx.execute(st -> {
      WithdrawalRow w = mapper.lock(id);
      if (w == null || !from.equals(w.status)) return null;
      move(w, to, "system", note);
      return w;
    });
    if (r != null) notify(r);
  }

  /** 待上链 → 交给广播器。没有广播器或广播器说"等一等"时留在待上链（W4）；确定没上链时失败退款 */
  void send(long id) {
    WithdrawalRow w = mapper.byId(id);
    if (w == null || !"APPROVED".equals(w.status)) return;
    var sender = senders.get(Chain.valueOf(w.network));
    if (sender.isEmpty()) {
      log.debug("{} 没有广播器，提现 {} 留在待上链", w.network, id);
      return;
    }
    WithdrawSender.Outcome out = sender.get().send(new WithdrawSender.Order(w.id, w.network, w.address, w.amount.subtract(w.fee)));
    switch (out) {
      case WithdrawSender.Sent s -> {
        WithdrawalRow r = tx.execute(st -> {
          WithdrawalRow l = mapper.lock(id);
          if (!"APPROVED".equals(l.status)) return null;
          mapper.setTx(id, s.txHash());
          move(l, "BROADCASTING", "system", s.txHash());
          return l;
        });
        if (r != null) notify(r);
      }
      case WithdrawSender.Wait wait -> log.warn("提现 {} 暂时不能上链：{}", id, wait.reason());
      case WithdrawSender.Rejected rej -> failed(id, "APPROVED", rej.reason());
    }
  }

  /** 上链中的提现查链上结果（S13b）：确认够了完成；确定转账没发生则失败退款；其他情况继续等（加价重发、过期重建在广播器里） */
  void track() {
    for (Long id : mapper.withStatus("BROADCASTING")) {
      WithdrawalRow w = mapper.byId(id);
      var sender = senders.get(Chain.valueOf(w.network));
      if (sender.isEmpty()) continue;
      switch (sender.get().check(id)) {
        case WithdrawSender.Confirmed c -> {
          mapper.setTx(id, c.txHash());
          confirmed(id);
        }
        case WithdrawSender.Failed f -> failed(id, "BROADCASTING", f.reason());
        case WithdrawSender.Pending p -> { }
      }
    }
  }

  /** 链上确认：上链中 → 已完成，扣掉提现冻结（S13b 的确认任务调用） */
  public void confirmed(long id) {
    WithdrawalRow r = tx.execute(st -> {
      WithdrawalRow w = mapper.lock(id);
      if (w == null || !"BROADCASTING".equals(w.status)) return null;
      move(w, "COMPLETED", "system", null);
      mapper.setCompleted(id, now());
      ledger.apply(new LedgerCommand(w.userId, Bucket.WITHDRAW_FROZEN, w.amount.negate(), LedgerEntryType.WITHDRAW_PAYOUT, BIZ_WITHDRAW,
          String.valueOf(w.id), "提现完成（含手续费 " + w.fee.stripTrailingZeros().toPlainString() + "）"));
      return w;
    });
    if (r != null) notify(r);
  }

  /** 确定没有上链（广播被拒、TRON 交易过期查不到）：失败退款（AC-20）。只能从待上链或上链中进入 */
  public void failed(long id, String expectedStatus, String reason) {
    WithdrawalRow r = tx.execute(st -> {
      WithdrawalRow w = mapper.lock(id);
      if (w == null || !expectedStatus.equals(w.status)) return null;
      move(w, "FAILED_REFUNDED", "system", reason);
      refund(w);
      return w;
    });
    if (r != null) {
      log.warn("提现 {} 上链失败，已退回：{}", id, reason);
      notify(r);
    }
  }

  // ---------- 公共 ----------

  private void move(WithdrawalRow w, String to, String actor, String note) {
    if (mapper.transit(w.id, w.status, to) != 1) throw new IllegalStateException("提现状态已变化：" + w.id);
    mapper.insertEvent(w.id, w.status, to, actor, note);
    w.status = to;
  }

  /** 退回：提现冻结 → 余额 */
  private void refund(WithdrawalRow w) {
    ledger.apply(new LedgerCommand(w.userId, Bucket.WITHDRAW_FROZEN, w.amount.negate(), LedgerEntryType.WITHDRAW_UNFREEZE, BIZ_WITHDRAW,
        String.valueOf(w.id), "提现退回"));
    ledger.apply(new LedgerCommand(w.userId, Bucket.BALANCE, w.amount, LedgerEntryType.WITHDRAW_UNFREEZE, BIZ_WITHDRAW, String.valueOf(w.id), "提现退回"));
  }

  /** 推给客户：{"type":"withdraw","status":"cooling","amount":"100"} 和账户变化 */
  private void notify(WithdrawalRow w) {
    Map<String, Object> e = new LinkedHashMap<>();
    e.put("type", "withdraw");
    e.put("status", apiStatus(w.status));
    e.put("amount", w.amount.stripTrailingZeros().toPlainString());
    events.send(w.userId, e);
    events.send(w.userId, Map.of("type", "account"));
  }

  /** 数据库状态 → 客户端状态名（WithdrawStatus） */
  static String apiStatus(String s) {
    return switch (s) {
      case "FAILED_REFUNDED" -> "failedRefunded";
      default -> s.toLowerCase();
    };
  }
}
