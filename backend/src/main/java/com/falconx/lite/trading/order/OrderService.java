package com.falconx.lite.trading.order;

import com.falconx.lite.common.error.BizException;
import com.falconx.lite.common.error.ValidationException;
import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.risk.api.RiskApi;
import com.falconx.lite.trading.api.AccountSnapshot;
import com.falconx.lite.trading.api.Bucket;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerCommand;
import com.falconx.lite.trading.api.LedgerEntryType;
import java.math.BigDecimal;
import java.time.Clock;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 下单和撤单（S7）。顺序：
 * <ol>
 *   <li>同一个 clientOrderId 已经下过单 → 直接返回第一次的结果（幂等）</li>
 *   <li>字段格式，全部错误一次返回（C56）</li>
 *   <li>能不能开仓：交易时段、品种暂停、全局暂停、报价可成交、汇率有效、杠杆上限（需求 4.3-9）</li>
 *   <li>止盈止损方向（以成交参考价或限价为基准）</li>
 *   <li>事务里锁账户行 → 持仓上限 → 可用余额 → 写订单、持仓、账本</li>
 * </ol>
 * 可用 = 余额 + 浮动盈亏 − 已用保证金 − 挂单冻结（和原型一致）。
 */
@Service
@EnableConfigurationProperties(TradingProperties.class)
class OrderService {

  static final String BIZ_ORDER = "ORDER";
  private static final Pattern DECIMAL = Pattern.compile("\\d{1,16}(\\.\\d{1,8})?");

  private final OrderMapper mapper;
  private final LedgerApi ledger;
  private final MarketApi market;
  private final RiskApi risk;
  private final TradingProperties props;
  private final TransactionTemplate tx;
  private final Clock clock;

  OrderService(OrderMapper mapper, LedgerApi ledger, MarketApi market, RiskApi risk, TradingProperties props, TransactionTemplate tx, Clock clock) {
    this.mapper = mapper;
    this.ledger = ledger;
    this.market = market;
    this.risk = risk;
    this.props = props;
    this.tx = tx;
    this.clock = clock;
  }

  /** 校验通过后的请求 */
  private record Checked(SymbolSpec spec, boolean limit, Side side, BigDecimal lots, int leverage, BigDecimal limitPrice, BigDecimal tp, BigDecimal sl) {}

