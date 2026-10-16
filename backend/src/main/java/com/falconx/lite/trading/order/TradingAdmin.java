package com.falconx.lite.trading.order;

import com.falconx.lite.common.error.BizException;
import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.notification.api.NotifyApi;
import com.falconx.lite.trading.api.AccountSnapshot;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerEntryType;
import com.falconx.lite.trading.api.TradingAdminApi;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/** {@link TradingAdminApi} 的实现。 */
@Service
class TradingAdmin implements TradingAdminApi {

  private final OrderMapper mapper;
  private final LedgerApi ledger;
  private final Funds funds;
  private final MarketApi market;
  private final PositionService positions;
  private final OrderService orders;
  private final TradingEvents events;
  private final NotifyApi notify;
  private final TransactionTemplate tx;
  private final Clock clock;

  TradingAdmin(OrderMapper mapper, LedgerApi ledger, Funds funds, MarketApi market, PositionService positions, OrderService orders, TradingEvents events,
      NotifyApi notify, TransactionTemplate tx, Clock clock) {
    this.mapper = mapper;
    this.ledger = ledger;
    this.funds = funds;
    this.market = market;
    this.positions = positions;
    this.orders = orders;
    this.events = events;
    this.notify = notify;
    this.tx = tx;
    this.clock = clock;
  }

  @Override
  @Transactional(readOnly = true)
  public Metrics metrics(long userId) {
    AccountSnapshot acc = ledger.snapshot(userId);
    List<PositionRow> ps = mapper.openPositions(userId);
    BigDecimal used = BigDecimal.ZERO;
    BigDecimal floating = BigDecimal.ZERO;
    for (PositionRow p : ps) {
      used = used.add(p.margin);
      floating = floating.add(funds.floatingPnl(p).orElse(BigDecimal.ZERO));
    }
    return new Metrics(acc.balance(), used, funds.available(acc, ps), floating, acc.withdrawFrozen(), acc.orderFrozen());
  }

  @Override
  @Transactional(readOnly = true)
  public List<Position> openPositions(long userId) {
    return mapper.openPositions(userId).stream().map(this::position).toList();
  }

  private Position position(PositionRow p) {
    Side side = Side.valueOf(p.side);
    Optional<MarketQuote> q = market.quote(p.symbol);
    BigDecimal current = q.map(side::closePrice).orElse(null);
    BigDecimal pnl = funds.floatingPnl(p).orElse(null);
    BigDecimal level = pnl == null || p.margin.signum() == 0 ? null : p.margin.add(pnl).divide(p.margin, 6, RoundingMode.DOWN);
    return new Position(p.id, p.publicNo, p.userId, p.symbol, p.side, p.lots, p.openPrice, current, p.leverage, p.margin, pnl, level, p.liquidationPrice, p.stopLoss,
        p.takeProfit, p.openedAt);
  }

  /** 客户筛选结果为空、也没有按编号找时直接返回空页（避免 IN () 的 SQL） */
  private static boolean nothing(Collection<Long> userIds, Long no) {
    return userIds != null && userIds.isEmpty() && no == null;
  }

  /** 空列表换成 null（SQL 里不出现 IN ()），由 no 决定 */
  private static Collection<Long> users(Collection<Long> userIds) {
    return userIds == null || userIds.isEmpty() ? null : userIds;
  }

  @Override
  @Transactional(readOnly = true)
  public Page<Order> orders(String symbol, String side, String status, Collection<Long> userIds, Long no, int offset, int limit) {
    if (nothing(userIds, no)) return new Page<>(List.of(), 0);
    Collection<Long> us = users(userIds);
    List<Order> items = mapper.adminOrders(symbol, side, status, us, no, offset, limit).stream()
        .map(o -> new Order(o.id, o.publicNo, o.userId, o.symbol, o.side, o.orderType, o.lots, o.fillPrice != null ? o.fillPrice : o.limitPrice, o.leverage, o.fee, o.status,
            o.createdAt))
        .toList();
    return new Page<>(items, mapper.countAdminOrders(symbol, side, status, us, no));
  }

  @Override
  @Transactional(readOnly = true)
  public Page<Position> positions(String symbol, String side, Collection<Long> userIds, Long no, int offset, int limit) {
    if (nothing(userIds, no)) return new Page<>(List.of(), 0);
    Collection<Long> us = users(userIds);
    return new Page<>(mapper.adminPositions(symbol, side, us, no, offset, limit).stream().map(this::position).toList(),
        mapper.countAdminPositions(symbol, side, us, no));
  }

