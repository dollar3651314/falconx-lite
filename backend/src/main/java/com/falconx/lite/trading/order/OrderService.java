package com.falconx.lite.trading.order;

import com.falconx.lite.common.config.ConfigKey;
import com.falconx.lite.common.config.SystemConfig;
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
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 下单、撤单（S7）和改单（S8）。下单顺序：
 * <ol>
 *   <li>同一个 clientOrderId 已经下过单 → 直接返回第一次的结果（幂等）</li>
 *   <li>字段格式，全部错误一次返回（C56）</li>
 *   <li>能不能开仓：交易时段、品种暂停、全局暂停、报价可成交、汇率有效、杠杆上限（需求 4.3-9）</li>
 *   <li>止盈止损方向（以成交参考价或限价为基准）</li>
 *   <li>事务里锁账户行 → 持仓上限 → 可用余额 → 写订单、持仓、账本</li>
 * </ol>
 * 可用余额的口径见 {@link Funds}。
 */
@Service
@EnableConfigurationProperties(TradingProperties.class)
class OrderService {

  static final String BIZ_ORDER = "ORDER";
  static final String BIZ_ORDER_MODIFY = "ORDER_MODIFY";

  private final OrderMapper mapper;
  private final LedgerApi ledger;
  private final MarketApi market;
  private final RiskApi risk;
  private final TradingProperties props;
  private final TransactionTemplate tx;
  private final Clock clock;
  private final Funds funds;
  private final PositionService positionService;
  private final TradingEvents events;
  private final SystemConfig config;

  OrderService(OrderMapper mapper, LedgerApi ledger, MarketApi market, RiskApi risk, TradingProperties props, TransactionTemplate tx, Clock clock, Funds funds,
      PositionService positions, TradingEvents events, SystemConfig config) {
    this.mapper = mapper;
    this.ledger = ledger;
    this.market = market;
    this.risk = risk;
    this.props = props;
    this.tx = tx;
    this.clock = clock;
    this.funds = funds;
    this.positionService = positions;
    this.events = events;
    this.config = config;
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
    // 品种配置的暂停和风控的暂停（手动、净敞口自动禁开）对客户都是同一个原因，不暴露风控信息（T5）
    if (spec.openPaused() || risk.symbolOpenPaused(spec.code())) throw reject("SYMBOL_PAUSED", "品种暂停开仓");
    if (risk.globalOpenPaused()) throw reject("GLOBAL_PAUSED", "全局暂停开仓");
    MarketQuote q = market.quote(spec.code()).filter(MarketQuote::executable)
        .orElseThrow(() -> reject("QUOTE_UNAVAILABLE", "报价暂不可用"));
    BigDecimal rate = market.liveUsdRate(spec.quoteCcy()).orElseThrow(() -> reject("RATE_STALE", "汇率失效"));
    if (c.leverage() > spec.maxLeverage()) throw reject("LEVERAGE_EXCEEDED", "超过杠杆上限");

    BigDecimal price = c.limit() ? c.limitPrice() : c.side().openPrice(q);
    ValidationException.Collector dir = new ValidationException.Collector();
    Checks.tpSl(dir, c.side(), c.tp(), c.sl(), price);
    dir.throwIfAny();

    BigDecimal notional = OrderCalc.notionalUsd(price, c.lots(), spec.contractSize(), rate);
    BigDecimal margin = OrderCalc.margin(notional, c.leverage());
    BigDecimal fee = OrderCalc.fee(notional, spec.feeRate());

    PlaceOrder.Result result = tx.execute(st -> {
      AccountSnapshot acc = ledger.lock(userId);
      // 加锁后再查一次：同一个 clientOrderId 并发提交时，第二个在这里拿到第一个的结果
      OrderRow again = mapper.findByClientId(userId, req.clientOrderId());
      if (again != null) return resultOf(again);

      List<PositionRow> positions = mapper.openPositions(userId);
      List<OrderRow> pending = mapper.pendingOrders(userId);
      BigDecimal total = notional;
      for (PositionRow p : positions) total = total.add(p.notionalUsd);
      for (OrderRow o : pending) total = total.add(o.notionalUsd);
      if (total.compareTo(positionLimit()) > 0) throw reject("POSITION_LIMIT", "超过持仓上限");

      BigDecimal need = margin.add(fee);
      if (need.compareTo(funds.available(acc, positions)) > 0) throw reject("INSUFFICIENT_BALANCE", "可用余额不足");

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
      positionService.openLocked(o, spec, price, rate);
      return new PlaceOrder.Result("filled", String.valueOf(o.id), price.setScale(spec.digits()).toPlainString());
    });
    if ("filled".equals(result.kind())) {
      events.changed(userId, "positions", "account");
      events.trade(userId, "fill", spec.code(), null, result.price());
    } else {
      events.changed(userId, "orders", "account");
    }
    return result;
  }

  /** 改单请求：限价、手数、止盈止损（空表示不设）。杠杆和方向不能改。 */
  record ModifyOrder(String limitPrice, String lots, String takeProfit, String stopLoss) {}