  PlaceOrder.Result place(long userId, PlaceOrder req) {
    if (req.clientOrderId() != null) {
      OrderRow existing = mapper.findByClientId(userId, req.clientOrderId());
      if (existing != null) return resultOf(existing);
    }
    Checked c = validate(req);
    SymbolSpec spec = c.spec();

    if (!market.isTradingOpen(spec.code(), clock.instant())) throw reject("TRADING_CLOSED", "不在交易时段");
    if (spec.openPaused()) throw reject("SYMBOL_PAUSED", "品种暂停开仓");
    if (risk.globalOpenPaused()) throw reject("GLOBAL_PAUSED", "全局暂停开仓");
    MarketQuote q = market.quote(spec.code()).filter(MarketQuote::executable)
        .orElseThrow(() -> reject("QUOTE_UNAVAILABLE", "报价暂不可用"));
    BigDecimal rate = market.liveUsdRate(spec.quoteCcy()).orElseThrow(() -> reject("RATE_STALE", "汇率失效"));
    if (c.leverage() > spec.maxLeverage()) throw reject("LEVERAGE_EXCEEDED", "超过杠杆上限");

    BigDecimal price = c.limit() ? c.limitPrice() : c.side().openPrice(q);
    checkTpSl(c, price);

    BigDecimal notional = OrderCalc.notionalUsd(price, c.lots(), spec.contractSize(), rate);
    BigDecimal margin = OrderCalc.margin(notional, c.leverage());
    BigDecimal fee = OrderCalc.fee(notional, spec.feeRate());

    return tx.execute(st -> {
      AccountSnapshot acc = ledger.lock(userId);
      // 加锁后再查一次：同一个 clientOrderId 并发提交时，第二个在这里拿到第一个的结果
      OrderRow again = mapper.findByClientId(userId, req.clientOrderId());
      if (again != null) return resultOf(again);

      List<PositionRow> positions = mapper.openPositions(userId);
      List<OrderRow> pending = mapper.pendingOrders(userId);
      BigDecimal total = notional;
      for (PositionRow p : positions) total = total.add(p.notionalUsd);
      for (OrderRow o : pending) total = total.add(o.notionalUsd);
      if (total.compareTo(props.positionLimitUsd()) > 0) throw reject("POSITION_LIMIT", "超过持仓上限");

      BigDecimal need = margin.add(fee);
      if (need.compareTo(available(acc, positions)) > 0) throw reject("INSUFFICIENT_BALANCE", "可用余额不足");

      OrderRow o = new OrderRow();
      o.userId = userId;
      o.clientOrderId = req.clientOrderId();
      o.symbol = spec.code();
      o.orderType = c.limit() ? "LIMIT" : "MARKET";
      o.side = c.side().name();
      o.lots = c.lots();
      o.leverage = c.leverage();
      o.limitPrice = c.limitPrice();
      o.takeProfit = c.tp();
      o.stopLoss = c.sl();
      o.notionalUsd = notional;
      if (c.limit()) {
        // 挂单冻结保证金和手续费，成交时（S9）不会因为余额变化付不起手续费
        o.frozenAmount = need;
        o.status = "PENDING";
        mapper.insertOrder(o);
        post(userId, Bucket.ORDER_FROZEN, need, LedgerEntryType.ORDER_FREEZE, o.id, "限价单冻结 " + spec.code());
        return new PlaceOrder.Result("pending", String.valueOf(o.id), null);
      }
      o.frozenAmount = BigDecimal.ZERO;
      o.status = "FILLED";
      mapper.insertOrder(o);
      PositionRow p = new PositionRow();
      p.userId = userId;
      p.orderId = o.id;
      p.symbol = spec.code();
      p.side = c.side().name();
      p.lots = c.lots();
      p.leverage = c.leverage();
      p.openPrice = price;
      p.contractSize = spec.contractSize();
      p.quoteCcy = spec.quoteCcy();
      p.openUsdRate = rate;
      p.notionalUsd = notional;
      p.margin = margin;
      p.fee = fee;
      p.maintenanceMarginRate = spec.maintenanceMarginRate();
      p.liquidationPrice = OrderCalc.liquidationPrice(c.side(), price, c.lots(), spec.contractSize(), rate, margin, spec.maintenanceMarginRate(), spec.digits());
      p.takeProfit = c.tp();
      p.stopLoss = c.sl();
      mapper.insertPosition(p);
      mapper.markFilled(o.id, price, p.id);
      post(userId, Bucket.BALANCE, fee.negate(), LedgerEntryType.TRADE_FEE, o.id, "开仓手续费 " + spec.code());
      return new PlaceOrder.Result("filled", String.valueOf(o.id), price.setScale(spec.digits()).toPlainString());
    });
  }

  /** 撤销挂单，释放冻结金额。 */
  void cancel(long userId, long orderId) {
    tx.executeWithoutResult(st -> {
      ledger.lock(userId);
      OrderRow o = mapper.lockPending(userId, orderId);
      if (o == null) throw new BizException("NOT_FOUND", "挂单不存在或已成交、已撤销");
      mapper.markCancelled(o.id);
      post(userId, Bucket.ORDER_FROZEN, o.frozenAmount.negate(), LedgerEntryType.ORDER_UNFREEZE, o.id, "撤单解冻 " + o.symbol);
    });
  }

  /** 可用 = 余额 + 浮动盈亏 − 已用保证金 − 挂单冻结。浮动盈亏用最新报价和当前汇率；没有报价的持仓按 0 计。 */
  BigDecimal available(AccountSnapshot acc, List<PositionRow> positions) {
    BigDecimal v = acc.balance().subtract(acc.orderFrozen());
    for (PositionRow p : positions) {
      v = v.subtract(p.margin).add(floatingPnl(p).orElse(BigDecimal.ZERO));
    }
    return v;
  }

  Optional<BigDecimal> floatingPnl(PositionRow p) {
    Side side = Side.valueOf(p.side);
    Optional<MarketQuote> q = market.quote(p.symbol);
    Optional<BigDecimal> rate = market.toUsdRate(p.quoteCcy);
    if (q.isEmpty() || rate.isEmpty()) return Optional.empty();
    return Optional.of(OrderCalc.pnl(side, p.openPrice, side.closePrice(q.get()), p.lots, p.contractSize, rate.get()));
  }

  List<PositionRow> positions(long userId) {
    return mapper.openPositions(userId);
  }

  List<OrderRow> pendingOrders(long userId) {
    return mapper.pendingOrders(userId);
  }

  private void post(long userId, Bucket bucket, BigDecimal amount, LedgerEntryType type, long orderId, String remark) {
    if (amount.signum() == 0) return;
    try {
      ledger.apply(new LedgerCommand(userId, bucket, amount, type, BIZ_ORDER, String.valueOf(orderId), remark));
    } catch (BizException e) {
      // 可用余额够但现金余额付不起手续费（浮动盈利还没有实现）时会走到这里
      if ("INSUFFICIENT_FUNDS".equals(e.code())) throw reject("INSUFFICIENT_BALANCE", "余额不足");
      throw e;
    }
  }

