package com.falconx.lite.trading.order;

import com.falconx.lite.common.ratelimit.UserWriteLimited;
import com.falconx.lite.common.web.CurrentUser;
import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.trading.api.AccountSnapshot;
import com.falconx.lite.trading.api.LedgerApi;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 交易接口（S7）：账户、下单、持仓、挂单、撤单。字段名和客户端 web/client/src/api/types.ts 一致，数字一律用字符串。
 * S8 加了平仓、改止盈止损、追加保证金、改单、历史。
 * <p>订单号、持仓号（返回的 id、路径里的 {id}）都是对外编号（雪花 ID，E11），字符串；内部自增 id 不出现在接口里。
 * 路径里的编号不是这个客户的，当成不存在（和以前按内部 id 查不到一样的错误）。
 */
@RestController
class TradingController {

  record AccountView(String currency, String balance, String withdrawFrozen, String orderFrozen, String floatingPnl, String equity,
      String usedMargin, String available) {}

  record PositionView(String id, String symbol, String side, String lots, int leverage, String openPrice, String margin,
      String maintenanceMarginRate, String liquidationPrice, String takeProfit, String stopLoss, String openedAt, String swap) {}

  record PendingOrderView(String id, String symbol, String side, String lots, int leverage, String limitPrice, String takeProfit,
      String stopLoss, String frozenMargin, String createdAt) {}

  record HistoryView(String id, String symbol, String side, String lots, String openPrice, String closePrice, String pnl, String fee,
      String kind, String closedAt) {}

  record Page<T>(List<T> items, long total, int page, int pageSize) {}

  record TpSlRequest(String takeProfit, String stopLoss) {}

  record MarginRequest(String amount) {}

  record CloseView(String pnl, String price) {}

  private final OrderService orders;
  private final PositionService positions;
  private final Funds funds;
  private final LedgerApi ledger;
  private final MarketApi market;
  private final OrderMapper mapper;
  private final java.time.Clock clock;

  TradingController(OrderService orders, PositionService positions, Funds funds, LedgerApi ledger, MarketApi market, OrderMapper mapper,
      java.time.Clock clock) {
    this.orders = orders;
    this.positions = positions;
    this.funds = funds;
    this.ledger = ledger;
    this.market = market;
    this.mapper = mapper;
    this.clock = clock;
  }

  @GetMapping("/api/trading/account")
  AccountView account() {
    long uid = CurrentUser.id();
    AccountSnapshot a = ledger.snapshot(uid);
    List<PositionRow> ps = orders.positions(uid);
    BigDecimal pnl = BigDecimal.ZERO;
    BigDecimal used = BigDecimal.ZERO;
    for (PositionRow p : ps) {
      pnl = pnl.add(funds.floatingPnl(p).orElse(BigDecimal.ZERO));
      used = used.add(p.margin);
    }
    BigDecimal equity = a.balance().add(pnl);
    return new AccountView("USDT", money(a.balance()), money(a.withdrawFrozen()), money(a.orderFrozen()), money(pnl), money(equity),
        money(used), money(funds.available(a, ps)));
  }

  @UserWriteLimited
  @PostMapping("/api/trading/orders")
  PlaceOrder.Result place(@RequestBody PlaceOrder req) {
    return orders.place(CurrentUser.id(), req);
  }

  @GetMapping("/api/trading/positions")
  List<PositionView> positions() {
    return orders.positions(CurrentUser.id()).stream().map(this::view).toList();
  }

  private PositionView view(PositionRow p) {
    int d = digits(p.symbol);
    return new PositionView(String.valueOf(p.publicNo), p.symbol, p.side.toLowerCase(), lots(p.lots), p.leverage, price(p.openPrice, d), money(p.margin),
        plain(p.maintenanceMarginRate), price(p.liquidationPrice, d), price(p.takeProfit, d), price(p.stopLoss, d), iso(p.openedAt),
        money(p.swapTotal == null ? BigDecimal.ZERO : p.swapTotal));
  }