  /**
   * 修改挂单：按新的限价和手数重算冻结金额，多退少补（AC-11）。持仓上限和可用余额的检查同下单。
   * 每次修改订单的 revision 加 1，冻结差额的账本幂等键用"订单号:revision"。
   */
  void modify(long userId, long orderId, ModifyOrder req) {
    tx.executeWithoutResult(st -> {
      AccountSnapshot acc = ledger.lock(userId);
      OrderRow o = mapper.lockPending(userId, orderId);
      if (o == null) throw new BizException("NOT_FOUND", "挂单不存在或已成交、已撤销");
      SymbolSpec spec = market.symbol(o.symbol).orElseThrow(() -> new BizException("NOT_FOUND", "品种不存在"));
      Side side = Side.valueOf(o.side);

      ValidationException.Collector errs = new ValidationException.Collector();
      BigDecimal price = Checks.decimal(errs, "limitPrice", req.limitPrice(), true);
      Checks.digits(errs, spec, "limitPrice", price);
      BigDecimal lots = Checks.decimal(errs, "lots", req.lots(), true);
      Checks.lots(errs, spec, lots);
      BigDecimal tp = Checks.decimal(errs, "takeProfit", req.takeProfit(), false);
      BigDecimal sl = Checks.decimal(errs, "stopLoss", req.stopLoss(), false);
      Checks.digits(errs, spec, "takeProfit", tp);
      Checks.digits(errs, spec, "stopLoss", sl);
      if (price != null) Checks.tpSl(errs, side, tp, sl, price);
      errs.throwIfAny();

      BigDecimal rate = market.liveUsdRate(spec.quoteCcy()).orElseThrow(() -> reject("RATE_STALE", "汇率失效"));
      BigDecimal notional = OrderCalc.notionalUsd(price, lots, spec.contractSize(), rate);
      BigDecimal frozen = OrderCalc.margin(notional, o.leverage).add(OrderCalc.fee(notional, spec.feeRate()));

      List<PositionRow> positions = mapper.openPositions(userId);
      BigDecimal total = notional;
      for (PositionRow p : positions) total = total.add(p.notionalUsd);
      for (OrderRow other : mapper.pendingOrders(userId)) if (!other.id.equals(o.id)) total = total.add(other.notionalUsd);
      if (total.compareTo(positionLimit()) > 0) throw reject("POSITION_LIMIT", "超过持仓上限");

      BigDecimal delta = frozen.subtract(o.frozenAmount);
      if (delta.signum() > 0 && delta.compareTo(funds.available(acc, positions)) > 0) throw reject("INSUFFICIENT_BALANCE", "可用余额不足");

      int revision = o.revision + 1;
      mapper.updatePending(o.id, price, lots, tp, sl, frozen, notional, revision);
      if (delta.signum() != 0) {
        LedgerEntryType type = delta.signum() > 0 ? LedgerEntryType.ORDER_FREEZE : LedgerEntryType.ORDER_UNFREEZE;
        post(userId, Bucket.ORDER_FROZEN, delta, type, BIZ_ORDER_MODIFY, o.id + ":" + revision, "改单调整冻结 " + o.symbol);
      }
    });
    events.changed(userId, "orders", "account");
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
    events.changed(userId, "orders", "account");
  }

  List<PositionRow> positions(long userId) {
    return mapper.openPositions(userId);
  }

  List<HistoryRow> history(long userId, int offset, int limit) {
    return mapper.history(userId, offset, limit);
  }

  long countHistory(long userId) {
    return mapper.countHistory(userId);
  }

  List<OrderRow> pendingOrders(long userId) {
    return mapper.pendingOrders(userId);
  }

  private void post(long userId, Bucket bucket, BigDecimal amount, LedgerEntryType type, long orderId, String remark) {
    post(userId, bucket, amount, type, BIZ_ORDER, String.valueOf(orderId), remark);
  }

  private void post(long userId, Bucket bucket, BigDecimal amount, LedgerEntryType type, String bizType, String bizId, String remark) {
    if (amount.signum() == 0) return;
    try {
      ledger.apply(new LedgerCommand(userId, bucket, amount, type, bizType, bizId, remark));
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

    BigDecimal lots = Checks.decimal(errs, "lots", r.lots(), true);
    Checks.lots(errs, spec, lots);

    // 超过品种上限不在这里报，按拒单原因 LEVERAGE_EXCEEDED 返回（AC-12）
    if (r.leverage() == null) errs.add("leverage", "required");
    else if (r.leverage() < 1) errs.add("leverage", "leverageInteger");

    BigDecimal limitPrice = null;
    if (limit) {
      limitPrice = Checks.decimal(errs, "limitPrice", r.limitPrice(), true);
      Checks.digits(errs, spec, "limitPrice", limitPrice);
    }
    BigDecimal tp = Checks.decimal(errs, "takeProfit", r.takeProfit(), false);
    BigDecimal sl = Checks.decimal(errs, "stopLoss", r.stopLoss(), false);
    Checks.digits(errs, spec, "takeProfit", tp);
    Checks.digits(errs, spec, "stopLoss", sl);
    errs.throwIfAny();
    return new Checked(spec, limit, side, lots, r.leverage(), limitPrice, tp, sl);
  }

  /** 单个客户的持仓上限：风控页改的值优先（S16c），没有时用 application.yml */
  private BigDecimal positionLimit() {
    return config.decimal(ConfigKey.RISK_PER_USER_LIMIT, props.positionLimitUsd());
  }
}
