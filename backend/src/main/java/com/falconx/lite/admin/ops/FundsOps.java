package com.falconx.lite.admin.ops;

import com.falconx.lite.account.api.AccountApi;
import com.falconx.lite.account.api.CustomerAdminApi;
import com.falconx.lite.admin.security.AdminContext;
import com.falconx.lite.admin.security.AdminNames;
import com.falconx.lite.admin.security.Audit;
import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.task.TaskItem;
import com.falconx.lite.common.task.TaskService;
import com.falconx.lite.common.task.TaskStatus;
import com.falconx.lite.trading.api.TradingAdminApi;
import com.falconx.lite.wallet.api.WalletAdminApi;
import com.falconx.lite.wallet.api.WalletReconApi;
import com.falconx.lite.wallet.api.WithdrawAdminApi;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 后台"资金"和"KYC 审核"（S16b）：入金记录、出金审核（审核通过、驳回、紧急取消，AC-21）、对账、任务；KYC 列表、审核（AC-05）。
 * 业务都在各模块里（{@code WithdrawAdminApi}、{@code WalletReconApi}、{@code AccountApi}），这里只做查询组装、权限和审计。
 */
@Service
class FundsOps {

  /** 交易哈希：以太坊体系 0x + 64 位，TRON 64 位十六进制 */
  private static final Pattern TX_HASH = Pattern.compile("(0x)?[0-9a-fA-F]{64}");

  /** 字段和原型 Deposit 一致 */
  record DepositView(String id, long customerId, String customerName, String email, String chain, String txHash, String amount, int confirmations,
      int requiredConfirmations, String status, String detectedAt, String creditedAt) {}

  /** 字段和原型 Withdrawal 一致 */
  record WithdrawalView(String id, long customerId, String customerName, String email, String amount, String fee, String chain, String address,
      boolean firstUse, String whitelistAddedAt, String status, Long delayRemainingMinutes, String submittedAt, String reviewer, String reason,
      String txHash) {}

  record Recent(String time, String chain, String amount) {}

  /** 字段和原型 WithdrawalDetail 一致 */
  record WithdrawalDetail(WithdrawalView withdrawal, String kycStatus, long registeredDays, String totalDeposit, String balance, int openPositions,
      List<Recent> recentDeposits, List<Recent> recentWithdrawals) {}

  record Bucket(long count, String amount) {}

  /** 字段和原型 WithdrawalSummary 一致 */
  record Summary(Bucket pending, Bucket delayed, Bucket cooling, Bucket completedToday) {}

  /** 对账问题（字段按后端的问题类型，见后台方案 v1.2 第 7 节） */
  record ReconView(String id, String type, String ref, Long customerId, String customerName, String expected, String actual, String diff, String detail,
      String status, String note, String handler, String detectedAt, String resolvedAt) {}

  /** 字段和原型 TaskItem 一致 */
  record TaskView(String id, String type, String bizRef, String status, int attempts, int maxAttempts, String nextRetryAt, String lastError,
      String createdAt, String updatedAt) {}

  /** 字段和原型 KycApplication 一致 */
  record KycView(String id, long customerId, String name, String email, String nationality, String birthDate, String docType, String docNumber,
      String status, String submittedAt, String reviewer, String reviewedAt, String rejectReason) {}

  private final WalletAdminApi wallet;
  private final WithdrawAdminApi withdraws;
  private final WalletReconApi recon;
  private final CustomerAdminApi customers;
  private final AccountApi accounts;
  private final TradingAdminApi trading;
  private final TaskService tasks;
  private final AdminNames names;
  private final Audit audit;
  private final Clock clock;

  FundsOps(WalletAdminApi wallet, WithdrawAdminApi withdraws, WalletReconApi recon, CustomerAdminApi customers, AccountApi accounts,
      TradingAdminApi trading, TaskService tasks, AdminNames names, Audit audit, Clock clock) {
    this.wallet = wallet;
    this.withdraws = withdraws;
    this.recon = recon;
    this.customers = customers;
    this.accounts = accounts;
    this.trading = trading;
    this.tasks = tasks;
    this.names = names;
    this.audit = audit;
    this.clock = clock;
  }