  /** 持仓的对外编号 → 内部 id；不是这个客户的返回 -1（后面按"持仓不存在"处理） */
  private long position(long uid, long no) {
    Long id = mapper.positionIdByNo(uid, no);
    return id == null ? -1 : id;
  }

  private long order(long uid, long no) {
    Long id = mapper.orderIdByNo(uid, no);
    return id == null ? -1 : id;
  }

  /** 全额平仓 */
  @UserWriteLimited
  @PostMapping("/api/trading/positions/{id}/close")
  CloseView close(@PathVariable long id) {
    long uid = CurrentUser.id();
    PositionService.Closed c = positions.close(uid, position(uid, id));
    return new CloseView(money(c.pnl()), plain(c.price()));
  }

  /** 修改止盈止损；字段不传或为空表示取消 */
  @UserWriteLimited
  @PutMapping("/api/trading/positions/{id}/tpsl")
  void tpSl(@PathVariable long id, @RequestBody TpSlRequest req) {
    long uid = CurrentUser.id();
    positions.updateTpSl(uid, position(uid, id), req.takeProfit(), req.stopLoss());
  }

  /** 追加保证金，返回更新后的持仓（新强平价） */
  @UserWriteLimited
  @PostMapping("/api/trading/positions/{id}/margin")
  PositionView addMargin(@PathVariable long id, @RequestBody MarginRequest req) {
    long uid = CurrentUser.id();
    return view(positions.addMargin(uid, position(uid, id), req.amount()));
  }

  /** 修改挂单：限价、手数、止盈止损 */
  @UserWriteLimited
  @PutMapping("/api/trading/orders/{id}")
  void modify(@PathVariable long id, @RequestBody OrderService.ModifyOrder req) {
    long uid = CurrentUser.id();
    orders.modify(uid, order(uid, id), req);
  }

  /** 资金流水的一条，字段和客户端 LedgerItem 一致；ref 是相关的品种或网络 */
  record LedgerView(String id, String type, String amount, String ref, String time) {}

  /** 客户端流水类型 → 账本类型（只看余额的变动） */
  static final Map<String, List<String>> LEDGER_TYPES = Map.of(
      "deposit", List.of("DEPOSIT", "DEPOSIT_REVERSAL"),
      "withdraw", List.of("WITHDRAW_FREEZE"),
      "withdrawRefund", List.of("WITHDRAW_UNFREEZE"),
      "pnl", List.of("REALIZED_PNL"),
      "fee", List.of("TRADE_FEE"),
      "swap", List.of("SWAP"),
      "adjust", List.of("ADMIN_ADJUST"));

  static String ledgerType(String entryType) {
    for (var e : LEDGER_TYPES.entrySet()) if (e.getValue().contains(entryType)) return e.getKey();
    return entryType.toLowerCase();
  }

  /**
   * 备注第二段是品种或网络（例如"开仓手续费 XAUUSD"、"充值 TRC20"、"平仓盈亏 XAUUSD TAKE_PROFIT"、"隔夜费 XAUUSD 2026-10-14"）；没有时为空。
   * 后台调余额的备注是管理员写的原因，不给客户看（E2E-3）。
   */
  static String ref(String remark) {
    if (remark == null || remark.startsWith("后台调余额")) return "";
    String[] parts = remark.strip().split("\\s+");
    if (parts.length < 2) return "";
    return parts[1].matches("[A-Z0-9]{3,12}") ? parts[1] : "";
  }

