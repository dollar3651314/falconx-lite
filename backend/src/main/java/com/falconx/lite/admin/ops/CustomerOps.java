package com.falconx.lite.admin.ops;

import com.falconx.lite.account.api.CustomerAdminApi;
import com.falconx.lite.admin.security.AdminContext;
import com.falconx.lite.admin.security.AdminNames;
import com.falconx.lite.admin.security.Audit;
import com.falconx.lite.common.config.ConfigKey;
import com.falconx.lite.common.config.SystemConfig;
import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.trading.api.Bucket;
import com.falconx.lite.trading.api.FundsApi;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerCommand;
import com.falconx.lite.trading.api.LedgerEntryType;
import com.falconx.lite.trading.api.TradingAdminApi;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 后台"客户"（S16b）：列表、详情、冻结 / 解冻（AC-04）、调余额（后台方案 G5）。
 * 调余额：单笔不超过 {@code adjust.singleLimit}、每个管理员当天（UTC）累计不超过 {@code adjust.dailyLimit}；
 * 扣减不能超过客户的可提金额（浮动盈利不算，和提现同一口径），所以余额不会被扣成负数；记账本 {@code ADMIN_ADJUST}。
 */
@Service
class CustomerOps {

  /** 字段和原型 CustomerSummary 一致 */
  record Summary(long id, String name, String email, String nationality, String status, String kycStatus, String balance, int openPositions,
      String registeredAt, String lastLoginAt) {}

  record Kyc(String status, String docType, String docNumber, String reviewedAt, String rejectReason) {}

  record Account(String balance, String usedMargin, String available, String floatingPnl, String frozenWithdraw) {}

  /** 字段和原型 Position 一致；没有报价时 currentPrice、pnl、marginLevel 为空 */
  record PositionView(String id, long customerId, String customerName, String symbol, String side, String lots, String openPrice, String currentPrice,
      int leverage, String margin, String pnl, String marginLevel, String liquidationPrice, String stopLoss, String takeProfit, String openedAt) {}

  record LedgerView(String id, String type, String amount, String balanceAfter, String ref, String time) {}

  /** 字段和原型 CustomerDetail 一致 */
  record Detail(long id, String name, String email, String nationality, String status, String kycStatus, String balance, int openPositions,
      String registeredAt, String lastLoginAt, String firstName, String middleName, String lastName, String birthDate, String frozenReason, Kyc kyc,
      Account account, List<PositionView> positions, List<LedgerView> ledger) {}

  record Limits(String singleLimit, String dailyLimit, String usedToday) {}

  private final CustomerAdminApi customers;
  private final TradingAdminApi trading;
  private final LedgerApi ledger;
  private final FundsApi funds;
  private final SystemConfig config;
  private final AdminNames names;
  private final AdjustMapper adjusts;
  private final Audit audit;
  private final Clock clock;

  CustomerOps(CustomerAdminApi customers, TradingAdminApi trading, LedgerApi ledger, FundsApi funds, SystemConfig config, AdminNames names,
      AdjustMapper adjusts, Audit audit, Clock clock) {
    this.customers = customers;
    this.trading = trading;
    this.ledger = ledger;
    this.funds = funds;
    this.config = config;
    this.names = names;
    this.adjusts = adjusts;
    this.audit = audit;
    this.clock = clock;
  }

  private LocalDateTime now() {
    return LocalDateTime.now(clock);
  }

  static String apiStatus(String s) {
    return s == null ? null : s.toLowerCase();
  }

  private static String dbStatus(String api) {
    return api == null || api.isBlank() ? null : api.strip().toUpperCase();
  }

  Summary summary(CustomerAdminApi.Customer c, BigDecimal balance, Integer positions) {
    return new Summary(c.id(), c.name(), c.email(), c.nationality(), apiStatus(c.status()), apiStatus(c.kycStatus()), Ops.money(balance == null ? BigDecimal.ZERO : balance),
        positions == null ? 0 : positions, Ops.time(c.registeredAt()), Ops.time(c.lastLoginAt()));
  }