  private LocalDateTime now() {
    return LocalDateTime.now(clock);
  }

  /** 按客户搜索：关键词为空返回 null（不筛选），否则返回匹配的客户号（可能为空） */
  private List<Long> userFilter(String keyword) {
    String kw = Ops.blank(keyword);
    return kw == null ? null : customers.search(kw, 500);
  }

  // ---------- 入金 ----------

  /** 原型状态 → 数据库状态：confirming 待确认、credited 已入账、ignored 已作废或低于最小金额、reversed 已冲正 */
  static List<String> depositStatuses(String api) {
    if (api == null || api.isBlank()) return null;
    return switch (api) {
      case "confirming" -> List.of("PENDING");
      case "credited" -> List.of("CREDITED");
      case "ignored" -> List.of("DROPPED", "BELOW_MIN");
      case "reversed" -> List.of("REVERSED");
      default -> List.of("-");
    };
  }

  static String depositStatus(String db) {
    return switch (db) {
      case "PENDING" -> "confirming";
      case "DROPPED", "BELOW_MIN" -> "ignored";
      default -> db.toLowerCase();
    };
  }

  @Transactional(readOnly = true)
  Ops.Page<DepositView> deposits(String chain, String status, String keyword, int page, int pageSize) {
    Ops.Slice s = Ops.slice(page, pageSize);
    String kw = Ops.blank(keyword);
    String tx = kw != null && TX_HASH.matcher(kw).matches() ? kw : null;
    List<Long> users = tx == null ? userFilter(kw) : null;
    var p = wallet.deposits(Ops.blank(chain), depositStatuses(status), tx, users, s.offset(), s.size());
    var cs = customers.customers(p.items().stream().map(WalletAdminApi.Deposit::userId).toList());
    return new Ops.Page<>(p.items().stream().map(d -> {
      var c = cs.get(d.userId());
      return new DepositView(String.valueOf(d.id()), d.userId(), c == null ? null : c.name(), c == null ? null : c.email(), d.chain(), d.txHash(),
          Ops.money(d.amount()), d.confirmations(), d.requiredConfirmations(), depositStatus(d.status()), Ops.time(d.detectedAt()), Ops.time(d.creditedAt()));
    }).toList(), p.total(), s.page(), s.size());
  }

  // ---------- 出金 ----------

  /** 原型状态 → 数据库状态。open = 冷静期 + 待审核 + 延迟期；broadcasting 包含"已审核待上链" */
  static List<String> withdrawStatuses(String api) {
    if (api == null || api.isBlank()) return null;
    return switch (api) {
      case "open" -> List.of("COOLING", "REVIEWING", "DELAYED");
      case "pending" -> List.of("REVIEWING");
      case "broadcasting" -> List.of("APPROVED", "BROADCASTING");
      case "failed" -> List.of("FAILED_REFUNDED");
      default -> List.of(api.toUpperCase());
    };
  }

  static String withdrawStatus(String db) {
    return switch (db) {
      case "REVIEWING" -> "pending";
      case "APPROVED" -> "broadcasting";
      case "FAILED_REFUNDED" -> "failed";
      default -> db.toLowerCase();
    };
  }