  /**
   * 资金流水（S17 补充）：余额的变动，最新在前。type：deposit / withdraw / withdrawRefund / margin / pnl / fee / swap / adjust，不传表示全部；
   * range：7d / 30d / 90d / all。margin（追加保证金）不改变余额，所以没有记录。
   */
  @GetMapping("/api/trading/ledger")
  Page<LedgerView> ledger(@RequestParam(required = false) String type, @RequestParam(defaultValue = "30d") String range,
      @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize) {
    int p = Math.max(page, 1);
    int size = Math.min(Math.max(pageSize, 1), 100);
    if (type != null && !type.isBlank() && !"all".equals(type) && !"margin".equals(type) && !LEDGER_TYPES.containsKey(type)) {
      throw new com.falconx.lite.common.error.ValidationException(List.of(new com.falconx.lite.common.error.ValidationException.Field("type", "invalid")));
    }
    if ("margin".equals(type)) return new Page<>(List.of(), 0, p, size);
    List<String> types = type == null || type.isBlank() || "all".equals(type) ? LEDGER_TYPES.values().stream().flatMap(List::stream).toList() : LEDGER_TYPES.get(type);
    java.time.LocalDateTime now = java.time.LocalDateTime.now(clock);
    java.time.LocalDateTime since = switch (range) {
      case "7d" -> now.minusDays(7);
      case "30d" -> now.minusDays(30);
      case "90d" -> now.minusDays(90);
      case "all" -> null;
      default -> throw new com.falconx.lite.common.error.ValidationException(List.of(new com.falconx.lite.common.error.ValidationException.Field("range", "invalid")));
    };
    long uid = CurrentUser.id();
    List<OrderMapper.LedgerRow> rows = mapper.userLedger(uid, types, since, (p - 1) * size, size);
    Map<Long, String> remarks = new java.util.HashMap<>();
    if (!rows.isEmpty()) for (var r : mapper.ledgerRemarks(rows.stream().map(r -> r.id).toList())) remarks.put(r.id, r.remark);
    List<LedgerView> items = rows.stream().map(r -> new LedgerView(String.valueOf(r.id), ledgerType(r.entryType), money(r.amount), ref(remarks.get(r.id)),
        iso(r.createdAt))).toList();
    return new Page<>(items, mapper.countUserLedger(uid, types, since), p, size);
  }

  /** 历史：已平仓的持仓和已撤销的挂单，按时间倒序分页 */
  @GetMapping("/api/trading/history")
  Page<HistoryView> history(@RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize) {
    int p = Math.max(page, 1);
    int size = Math.min(Math.max(pageSize, 1), 100);
    long uid = CurrentUser.id();
    List<HistoryView> items = orders.history(uid, (p - 1) * size, size).stream().map(h -> {
      int d = digits(h.symbol);
      return new HistoryView(h.id, h.symbol, h.side.toLowerCase(), lots(h.lots), price(h.openPrice, d), price(h.closePrice, d),
          h.pnl == null ? null : money(h.pnl), money(h.fee), h.kind, iso(h.at));
    }).toList();
    return new Page<>(items, orders.countHistory(uid), p, size);
  }

  @GetMapping("/api/trading/orders")
  List<PendingOrderView> pending() {
    return orders.pendingOrders(CurrentUser.id()).stream().map(o -> {
      int d = digits(o.symbol);
      return new PendingOrderView(String.valueOf(o.publicNo), o.symbol, o.side.toLowerCase(), lots(o.lots), o.leverage, price(o.limitPrice, d),
          price(o.takeProfit, d), price(o.stopLoss, d), money(o.frozenAmount), iso(o.createdAt));
    }).toList();
  }

  @UserWriteLimited
  @DeleteMapping("/api/trading/orders/{id}")
  void cancel(@PathVariable long id) {
    long uid = CurrentUser.id();
    orders.cancel(uid, order(uid, id));
  }

  private int digits(String symbol) {
    return market.symbol(symbol).map(SymbolSpec::digits).orElse(8);
  }

  /** 金额：最多 8 位小数，去掉末尾的 0 */
  static String money(BigDecimal v) {
    return v.setScale(8, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
  }

  static String plain(BigDecimal v) {
    return v.stripTrailingZeros().toPlainString();
  }

  static String lots(BigDecimal v) {
    return v.setScale(2, RoundingMode.HALF_UP).toPlainString();
  }

  static String price(BigDecimal v, int digits) {
    return v == null ? null : v.setScale(digits, RoundingMode.HALF_UP).toPlainString();
  }

  static String iso(LocalDateTime t) {
    return t == null ? null : t.toInstant(ZoneOffset.UTC).toString();
  }
}
