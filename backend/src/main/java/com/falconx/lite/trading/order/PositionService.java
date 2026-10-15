package com.falconx.lite.trading.order;

import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.trading.api.AccountSnapshot;
import com.falconx.lite.trading.api.Bucket;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerCommand;
import com.falconx.lite.trading.api.LedgerEntryType;
import java.math.BigDecimal;
import java.time.Clock;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 持仓操作（S8）：全额平仓、修改止盈止损、追加保证金。每个操作都先锁账户行、再锁持仓行。
 * 平仓的核心 {@link #closeLocked} 也给 S9 的止盈止损和强平用。
 */
@Service
class PositionService {

  static final String BIZ_POSITION = "POSITION";

  /** 平仓原因（trading_position.close_reason） */
  enum CloseReason { CLOSED, TP, SL, LIQUIDATED }

  /** 平仓结果：实现盈亏（USD）和平仓价 */
  record Closed(BigDecimal pnl, BigDecimal price) {}

  private final OrderMapper mapper;
  private final LedgerApi ledger;
  private final MarketApi market;
  private final Funds funds;
  private final TransactionTemplate tx;
  private final Clock clock;

  PositionService(OrderMapper mapper, LedgerApi ledger, MarketApi market, Funds funds, TransactionTemplate tx, Clock clock) {
    this.mapper = mapper;
    this.ledger = ledger;
    this.market = market;
    this.funds = funds;
    this.tx = tx;
    this.clock = clock;
  }

  /** 客户全额平仓：多单按 bid、空单按 ask，需要在交易时段内、报价可成交。 */
  Closed close(long userId, long positionId) {
    return tx.execute(st -> {
      ledger.lock(userId);
      PositionRow p = lockOpen(userId, positionId);
      if (!market.isTradingOpen(p.symbol, clock.instant())) throw new BizException("TRADING_CLOSED", "不在交易时段");
      MarketQuote q = market.quote(p.symbol).filter(MarketQuote::executable)
          .orElseThrow(() -> new BizException("QUOTE_UNAVAILABLE", "报价暂不可用"));
      return closeLocked(p, Side.valueOf(p.side).closePrice(q), CloseReason.CLOSED);
    });
  }

  /**
   * 按指定价格平掉一个已锁定的持仓（调用方负责事务和锁）。
   * 逐仓：亏损最多等于这个持仓的保证金（AC-14）。盈亏按当前汇率折算；汇率暂时没有时用开仓汇率，保证平仓不会因为汇率卡住。
   */
  Closed closeLocked(PositionRow p, BigDecimal exit, CloseReason reason) {
    BigDecimal rate = market.toUsdRate(p.quoteCcy).orElse(p.openUsdRate);
    BigDecimal pnl = OrderCalc.pnl(Side.valueOf(p.side), p.openPrice, exit, p.lots, p.contractSize, rate);
    BigDecimal maxLoss = p.margin.negate();
    if (pnl.compareTo(maxLoss) < 0) pnl = maxLoss;
    if (mapper.closePosition(p.id, exit, pnl, reason.name()) != 1) throw new BizException("NOT_FOUND", "持仓不存在或已平仓");
    if (pnl.signum() != 0) {
      ledger.apply(new LedgerCommand(p.userId, Bucket.BALANCE, pnl, LedgerEntryType.REALIZED_PNL, BIZ_POSITION, String.valueOf(p.id),
          "平仓盈亏 " + p.symbol + " " + reason.name()));
    }
    return new Closed(pnl, exit);
  }

  /**
   * 修改止盈止损（传空表示取消）。方向以当前平仓价为基准（没有报价时用开仓价），和客户端一致。
   */
  void updateTpSl(long userId, long positionId, String takeProfit, String stopLoss) {
    tx.executeWithoutResult(st -> {
      PositionRow p = lockOpen(userId, positionId);
      SymbolSpec spec = market.symbol(p.symbol).orElse(null);
      Side side = Side.valueOf(p.side);
      ValidationException.Collector errs = new ValidationException.Collector();
      BigDecimal tp = Checks.decimal(errs, "takeProfit", takeProfit, false);
      BigDecimal sl = Checks.decimal(errs, "stopLoss", stopLoss, false);
      Checks.digits(errs, spec, "takeProfit", tp);
      Checks.digits(errs, spec, "stopLoss", sl);
      BigDecimal base = market.quote(p.symbol).map(side::closePrice).orElse(p.openPrice);
      Checks.tpSl(errs, side, tp, sl, base);
      errs.throwIfAny();
      mapper.updateTpSl(p.id, tp, sl);
    });
  }

  /**
   * 追加保证金：不能超过可用余额（口径见 {@link Funds}）。强平价按这个持仓开仓时的维持保证金率和开仓汇率重算（修复 T-11）。
   * 保证金只是余额里被占用的部分，追加不改变余额，所以不记账；持仓的 margin 增加，可用减少。
   */
  PositionRow addMargin(long userId, long positionId, String amount) {
    return tx.execute(st -> {
      AccountSnapshot acc = ledger.lock(userId);
      PositionRow p = lockOpen(userId, positionId);
      ValidationException.Collector errs = new ValidationException.Collector();
      BigDecimal a = Checks.decimal(errs, "amount", amount, true);
      if (a != null && a.scale() > 2) errs.add("amount", "amountDigits");
      errs.throwIfAny();
      if (a.compareTo(funds.available(acc, mapper.openPositions(userId))) > 0) throw new BizException("MARGIN_INSUFFICIENT", "可用余额不足");
      int digits = market.symbol(p.symbol).map(SymbolSpec::digits).orElse(p.liquidationPrice.scale());
      p.margin = p.margin.add(a);
      p.liquidationPrice = OrderCalc.liquidationPrice(Side.valueOf(p.side), p.openPrice, p.lots, p.contractSize, p.openUsdRate, p.margin,
          p.maintenanceMarginRate, digits);
      mapper.updateMargin(p.id, p.margin, p.liquidationPrice);
      return p;
    });
  }

  private PositionRow lockOpen(long userId, long positionId) {
    PositionRow p = mapper.lockOpenPosition(userId, positionId);
    if (p == null) throw new BizException("NOT_FOUND", "持仓不存在或已平仓");
    return p;
  }
}