  private List<WithdrawalView> views(List<WalletAdminApi.Withdrawal> ws) {
    var cs = customers.customers(ws.stream().map(WalletAdminApi.Withdrawal::userId).toList());
    Map<Long, String> reviewers = names.of(ws.stream().map(WalletAdminApi.Withdrawal::reviewerId).filter(Objects::nonNull).toList());
    LocalDateTime now = now();
    return ws.stream().map(w -> {
      var c = cs.get(w.userId());
      Long remaining = "DELAYED".equals(w.status()) && w.delayEndsAt() != null ? Math.max(0, Duration.between(now, w.delayEndsAt()).toMinutes()) : null;
      return new WithdrawalView(String.valueOf(w.id()), w.userId(), c == null ? null : c.name(), c == null ? null : c.email(), Ops.money(w.amount()),
          Ops.money(w.fee()), w.chain(), w.address(), w.firstUse(), Ops.time(w.whitelistAddedAt()), withdrawStatus(w.status()), remaining,
          Ops.time(w.submittedAt()), w.reviewerId() == null ? null : reviewers.get(w.reviewerId()), w.rejectReason(), w.txHash());
    }).toList();
  }

  @Transactional(readOnly = true)
  Ops.Page<WithdrawalView> withdrawals(String status, String chain, String minAmount, String maxAmount, String keyword, int page, int pageSize) {
    Ops.Slice s = Ops.slice(page, pageSize);
    var p = wallet.withdrawals(withdrawStatuses(status), Ops.blank(chain), decimal(minAmount), decimal(maxAmount), userFilter(keyword), s.offset(), s.size());
    return new Ops.Page<>(views(p.items()), p.total(), s.page(), s.size());
  }

  private static BigDecimal decimal(String v) {
    try {
      return v == null || v.isBlank() ? null : new BigDecimal(v.strip());
    } catch (NumberFormatException e) {
      return null;
    }
  }

  @Transactional(readOnly = true)
  Summary summary() {
    var s = wallet.summary(now().toLocalDate().atStartOfDay());
    return new Summary(bucket(s.reviewing()), bucket(s.delayed()), bucket(s.cooling()), bucket(s.completedToday()));
  }

  private static Bucket bucket(WalletAdminApi.Bucket b) {
    return new Bucket(b.count(), Ops.money(b.amount()));
  }

  private WalletAdminApi.Withdrawal require(long id) {
    return wallet.withdrawal(id).orElseThrow(() -> new BizException("NOT_FOUND", "提现不存在"));
  }

  @Transactional(readOnly = true)
  WithdrawalDetail withdrawal(long id) {
    WalletAdminApi.Withdrawal w = require(id);
    WithdrawalView v = views(List.of(w)).getFirst();
    var c = customers.customer(w.userId()).map(CustomerAdminApi.CustomerDetail::customer).orElse(null);
    var f = wallet.customerFunds(w.userId(), 5);
    long days = c == null || c.registeredAt() == null ? 0 : Duration.between(c.registeredAt(), now()).toDays();
    return new WithdrawalDetail(v, c == null ? null : c.kycStatus().toLowerCase(), days, Ops.money(f.totalDeposit()),
        Ops.money(trading.balances(List.of(w.userId())).getOrDefault(w.userId(), BigDecimal.ZERO)),
        trading.openPositionCounts(List.of(w.userId())).getOrDefault(w.userId(), 0),
        f.recentDeposits().stream().map(d -> new Recent(Ops.time(d.creditedAt() == null ? d.detectedAt() : d.creditedAt()), d.chain(), Ops.money(d.amount()))).toList(),
        f.recentWithdrawals().stream().map(x -> new Recent(Ops.time(x.submittedAt()), x.chain(), Ops.money(x.amount()))).toList());
  }

  WithdrawalView approve(AdminContext actor, long id) {
    audit.run("withdrawal.approve", String.valueOf(id), false, null, () -> {
      withdraws.approve(id, actor.adminId());
      return Audit.Change.of(null, Map.of("status", "pending"), Map.of("status", withdrawStatus(require(id).status())));
    });
    return views(List.of(require(id))).getFirst();
  }

  WithdrawalView reject(AdminContext actor, long id, String reason) {
    String r = Audit.requireReason(reason);
    audit.run("withdrawal.reject", String.valueOf(id), false, r, () -> {
      withdraws.reject(id, actor.adminId(), r);
      return Audit.Change.of(null, Map.of("status", "pending"), Map.of("status", "rejected"));
    });
    return views(List.of(require(id))).getFirst();
  }

