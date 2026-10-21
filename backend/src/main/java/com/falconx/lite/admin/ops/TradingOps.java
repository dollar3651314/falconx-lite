package com.falconx.lite.admin.ops;

import com.falconx.lite.account.api.CustomerAdminApi;
import com.falconx.lite.admin.security.Audit;
import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.trading.api.TradingAdminApi;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 后台"交易监控"（S16c）：订单、持仓、挂单；手动强平、强制撤单（高危，必须填原因）。 */
@Service
class TradingOps {

  /** 字段和原型 Order 一致；我们不保存被拒绝的下单请求，所以没有 rejected 状态，rejectReason 总是空 */
  record OrderView(String id, long customerId, String customerName, String symbol, String side, String type, String lots, String price, int leverage,
      String fee, String status, String rejectReason, String createdAt) {}

  /** 字段和原型 PendingOrder 一致 */
  record PendingView(String id, long customerId, String customerName, String symbol, String side, String lots, String limitPrice, String currentPrice,
      int leverage, String frozenMargin, String stopLoss, String takeProfit, String createdAt) {}

  /**
   * 一笔已平仓记录（体验优化 1021 UX-6 起）：reason 是 closed（客户平仓）/ tp / sl / liquidated；
   * partial 为 true 表示部分平仓拆出来的记录，parentId 是它来自的原持仓的编号（对外编号），整笔平仓时 parentId 为空。
   */
  record ClosedView(String id, String parentId, boolean partial, long customerId, String customerName, String symbol, String side, String lots,
      String openPrice, String closePrice, int leverage, String margin, String fee, String swap, String pnl, String reason, String openedAt, String closedAt) {}

  private final TradingAdminApi trading;
  private final CustomerAdminApi customers;
  private final Audit audit;

  TradingOps(TradingAdminApi trading, CustomerAdminApi customers, Audit audit) {
    this.trading = trading;
    this.customers = customers;
    this.audit = audit;
  }

  private List<Long> users(String keyword) {
    String kw = Ops.blank(keyword);
    return kw == null ? null : customers.search(kw, 500);
  }

  static String side(String api) {
    if (Ops.blank(api) == null) return null;
    return switch (api.strip().toLowerCase()) {
      case "buy" -> "BUY";
      case "sell" -> "SELL";
      default -> throw new ValidationException(List.of(new ValidationException.Field("side", "invalid")));
    };
  }

  private static String symbol(String s) {
    return Ops.blank(s) == null ? null : s.strip().toUpperCase();
  }

  private Map<Long, CustomerAdminApi.Customer> names(List<Long> ids) {
    return customers.customers(ids);
  }

  @Transactional(readOnly = true)
  Ops.Page<OrderView> orders(String symbol, String side, String status, String keyword, int page, int pageSize) {
    Ops.Slice s = Ops.slice(page, pageSize);
    String st = Ops.blank(status) == null ? null : status.strip().toUpperCase();
    var p = trading.orders(symbol(symbol), side(side), st, users(keyword), Ops.number(keyword), s.offset(), s.size());
    var cs = names(p.items().stream().map(TradingAdminApi.Order::userId).toList());
    return new Ops.Page<>(p.items().stream().map(o -> {
      var c = cs.get(o.userId());
      return new OrderView(String.valueOf(o.no()), o.userId(), c == null ? null : c.name(), o.symbol(), o.side().toLowerCase(), o.type().toLowerCase(),
          Ops.money(o.lots()), Ops.money(o.price()), o.leverage(), Ops.money(o.fee()), o.status().toLowerCase(), null, Ops.time(o.createdAt()));
    }).toList(), p.total(), s.page(), s.size());
  }

  @Transactional(readOnly = true)
  Ops.Page<CustomerOps.PositionView> positions(String symbol, String side, String keyword, int page, int pageSize) {
    Ops.Slice s = Ops.slice(page, pageSize);
    var p = trading.positions(symbol(symbol), side(side), users(keyword), Ops.number(keyword), s.offset(), s.size());
    var cs = names(p.items().stream().map(TradingAdminApi.Position::userId).toList());
    return new Ops.Page<>(p.items().stream().map(x -> position(x, cs.get(x.userId()))).toList(), p.total(), s.page(), s.size());
  }