  @Override
  @Transactional(readOnly = true)
  public Page<Pending> pendingOrders(String symbol, String side, Collection<Long> userIds, Long no, int offset, int limit) {
    if (nothing(userIds, no)) return new Page<>(List.of(), 0);
    Collection<Long> us = users(userIds);
    List<Pending> items = mapper.adminOrders(symbol, side, "PENDING", us, no, offset, limit).stream().map(o -> {
      Optional<MarketQuote> q = market.quote(o.symbol);
      BigDecimal current = q.map(x -> Side.BUY.name().equals(o.side) ? x.ask() : x.bid()).orElse(null);
      return new Pending(o.id, o.publicNo, o.userId, o.symbol, o.side, o.lots, o.limitPrice, current, o.leverage, o.frozenAmount, o.stopLoss, o.takeProfit, o.createdAt);
    }).toList();
    return new Page<>(items, mapper.countAdminOrders(symbol, side, "PENDING", us, no));
  }

  @Override
  @Transactional(readOnly = true)
  public Optional<Long> positionIdByNo(long no) {
    return Optional.ofNullable(mapper.positionIdByNo(null, no));
  }

  @Override
  @Transactional(readOnly = true)
  public Optional<Long> orderIdByNo(long no) {
    return Optional.ofNullable(mapper.orderIdByNo(null, no));
  }

  @Override
  public Liquidated liquidate(long positionId) {
    PositionRow head = mapper.positionById(positionId);
    if (head == null) throw new BizException("NOT_FOUND", "持仓不存在");
    long userId = head.userId;
    record Out(PositionService.Closed closed, String symbol, int digits) {}
    Out out = tx.execute(st -> {
      ledger.lock(userId);
      PositionRow p = mapper.lockOpenPosition(userId, positionId);
      if (p == null) throw new BizException("POSITION_NOT_OPEN", "持仓已平仓");
      if (!market.isTradingOpen(p.symbol, clock.instant())) throw new BizException("TRADING_CLOSED", "不在交易时段");
      MarketQuote q = market.quote(p.symbol).filter(MarketQuote::executable).orElseThrow(() -> new BizException("QUOTE_UNAVAILABLE", "报价暂不可用"));
      PositionService.Closed c = positions.closeLocked(p, Side.valueOf(p.side).closePrice(q), PositionService.CloseReason.LIQUIDATED);
      int digits = market.symbol(p.symbol).map(SymbolSpec::digits).orElse(8);
      String price = c.price().setScale(digits, RoundingMode.HALF_UP).toPlainString();
      notify.toUser(userId, "LIQUIDATED", Map.of("symbol", p.symbol, "price", price, "pnl", TradingController.money(c.pnl())));
      return new Out(c, p.symbol, digits);
    });
    events.changed(userId, "positions", "account");
    events.trade(userId, "liquidation", out.symbol(), TradingController.money(out.closed().pnl()),
        out.closed().price().setScale(out.digits(), RoundingMode.HALF_UP).toPlainString());
    return new Liquidated(positionId, userId, out.symbol(), out.closed().price(), out.closed().pnl());
  }

  @Override
  public long forceCancel(long orderId) {
    OrderRow o = mapper.orderById(orderId);
    if (o == null) throw new BizException("NOT_FOUND", "挂单不存在");
    orders.cancel(o.userId, orderId);
    return o.userId;
  }

  @Override
  @Transactional(readOnly = true)
  public long openUsage(String symbol) {
    return mapper.openUsage(symbol);
  }

  @Override
  @Transactional(readOnly = true)
  public long openPositionTotal() {
    return mapper.openPositionTotal();
  }

  @Override
  @Transactional(readOnly = true)
  public BigDecimal platformRealizedSince(LocalDateTime since) {
    BigDecimal customer = mapper.ledgerTotalSince(LedgerEntryType.TRADE_FEE.name(), since).add(mapper.ledgerTotalSince(LedgerEntryType.SWAP.name(), since))
        .add(mapper.ledgerTotalSince(LedgerEntryType.REALIZED_PNL.name(), since));
    return customer.negate();
  }

  @Override
  @Transactional(readOnly = true)
  public List<LedgerLine> balanceLedger(long userId, int limit) {
    return mapper.balanceLedger(userId, limit).stream()
        .map(r -> new LedgerLine(r.id, LedgerEntryType.valueOf(r.entryType), r.amount, r.valueAfter, r.bizType, r.bizId, r.createdAt)).toList();
  }

  @Override
  @Transactional(readOnly = true)
  public Map<Long, BigDecimal> balances(Collection<Long> userIds) {
    Map<Long, BigDecimal> out = new HashMap<>();
    if (userIds == null || userIds.isEmpty()) return out;
    for (OrderMapper.UserAmount r : mapper.balances(userIds)) out.put(r.userId, r.amount);
    return out;
  }

  @Override
  @Transactional(readOnly = true)
  public Map<Long, Integer> openPositionCounts(Collection<Long> userIds) {
    Map<Long, Integer> out = new HashMap<>();
    if (userIds == null || userIds.isEmpty()) return out;
    for (OrderMapper.UserAmount r : mapper.openPositionCounts(userIds)) out.put(r.userId, r.amount.intValue());
    return out;
  }
}