  @Transactional(readOnly = true)
  Ops.Page<Summary> list(String keyword, String status, String kycStatus, int page, int pageSize) {
    Ops.Slice s = Ops.slice(page, pageSize);
    var p = customers.customers(Ops.blank(keyword), dbStatus(status), dbStatus(kycStatus), s.offset(), s.size());
    List<Long> ids = p.items().stream().map(CustomerAdminApi.Customer::id).toList();
    Map<Long, BigDecimal> balances = trading.balances(ids);
    Map<Long, Integer> counts = trading.openPositionCounts(ids);
    return new Ops.Page<>(p.items().stream().map(c -> summary(c, balances.get(c.id()), counts.get(c.id()))).toList(), p.total(), s.page(), s.size());
  }

  /** 发通知时按客户搜索：最多 20 个 */
  @Transactional(readOnly = true)
  List<Summary> search(String keyword) {
    return list(keyword, null, null, 1, 20).items();
  }

  @Transactional(readOnly = true)
  Detail detail(long id) {
    CustomerAdminApi.CustomerDetail d = customers.customer(id).orElseThrow(() -> new BizException("NOT_FOUND", "客户不存在"));
    CustomerAdminApi.Customer c = d.customer();
    TradingAdminApi.Metrics m = trading.metrics(id);
    List<PositionView> positions = trading.openPositions(id).stream().map(p -> new PositionView(String.valueOf(p.id()), id, c.name(), p.symbol(),
        p.side().toLowerCase(), Ops.money(p.lots()), Ops.money(p.openPrice()), Ops.money(p.currentPrice()), p.leverage(), Ops.money(p.margin()),
        p.pnl() == null ? null : p.pnl().setScale(2, RoundingMode.HALF_UP).toPlainString(),
        p.marginLevel() == null ? null : p.marginLevel().multiply(BigDecimal.valueOf(100)).setScale(1, RoundingMode.DOWN).toPlainString(),
        Ops.money(p.liquidationPrice()), Ops.money(p.stopLoss()), Ops.money(p.takeProfit()), Ops.time(p.openedAt()))).toList();
    List<LedgerView> lines = trading.balanceLedger(id, 50).stream().map(l -> new LedgerView(String.valueOf(l.id()), ledgerType(l.type()), Ops.money(l.amount()),
        Ops.money(l.balanceAfter()), l.bizType() + ":" + l.bizId(), Ops.time(l.time()))).toList();
    Kyc kyc = new Kyc(apiStatus(c.kycStatus()), docType(d.docType()), d.docNumber(), Ops.time(d.kycReviewedAt()), d.kycRejectReason());
    Account account = new Account(Ops.money(m.balance()), Ops.money(m.usedMargin()), Ops.money(m.available()), Ops.money(m.floatingPnl()),
        Ops.money(m.withdrawFrozen()));
    LocalDate birth = d.birthDate();
    return new Detail(c.id(), c.name(), c.email(), c.nationality(), apiStatus(c.status()), apiStatus(c.kycStatus()), Ops.money(m.balance()), positions.size(),
        Ops.time(c.registeredAt()), Ops.time(c.lastLoginAt()), d.firstName(), d.middleName(), d.lastName(), birth == null ? null : birth.toString(),
        d.frozenReason(), kyc, account, positions, lines);
  }

  static String docType(String db) {
    return db == null ? null : "ID_CARD".equals(db) ? "id_card" : db.toLowerCase();
  }

  /** 账本类型 → 原型的流水类型；没有对应的用小写原名 */
  static String ledgerType(LedgerEntryType t) {
    return switch (t) {
      case DEPOSIT, DEPOSIT_REVERSAL -> "deposit";
      case WITHDRAW_FREEZE, WITHDRAW_PAYOUT -> "withdraw";
      case WITHDRAW_UNFREEZE -> "refund";
      case TRADE_FEE -> "fee";
      case REALIZED_PNL -> "pnl";
      case SWAP -> "swap";
      case ADMIN_ADJUST -> "adjust";
      default -> t.name().toLowerCase();
    };
  }