  static CustomerOps.PositionView position(TradingAdminApi.Position p, CustomerAdminApi.Customer c) {
    return new CustomerOps.PositionView(String.valueOf(p.no()), p.userId(), c == null ? null : c.name(), p.symbol(), p.side().toLowerCase(), Ops.money(p.lots()),
        Ops.money(p.openPrice()), Ops.money(p.currentPrice()), p.leverage(), Ops.money(p.margin()),
        p.pnl() == null ? null : p.pnl().setScale(2, RoundingMode.HALF_UP).toPlainString(),
        p.marginLevel() == null ? null : p.marginLevel().multiply(BigDecimal.valueOf(100)).setScale(1, RoundingMode.DOWN).toPlainString(),
        Ops.money(p.liquidationPrice()), Ops.money(p.stopLoss()), Ops.money(p.takeProfit()), Ops.time(p.openedAt()));
  }

  @Transactional(readOnly = true)
  Ops.Page<ClosedView> closedPositions(String symbol, String side, String keyword, int page, int pageSize) {
    Ops.Slice s = Ops.slice(page, pageSize);
    var p = trading.closedPositions(symbol(symbol), side(side), users(keyword), Ops.number(keyword), s.offset(), s.size());
    var cs = names(p.items().stream().map(TradingAdminApi.ClosedPosition::userId).toList());
    return new Ops.Page<>(p.items().stream().map(x -> closed(x, cs.get(x.userId()))).toList(), p.total(), s.page(), s.size());
  }

  static ClosedView closed(TradingAdminApi.ClosedPosition p, CustomerAdminApi.Customer c) {
    return new ClosedView(String.valueOf(p.no()), p.parentNo() == null ? null : String.valueOf(p.parentNo()), p.parentNo() != null, p.userId(),
        c == null ? null : c.name(), p.symbol(), p.side().toLowerCase(), Ops.money(p.lots()), Ops.money(p.openPrice()), Ops.money(p.closePrice()), p.leverage(),
        Ops.money(p.margin()), Ops.money(p.fee()), Ops.money(p.swap()), Ops.money(p.pnl()), p.reason() == null ? null : p.reason().toLowerCase(),
        Ops.time(p.openedAt()), Ops.time(p.closedAt()));
  }

  @Transactional(readOnly = true)
  Ops.Page<PendingView> pending(String symbol, String side, String keyword, int page, int pageSize) {
    Ops.Slice s = Ops.slice(page, pageSize);
    var p = trading.pendingOrders(symbol(symbol), side(side), users(keyword), Ops.number(keyword), s.offset(), s.size());
    var cs = names(p.items().stream().map(TradingAdminApi.Pending::userId).toList());
    return new Ops.Page<>(p.items().stream().map(o -> {
      var c = cs.get(o.userId());
      return new PendingView(String.valueOf(o.no()), o.userId(), c == null ? null : c.name(), o.symbol(), o.side().toLowerCase(), Ops.money(o.lots()),
          Ops.money(o.limitPrice()), Ops.money(o.currentPrice()), o.leverage(), Ops.money(o.frozen()), Ops.money(o.stopLoss()), Ops.money(o.takeProfit()),
          Ops.time(o.createdAt()));
    }).toList(), p.total(), s.page(), s.size());
  }

  /** 手动强平（高危）：按当前市价平仓，客户收到强平通知。positionNo 是持仓的对外编号（审计里记的也是它） */
  Map<String, String> liquidate(long positionNo, String reason) {
    String r = Audit.requireReason(reason);
    long positionId = trading.positionIdByNo(positionNo).orElseThrow(() -> new BizException("NOT_FOUND", "持仓不存在"));
    return audit.run("position.liquidate", String.valueOf(positionNo), true, r, () -> {
      TradingAdminApi.Liquidated l = trading.liquidate(positionId);
      Map<String, String> out = Map.of("price", Ops.money(l.price()), "pnl", Ops.money(l.pnl()));
      return Audit.Change.of(out, Map.of("status", "open"), Map.of("status", "liquidated", "price", Ops.money(l.price()), "pnl", Ops.money(l.pnl())));
    });
  }

  /** 强制撤单（高危）：释放冻结。orderNo 是订单的对外编号 */
  void forceCancel(long orderNo, String reason) {
    String r = Audit.requireReason(reason);
    long orderId = trading.orderIdByNo(orderNo).orElseThrow(() -> new BizException("NOT_FOUND", "挂单不存在"));
    audit.run("pending.force_cancel", String.valueOf(orderNo), true, r, () -> {
      long uid = trading.forceCancel(orderId);
      return Audit.Change.of(null, Map.of("status", "pending"), Map.of("status", "cancelled", "customerId", uid));
    });
  }
}
