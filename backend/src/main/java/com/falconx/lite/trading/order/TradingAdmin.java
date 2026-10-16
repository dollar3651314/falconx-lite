package com.falconx.lite.trading.order;

import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.trading.api.AccountSnapshot;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerEntryType;
import com.falconx.lite.trading.api.TradingAdminApi;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** {@link TradingAdminApi} 的实现。 */
@Service
class TradingAdmin implements TradingAdminApi {

  private final OrderMapper mapper;
  private final LedgerApi ledger;
  private final Funds funds;
  private final MarketApi market;

  TradingAdmin(OrderMapper mapper, LedgerApi ledger, Funds funds, MarketApi market) {
    this.mapper = mapper;
    this.ledger = ledger;
    this.funds = funds;
    this.market = market;
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
    return mapper.openPositions(userId).stream().map(p -> {
      Side side = Side.valueOf(p.side);
      Optional<MarketQuote> q = market.quote(p.symbol);
      BigDecimal current = q.map(side::closePrice).orElse(null);
      BigDecimal pnl = funds.floatingPnl(p).orElse(null);
      BigDecimal level = pnl == null || p.margin.signum() == 0 ? null : p.margin.add(pnl).divide(p.margin, 6, RoundingMode.DOWN);
      return new Position(p.id, p.userId, p.symbol, p.side, p.lots, p.openPrice, current, p.leverage, p.margin, pnl, level, p.liquidationPrice, p.stopLoss,
          p.takeProfit, p.openedAt);
    }).toList();
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
