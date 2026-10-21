package com.falconx.lite.trading.order;

import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.common.id.Snowflake;
import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.notification.api.NotifyApi;
import com.falconx.lite.trading.api.AccountSnapshot;
import com.falconx.lite.trading.api.Bucket;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerCommand;
import com.falconx.lite.trading.api.LedgerEntryType;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 持仓操作（S8）：平仓（全部或部分，部分平仓是体验优化 1021 UX-6）、修改止盈止损、追加保证金。每个操作都先锁账户行、再锁持仓行。
 * 开仓的核心 {@link #openLocked}（市价单、限价单成交）和平仓的核心 {@link #closeLocked}（客户平仓、止盈止损、强平）都在这里。
 */
@Service
class PositionService {

  static final String BIZ_POSITION = "POSITION";

  /** 平仓原因（trading_position.close_reason） */
  enum CloseReason { CLOSED, TP, SL, LIQUIDATED }

  /** 平仓结果：实现盈亏（USD）、平仓价、平掉的手数、剩下的手数（全部平仓时为 0） */
  record Closed(BigDecimal pnl, BigDecimal price, BigDecimal closedLots, BigDecimal remainingLots) {}

  private final OrderMapper mapper;
  private final LedgerApi ledger;
  private final MarketApi market;
  private final Funds funds;
  private final TransactionTemplate tx;
  private final Clock clock;
  private final TradingEvents events;
  private final Snowflake ids;
  private final NotifyApi notify;

  PositionService(OrderMapper mapper, LedgerApi ledger, MarketApi market, Funds funds, TransactionTemplate tx, Clock clock, TradingEvents events, Snowflake ids,
      NotifyApi notify) {
    this.mapper = mapper;
    this.ledger = ledger;
    this.market = market;
    this.funds = funds;
    this.tx = tx;
    this.clock = clock;
    this.events = events;
    this.ids = ids;
    this.notify = notify;
  }

  /**
   * 按成交价开仓（调用方负责事务和账户锁）：市价单下单时、限价单撮合时都走这里。
   * 按成交价重算名义价值、保证金、手续费和强平价，写持仓，订单标为已成交，记手续费。
   */
  PositionRow openLocked(OrderRow o, SymbolSpec spec, BigDecimal price, BigDecimal rate) {
    Side side = Side.valueOf(o.side);
    BigDecimal notional = OrderCalc.notionalUsd(price, o.lots, spec.contractSize(), rate);
    BigDecimal margin = OrderCalc.margin(notional, o.leverage);
    BigDecimal fee = OrderCalc.fee(notional, spec.feeRate());
    PositionRow p = new PositionRow();
    p.publicNo = ids.next();
    p.userId = o.userId;
    p.orderId = o.id;
    p.symbol = spec.code();
    p.side = side.name();
    p.lots = o.lots;
    p.leverage = o.leverage;
    p.openPrice = price;
    p.contractSize = spec.contractSize();
    p.quoteCcy = spec.quoteCcy();
    p.openUsdRate = rate;
    p.notionalUsd = notional;
    p.margin = margin;
    p.fee = fee;
    p.maintenanceMarginRate = spec.maintenanceMarginRate();
    p.liquidationPrice = OrderCalc.liquidationPrice(side, price, o.lots, spec.contractSize(), rate, margin, spec.maintenanceMarginRate(), spec.digits());
    p.takeProfit = o.takeProfit;
    p.stopLoss = o.stopLoss;
    mapper.insertPosition(p);
    mapper.markFilled(o.id, price, p.id);
    if (fee.signum() != 0) {
      try {
        ledger.apply(new LedgerCommand(o.userId, Bucket.BALANCE, fee.negate(), LedgerEntryType.TRADE_FEE, OrderService.BIZ_ORDER, String.valueOf(o.id),
            "开仓手续费 " + spec.code()));
      } catch (BizException e) {
        if ("INSUFFICIENT_FUNDS".equals(e.code())) throw new BizException("INSUFFICIENT_BALANCE", "余额不足");
        throw e;
      }
    }
    return p;
  }

  /** 客户全额平仓（老客户端、不带手数） */
  Closed close(long userId, long positionId) {
    return close(userId, positionId, null);
  }

  /**
   * 客户平仓：多单按 bid、空单按 ask，需要在交易时段内、报价可成交。
   * lots 为空或等于持仓手数 = 全部平仓；小于持仓手数 = 部分平仓（体验优化 1021 UX-6，见 {@link #closePartLocked}）。
   * 手数在锁住持仓之后按持仓<b>当前</b>的手数检查：客户看到的手数和实际不一致（例如同时被止盈平掉一部分不可能，但追加保证金、
   * 其他设备的部分平仓会改变手数）时，超过当前手数报 closeLotsMax，不会多平；持仓已经被止盈止损、强平平掉时报"持仓不存在或已平仓"。
   */
  Closed close(long userId, long positionId, String lotsRaw) {
    record Out(Closed closed, boolean partial) {}
    Out out = tx.execute(st -> {
      ledger.lock(userId);
      PositionRow p = lockOpen(userId, positionId);
      SymbolSpec spec = market.symbol(p.symbol).orElse(null);
      BigDecimal lots = closeLots(p, spec, lotsRaw);
      if (!market.isTradingOpen(p.symbol, clock.instant())) throw new BizException("TRADING_CLOSED", "不在交易时段");
      MarketQuote q = market.quote(p.symbol).filter(MarketQuote::executable)
          .orElseThrow(() -> new BizException("QUOTE_UNAVAILABLE", "报价暂不可用"));
      BigDecimal exit = Side.valueOf(p.side).closePrice(q);
      int digits = spec == null ? 8 : spec.digits();
      boolean partial = lots.compareTo(p.lots) < 0;
      Closed closed = partial ? closePartLocked(p, lots, exit, digits) : closeLocked(p, exit, CloseReason.CLOSED);
      String price = closed.price().setScale(digits, RoundingMode.HALF_UP).toPlainString();
      // 手动平仓站内信（体验优化 1021 UX-9：只发站内信，渠道只有 INBOX），和平仓同一事务（约定 14）。
      // 部分平仓用 POSITION_PARTIAL_CLOSED（V32），写明平了多少手、还剩多少手
      if (partial) {
        notify.toUser(userId, "POSITION_PARTIAL_CLOSED", Map.of("symbol", p.symbol, "side", p.side, "lots", lotsText(closed.closedLots()), "price", price,
            "pnl", TradingController.money(closed.pnl()), "remaining", lotsText(closed.remainingLots())));
      } else {
        notify.toUser(userId, "POSITION_CLOSED", Map.of("symbol", p.symbol, "side", p.side, "lots", lotsText(p.lots), "price", price, "pnl",
            TradingController.money(closed.pnl())));
      }
      return new Out(closed, partial);
    });
    events.changed(userId, "positions", "account");
    return out.closed();
  }

  /**
   * 平仓手数检查（字段 lots，错误码和客户端 validateCloseLots 一致）：正数、按品种步长、不超过持仓手数；
   * 部分平仓时平掉的和剩下的都不能小于品种最小手数（剩下的太少就只能全部平仓）。不传返回持仓手数（全部平仓）。
   */
  static BigDecimal closeLots(PositionRow p, SymbolSpec spec, String raw) {
    if (raw == null || raw.isBlank()) return p.lots;
    ValidationException.Collector errs = new ValidationException.Collector();
    BigDecimal lots = Checks.decimal(errs, "lots", raw, true);
    errs.throwIfAny();
    if (spec != null && spec.lotStep().signum() > 0 && lots.remainder(spec.lotStep()).signum() != 0) errs.add("lots", "lotsStep");
    int c = lots.compareTo(p.lots);
    if (c > 0) {
      errs.add("lots", "closeLotsMax");
    } else if (c < 0) {
      // 品种参数取不到时（品种已删除）只能全部平仓
      BigDecimal min = spec == null ? p.lots : spec.minLots();
      if (lots.compareTo(min) < 0) errs.add("lots", "lotsMin");
      if (p.lots.subtract(lots).compareTo(min) < 0) errs.add("lots", "closeRemainMin");
    }
    errs.throwIfAny();
    return c == 0 ? p.lots : lots;
  }

  /**
   * 市价单成交开仓的站内信（体验优化 1021 UX-9：只发站内信，模板 POSITION_OPENED 的渠道只有 INBOX）。调用方在开仓的事务里调用（约定 14）。
   * 限价挂单成交另有 ORDER_FILLED（MatchingEngine），不走这里。
   */
  void notifyMarketOpened(PositionRow p, SymbolSpec spec) {
    notify.toUser(p.userId, "POSITION_OPENED", Map.of("symbol", p.symbol, "side", p.side, "lots", lotsText(p.lots), "price",
        p.openPrice.setScale(spec.digits(), RoundingMode.HALF_UP).toPlainString()));
  }

  /** 通知里的手数：至少两位小数，和客户端显示一致（0.10 而不是 0.1） */
  static String lotsText(BigDecimal lots) {
    BigDecimal v = lots.stripTrailingZeros();
    return (v.scale() < 2 ? v.setScale(2) : v).toPlainString();
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
    return new Closed(pnl, exit, p.lots, BigDecimal.ZERO);
  }

  /**
   * 部分平仓（体验优化 1021 UX-6，V32 拆行；调用方负责事务和锁，lots 已经检查过、小于持仓手数）：
   * <ol>
   *   <li>平掉的部分新插一行持仓（新的对外编号，parent_id 指向原持仓，订单号、开仓时间、开仓价、杠杆、汇率、止盈止损和原持仓相同），
   *       保证金、手续费、累计隔夜费、名义价值按手数比例拆过去（8 位小数，原持仓用减法得到，两行合计和拆分前一分不差）；</li>
   *   <li>原持仓减去这部分，强平价按剩余手数和剩余保证金重算（按比例拆分时数学上不变，重算只消掉舍入误差），止盈止损不变；</li>
   *   <li>拆出来的行按 {@link #closeLocked} 平掉：盈亏只算这部分手数，亏损封顶 = 这部分的保证金；账本一笔 REALIZED_PNL，来源是拆出来的行。</li>
   * </ol>
   * 挂单不受影响。拆出来的行记下原持仓当时最大的隔夜费记录号（split_swap_seq），隔夜费补结算时不会对同一结算日重复收（{@link SwapService}）。
   */
  Closed closePartLocked(PositionRow p, BigDecimal lots, BigDecimal exit, int digits) {
    BigDecimal total = p.lots;
    BigDecimal remain = total.subtract(lots);
    BigDecimal swap = p.swapTotal == null ? BigDecimal.ZERO : p.swapTotal;
    PositionRow part = new PositionRow();
    part.publicNo = ids.next();
    part.userId = p.userId;
    part.orderId = p.orderId;
    part.parentId = p.id;
    part.symbol = p.symbol;
    part.side = p.side;
    part.lots = lots;
    part.leverage = p.leverage;
    part.openPrice = p.openPrice;
    part.contractSize = p.contractSize;
    part.quoteCcy = p.quoteCcy;
    part.openUsdRate = p.openUsdRate;
    part.notionalUsd = share(p.notionalUsd, lots, total);
    part.margin = share(p.margin, lots, total);
    part.fee = share(p.fee, lots, total);
    part.swapTotal = share(swap, lots, total);
    part.splitSwapSeq = mapper.maxSwapId(p.id);
    part.maintenanceMarginRate = p.maintenanceMarginRate;
    part.liquidationPrice = p.liquidationPrice;
    part.takeProfit = p.takeProfit;
    part.stopLoss = p.stopLoss;
    part.openedAt = p.openedAt;
    mapper.insertSplit(part);

    BigDecimal margin = p.margin.subtract(part.margin);
    BigDecimal liq = OrderCalc.liquidationPrice(Side.valueOf(p.side), p.openPrice, remain, p.contractSize, p.openUsdRate, margin, p.maintenanceMarginRate, digits);
    if (mapper.shrinkPosition(p.id, remain, margin, p.fee.subtract(part.fee), swap.subtract(part.swapTotal), p.notionalUsd.subtract(part.notionalUsd), liq) != 1) {
      throw new BizException("NOT_FOUND", "持仓不存在或已平仓");
    }
    Closed c = closeLocked(part, exit, CloseReason.CLOSED);
    return new Closed(c.pnl(), c.price(), lots, remain);
  }

  /** 按手数比例拆：v × part ÷ total，8 位小数 */
  static BigDecimal share(BigDecimal v, BigDecimal part, BigDecimal total) {
    return v.multiply(part).divide(total, OrderCalc.MONEY_SCALE, RoundingMode.HALF_UP);
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
    events.changed(userId, "positions");
  }

  /**
   * 追加保证金：不能超过可用余额（口径见 {@link Funds}）。强平价按这个持仓开仓时的维持保证金率和开仓汇率重算（修复 T-11）。
   * 保证金只是余额里被占用的部分，追加不改变余额，所以不记账；持仓的 margin 增加，可用减少。
   */
  PositionRow addMargin(long userId, long positionId, String amount) {
    PositionRow updated = tx.execute(st -> {
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
    events.changed(userId, "positions", "account");
    return updated;
  }

  private PositionRow lockOpen(long userId, long positionId) {
    PositionRow p = mapper.lockOpenPosition(userId, positionId);
    if (p == null) throw new BizException("NOT_FOUND", "持仓不存在或已平仓");
    return p;
  }
}
