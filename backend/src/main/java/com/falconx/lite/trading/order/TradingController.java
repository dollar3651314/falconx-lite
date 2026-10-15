package com.falconx.lite.trading.order;

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
 */
@RestController
class TradingController {

  record AccountView(String currency, String balance, String withdrawFrozen, String orderFrozen, String floatingPnl, String equity,
      String usedMargin, String available) {}

  record PositionView(String id, String symbol, String side, String lots, int leverage, String openPrice, String margin,
      String maintenanceMarginRate, String liquidationPrice, String takeProfit, String stopLoss, String openedAt) {}

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

  TradingController(OrderService orders, PositionService positions, Funds funds, LedgerApi ledger, MarketApi market) {
    this.orders = orders;
    this.positions = positions;
    this.funds = funds;
    this.ledger = ledger;
    this.market = market;
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
    return new PositionView(String.valueOf(p.id), p.symbol, p.side.toLowerCase(), lots(p.lots), p.leverage, price(p.openPrice, d), money(p.margin),
        plain(p.maintenanceMarginRate), price(p.liquidationPrice, d), price(p.takeProfit, d), price(p.stopLoss, d), iso(p.openedAt));
  }

  /** 全额平仓 */
  @PostMapping("/api/trading/positions/{id}/close")
  CloseView close(@PathVariable long id) {
    PositionService.Closed c = positions.close(CurrentUser.id(), id);
    return new CloseView(money(c.pnl()), plain(c.price()));
  }

  /** 修改止盈止损；字段不传或为空表示取消 */
  @PutMapping("/api/trading/positions/{id}/tpsl")
  void tpSl(@PathVariable long id, @RequestBody TpSlRequest req) {
    positions.updateTpSl(CurrentUser.id(), id, req.takeProfit(), req.stopLoss());
  }

  /** 追加保证金，返回更新后的持仓（新强平价） */
  @PostMapping("/api/trading/positions/{id}/margin")
  PositionView addMargin(@PathVariable long id, @RequestBody MarginRequest req) {
    return view(positions.addMargin(CurrentUser.id(), id, req.amount()));
  }

  /** 修改挂单：限价、手数、止盈止损 */
  @PutMapping("/api/trading/orders/{id}")
  void modify(@PathVariable long id, @RequestBody OrderService.ModifyOrder req) {
    orders.modify(CurrentUser.id(), id, req);
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
      return new PendingOrderView(String.valueOf(o.id), o.symbol, o.side.toLowerCase(), lots(o.lots), o.leverage, price(o.limitPrice, d),
          price(o.takeProfit, d), price(o.stopLoss, d), money(o.frozenAmount), iso(o.createdAt));
    }).toList();
  }

  @DeleteMapping("/api/trading/orders/{id}")
  void cancel(@PathVariable long id) {
    orders.cancel(CurrentUser.id(), id);
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