  /** 冻结（必须填原因，客户所有登录立即失效，AC-04）或解冻 */
  @Transactional
  void setFrozen(long id, boolean frozen, String reason) {
    String r = Audit.requireReason(reason);
    audit.run(frozen ? "customer.freeze" : "customer.unfreeze", String.valueOf(id), true, r, () -> {
      CustomerAdminApi.CustomerDetail d = customers.customer(id).orElseThrow(() -> new BizException("NOT_FOUND", "客户不存在"));
      customers.setFrozen(id, frozen, frozen ? r : null);
      return Audit.Change.of(null, Map.of("status", apiStatus(d.customer().status())), Map.of("status", frozen ? "frozen" : "active"));
    });
  }

  private LocalDateTime startOfToday() {
    return now().toLocalDate().atStartOfDay();
  }

  @Transactional(readOnly = true)
  Limits limits(AdminContext actor) {
    return new Limits(Ops.money(config.decimal(ConfigKey.ADJUST_SINGLE_LIMIT, new BigDecimal("5000"))),
        Ops.money(config.decimal(ConfigKey.ADJUST_DAILY_LIMIT, new BigDecimal("20000"))), Ops.money(adjusts.usedSince(actor.adminId(), startOfToday())));
  }

  /** 调余额（高危，必须填原因）。direction：credit 加 / debit 减 */
  @Transactional
  Detail adjust(AdminContext actor, long id, String direction, String amount, String reason) {
    String r = Audit.requireReason(reason);
    boolean credit = "credit".equals(direction);
    if (!credit && !"debit".equals(direction)) throw new ValidationException(List.of(new ValidationException.Field("direction", "invalid")));
    BigDecimal amt = Ops.amount("amount", amount);
    audit.run("customer.adjust_balance", String.valueOf(id), true, r, () -> {
      customers.customer(id).orElseThrow(() -> new BizException("NOT_FOUND", "客户不存在"));
      BigDecimal single = config.decimal(ConfigKey.ADJUST_SINGLE_LIMIT, new BigDecimal("5000"));
      BigDecimal daily = config.decimal(ConfigKey.ADJUST_DAILY_LIMIT, new BigDecimal("20000"));
      if (amt.compareTo(single) > 0) throw new BizException("OVER_SINGLE_LIMIT", "超过单笔调整上限");
      names.lock(actor.adminId());
      if (adjusts.usedSince(actor.adminId(), startOfToday()).add(amt).compareTo(daily) > 0) throw new BizException("OVER_DAILY_LIMIT", "超过今天的累计调整上限");
      BigDecimal before = ledger.lock(id).balance();
      if (!credit && funds.withdrawable(id).compareTo(amt) < 0) throw new BizException("INSUFFICIENT_AVAILABLE", "扣减金额超过客户的可用余额");
      BigDecimal signed = credit ? amt : amt.negate();
      AdjustMapper.Row row = new AdjustMapper.Row();
      row.adminId = actor.adminId();
      row.userId = id;
      row.amount = signed;
      row.reason = r;
      row.createdAt = now();
      adjusts.insert(row);
      ledger.apply(new LedgerCommand(id, Bucket.BALANCE, signed, LedgerEntryType.ADMIN_ADJUST, "ADMIN_ADJUST", String.valueOf(row.id),
          "后台调余额：" + (r.length() > 200 ? r.substring(0, 200) : r)));
      return Audit.Change.of(null, Map.of("balance", Ops.money(before)), Map.of("balance", Ops.money(before.add(signed)), "amount", Ops.money(signed)));
    });
    return detail(id);
  }
}