  /** 大额延迟期内紧急取消（高危，AC-21） */
  WithdrawalView emergencyCancel(AdminContext actor, long id, String reason) {
    String r = Audit.requireReason(reason);
    audit.run("withdrawal.emergency_cancel", String.valueOf(id), true, r, () -> {
      withdraws.emergencyCancel(id, actor.adminId(), r);
      return Audit.Change.of(null, Map.of("status", "delayed"), Map.of("status", "cancelled"));
    });
    return views(List.of(require(id))).getFirst();
  }

  // ---------- 对账 ----------

  @Transactional(readOnly = true)
  Ops.Page<ReconView> recon(String status, int page, int pageSize) {
    Ops.Slice s = Ops.slice(page, pageSize);
    String st = Ops.blank(status) == null ? null : status.strip().toUpperCase();
    List<WalletReconApi.Issue> items = recon.issues(st, s.offset(), s.size());
    var cs = customers.customers(items.stream().map(WalletReconApi.Issue::userId).filter(Objects::nonNull).toList());
    Map<Long, String> handlers = names.of(items.stream().map(WalletReconApi.Issue::resolvedBy).filter(Objects::nonNull).toList());
    List<ReconView> out = new ArrayList<>();
    for (WalletReconApi.Issue i : items) {
      var c = i.userId() == null ? null : cs.get(i.userId());
      String diff = i.expected() == null || i.actual() == null ? null : Ops.money(i.actual().subtract(i.expected()));
      out.add(new ReconView(String.valueOf(i.id()), i.kind().toLowerCase(), i.refId(), i.userId(), c == null ? null : c.name(), Ops.money(i.expected()),
          Ops.money(i.actual()), diff, i.detail(), i.status().toLowerCase(), i.note(), i.resolvedBy() == null ? null : handlers.get(i.resolvedBy()),
          Ops.time(i.createdAt()), Ops.time(i.resolvedAt())));
    }
    return new Ops.Page<>(out, recon.countIssues(st), s.page(), s.size());
  }

  void resolveRecon(AdminContext actor, long id, String note) {
    String n = Audit.requireReason(note);
    audit.run("recon.resolve", String.valueOf(id), false, n, () -> {
      recon.resolve(id, actor.adminId(), n);
      return Audit.Change.of(null, Map.of("status", "open"), Map.of("status", "resolved"));
    });
  }

  // ---------- 任务 ----------

  static String taskType(String db) {
    return switch (db) {
      case "MAIL_SEND" -> "email";
      case "PUSH_SEND" -> "push";
      default -> db.toLowerCase();
    };
  }

  static String taskDbType(String api) {
    if (api == null || api.isBlank()) return null;
    return switch (api) {
      case "email" -> "MAIL_SEND";
      case "push" -> "PUSH_SEND";
      default -> api.toUpperCase();
    };
  }

  static TaskStatus taskDbStatus(String api) {
    if (api == null || api.isBlank()) return null;
    return switch (api) {
      case "pending" -> TaskStatus.PENDING;
      case "processing" -> TaskStatus.RUNNING;
      case "success" -> TaskStatus.SUCCEEDED;
      case "failed" -> TaskStatus.FAILED;
      default -> throw new com.falconx.lite.common.error.ValidationException(
          List.of(new com.falconx.lite.common.error.ValidationException.Field("status", "invalid")));
    };
  }

  static String taskStatus(TaskStatus s) {
    return switch (s) {
      case PENDING -> "pending";
      case RUNNING -> "processing";
      case SUCCEEDED -> "success";
      case FAILED -> "failed";
    };
  }