  private PlaceOrder.Result resultOf(OrderRow o) {
    if ("MARKET".equals(o.orderType)) {
      int digits = market.symbol(o.symbol).map(SymbolSpec::digits).orElse(8);
      return new PlaceOrder.Result("filled", String.valueOf(o.id), o.fillPrice == null ? null : o.fillPrice.setScale(digits, java.math.RoundingMode.HALF_UP).toPlainString());
    }
    return new PlaceOrder.Result("pending", String.valueOf(o.id), null);
  }

  private static BizException reject(String code, String message) {
    return new BizException(code, message);
  }

  private Checked validate(PlaceOrder r) {
    ValidationException.Collector errs = new ValidationException.Collector();
    if (r.clientOrderId() == null || r.clientOrderId().isBlank()) errs.add("clientOrderId", "required");
    else if (r.clientOrderId().length() > 64) errs.add("clientOrderId", "tooLong");

    SymbolSpec spec = r.symbol() == null ? null : market.symbol(r.symbol()).orElse(null);
    if (spec == null) errs.add("symbol", "notFound");

    boolean limit = "limit".equals(r.type());
    if (!limit && !"market".equals(r.type())) errs.add("type", "invalid");
    Side side = "buy".equals(r.side()) ? Side.BUY : "sell".equals(r.side()) ? Side.SELL : null;
    if (side == null) errs.add("side", "invalid");

    BigDecimal lots = decimal(errs, "lots", r.lots(), true);
    if (lots != null && spec != null) {
      if (lots.compareTo(spec.minLots()) < 0) errs.add("lots", "lotsMin");
      if (lots.compareTo(spec.maxLots()) > 0) errs.add("lots", "lotsMax");
      if (lots.remainder(spec.lotStep()).signum() != 0) errs.add("lots", "lotsStep");
    }

    // 超过品种上限不在这里报，按拒单原因 LEVERAGE_EXCEEDED 返回（AC-12）
    if (r.leverage() == null) errs.add("leverage", "required");
    else if (r.leverage() < 1) errs.add("leverage", "leverageInteger");

    BigDecimal limitPrice = null;
    if (limit) {
      limitPrice = decimal(errs, "limitPrice", r.limitPrice(), true);
      if (limitPrice != null && spec != null && limitPrice.scale() > spec.digits()) errs.add("limitPrice", "priceDigits");
    }
    BigDecimal tp = decimal(errs, "takeProfit", r.takeProfit(), false);
    BigDecimal sl = decimal(errs, "stopLoss", r.stopLoss(), false);
    if (spec != null) {
      if (tp != null && tp.scale() > spec.digits()) errs.add("takeProfit", "priceDigits");
      if (sl != null && sl.scale() > spec.digits()) errs.add("stopLoss", "priceDigits");
    }
    errs.throwIfAny();
    return new Checked(spec, limit, side, lots, r.leverage(), limitPrice, tp, sl);
  }

  /** 止盈止损方向：多单 止盈 &gt; 基准 &gt; 止损，空单相反；基准是市价单的成交价或限价单的限价 */
  private static void checkTpSl(Checked c, BigDecimal base) {
    ValidationException.Collector errs = new ValidationException.Collector();
    boolean buy = c.side() == Side.BUY;
    if (c.tp() != null && (buy ? c.tp().compareTo(base) <= 0 : c.tp().compareTo(base) >= 0)) errs.add("takeProfit", buy ? "tpBuy" : "tpSell");
    if (c.sl() != null && (buy ? c.sl().compareTo(base) >= 0 : c.sl().compareTo(base) <= 0)) errs.add("stopLoss", buy ? "slBuy" : "slSell");
    errs.throwIfAny();
  }

  /** 正数，最多 8 位小数。required=false 时空值返回 null */
  private static BigDecimal decimal(ValidationException.Collector errs, String field, String raw, boolean required) {
    if (raw == null || raw.isBlank()) {
      if (required) errs.add(field, "required");
      return null;
    }
    String s = raw.trim();
    if (!DECIMAL.matcher(s).matches()) {
      errs.add(field, "positiveNumber");
      return null;
    }
    BigDecimal v = new BigDecimal(s);
    if (v.signum() <= 0) {
      errs.add(field, "positiveNumber");
      return null;
    }
    return v;
  }
}