  @Transactional(readOnly = true)
  Ops.Page<TaskView> tasks(String type, String status, int page, int pageSize) {
    Ops.Slice s = Ops.slice(page, pageSize);
    String t = taskDbType(type);
    TaskStatus st = taskDbStatus(status);
    return new Ops.Page<>(tasks.list(t, st, s.offset(), s.size()).stream().map(FundsOps::task).toList(), tasks.count(t, st), s.page(), s.size());
  }

  private static TaskView task(TaskItem i) {
    return new TaskView(String.valueOf(i.id()), taskType(i.taskType()), i.bizRef(), taskStatus(i.status()), i.attempts(), i.maxAttempts(),
        i.status() == TaskStatus.PENDING ? Ops.time(i.nextRunAt()) : null, i.lastError(), Ops.time(i.createdAt()), Ops.time(i.updatedAt()));
  }

  /** 手动重试：只有失败的能重试 */
  void retryTask(long id) {
    audit.run("task.retry", String.valueOf(id), false, null, () -> {
      if (tasks.find(id) == null) throw new BizException("NOT_FOUND", "任务不存在");
      if (!tasks.retry(id)) throw new BizException("TASK_NOT_FAILED", "只有失败的任务能重试");
      return Audit.Change.of(null, Map.of("status", "failed"), Map.of("status", "pending"));
    });
  }

  // ---------- KYC ----------

  private List<KycView> kycViews(List<CustomerAdminApi.KycApplication> ks) {
    Map<Long, String> reviewers = names.of(ks.stream().map(CustomerAdminApi.KycApplication::reviewerId).filter(Objects::nonNull).toList());
    return ks.stream().map(k -> new KycView(String.valueOf(k.id()), k.userId(), k.name(), k.email(), k.nationality(),
        k.birthDate() == null ? null : k.birthDate().toString(), CustomerOps.docType(k.docType()), k.docNumber(), k.status().toLowerCase(),
        Ops.time(k.submittedAt()), k.reviewerId() == null ? null : reviewers.get(k.reviewerId()), Ops.time(k.reviewedAt()), k.rejectReason())).toList();
  }

  @Transactional(readOnly = true)
  Ops.Page<KycView> kycs(String status, String keyword, int page, int pageSize) {
    Ops.Slice s = Ops.slice(page, pageSize);
    var p = customers.kycApplications(Ops.blank(status) == null ? null : status.strip().toUpperCase(), Ops.blank(keyword), s.offset(), s.size());
    return new Ops.Page<>(kycViews(p.items()), p.total(), s.page(), s.size());
  }

  @Transactional(readOnly = true)
  KycView kyc(long id) {
    return kycViews(List.of(customers.kycApplication(id).orElseThrow(() -> new BizException("NOT_FOUND", "申请不存在")))).getFirst();
  }

  CustomerAdminApi.Image kycImage(long id, String side) {
    return customers.kycImage(id, side).orElseThrow(() -> new BizException("NOT_FOUND", "没有这张照片"));
  }

  /** 审核：通过，或驳回（必须填原因，AC-05）；结果通过站内信和邮件通知客户 */
  KycView reviewKyc(AdminContext actor, long id, boolean approve, String reason) {
    String r = approve ? null : Audit.requireReason(reason);
    audit.run(approve ? "kyc.approve" : "kyc.reject", String.valueOf(id), false, r, () -> {
      if (approve) accounts.approveKyc(id, actor.adminId());
      else accounts.rejectKyc(id, actor.adminId(), r);
      return Audit.Change.of(null, Map.of("status", "pending"), Map.of("status", approve ? "approved" : "rejected"));
    });
    return kyc(id);
  }

  @Transactional(readOnly = true)
  Map<String, Long> badges(AdminContext ctx) {
    return Map.of("kyc", ctx.has(com.falconx.lite.admin.security.Permission.KYC_VIEW) ? customers.pendingKyc() : 0L, "withdrawals",
        ctx.has(com.falconx.lite.admin.security.Permission.WITHDRAWAL_VIEW) ? wallet.pendingReview() : 0L);
  }
}
