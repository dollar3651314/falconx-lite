package com.falconx.lite.trading.order;

import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.trading.api.AccountSnapshot;
import com.falconx.lite.trading.api.Bucket;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerCommand;
import com.falconx.lite.trading.api.LedgerEntryType;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 隔夜费结算（S10）。规则见 技术方案/v1-数据库设计.md 第 12 节：
 * <ul>
 *   <li>每天 UTC 22:00（沿用现有系统）结算；只在品种的交易日结算（这一天有交易时段、不是休市日）</li>
 *   <li>结算时点之前开仓、结算时点还持有的持仓才收（AC-16）</li>
 *   <li>金额 = 手数 × 合约大小 × 平仓方向最新价 × |费率| × 汇率；费率为负扣、为正返还（沿用现有系统）</li>
 *   <li>扣费从这个持仓的保证金里扣（逐仓），强平价随之重算；返还进余额</li>
 *   <li>每个持仓每个结算日一条 {@code trading_swap} 记录（唯一键防重复），账本 {@code SWAP}</li>
 * </ul>
 */
@Service
class SwapService {

  private static final Logger log = LoggerFactory.getLogger(SwapService.class);
  static final String BIZ_SWAP = "SWAP";

  private final OrderMapper mapper;
  private final LedgerApi ledger;
  private final MarketApi market;
  private final TransactionTemplate tx;
  private final Clock clock;
  private final TradingEvents events;
  private final TradingProperties.Swap props;

  SwapService(OrderMapper mapper, LedgerApi ledger, MarketApi market, TransactionTemplate tx, Clock clock, TradingEvents events, TradingProperties props) {
    this.mapper = mapper;
    this.ledger = ledger;
    this.market = market;
    this.tx = tx;
    this.clock = clock;
    this.events = events;
    this.props = props.swap();
  }

  /** 每分钟看一次有没有到期没结算的；结算时点过后 1 分钟内完成 */
  @Scheduled(fixedDelay = 60_000, initialDelay = 30_000)
  void tick() {
    if (props.enabled()) settleDue(clock.instant());
  }

  /** 结算到 now 为止到期的隔夜费（含停机期间漏掉的最近 catchUpDays 天），返回结算的持仓数 */
  int settleDue(Instant now) {
    LocalDate today = now.atZone(ZoneOffset.UTC).toLocalDate();
    int n = 0;
    for (int back = props.catchUpDays(); back >= 0; back--) {
      LocalDate day = today.minusDays(back);
      LocalDateTime at = day.atTime(props.rolloverTime());
      if (at.toInstant(ZoneOffset.UTC).isAfter(now)) continue;
      List<String> symbols = market.symbols().stream().map(SymbolSpec::code).filter(c -> market.isTradingDay(c, day)).toList();
      if (symbols.isEmpty()) continue;
      for (PositionRow p : mapper.swapDue(day, at, symbols)) {
        try {
          if (settle(p.userId, p.id, day, at)) n++;
        } catch (RuntimeException e) {
          log.error("隔夜费结算失败 position={} date={}", p.id, day, e);
        }
      }
    }
    if (n > 0) log.info("隔夜费结算完成：{} 个持仓", n);
    return n;
  }

  /** 结算一个持仓的一个结算日。已经结算过、结算时点不持有时返回 false */
  boolean settle(long userId, long positionId, LocalDate day, LocalDateTime at) {
    Boolean done = tx.execute(st -> {
      AccountSnapshot acc = ledger.lock(userId);
      PositionRow p = mapper.lockPosition(positionId);
      if (p == null || !p.openedAt.isBefore(at)) return false;
      boolean open = "OPEN".equals(p.status);
      if (!open && (p.closedAt == null || !p.closedAt.isAfter(at))) return false;
      SymbolSpec spec = market.symbol(p.symbol).orElse(null);
      if (spec == null) return false;
      Side side = Side.valueOf(p.side);
      BigDecimal rate = side == Side.BUY ? spec.swapLong() : spec.swapShort();
      BigDecimal price = market.quote(p.symbol).map(side::closePrice).orElse(p.openPrice);
      BigDecimal usdRate = market.toUsdRate(p.quoteCcy).orElse(p.openUsdRate);
      BigDecimal gross = p.lots.multiply(p.contractSize).multiply(price).multiply(rate.abs()).multiply(usdRate).setScale(OrderCalc.MONEY_SCALE, RoundingMode.HALF_UP);

      BigDecimal amount;
      if (rate.signum() == 0 || gross.signum() == 0) {
        amount = BigDecimal.ZERO;
      } else if (rate.signum() > 0) {
        amount = gross;
      } else if (open) {
        // 逐仓：从这个持仓的保证金里扣，最多扣到 0（之后由撮合引擎按新的强平价强平）
        amount = gross.min(p.margin).negate();
      } else {
        // 结算时点还持有、但现在已经平仓：从余额里扣，不动用其他持仓的保证金和挂单冻结
        BigDecimal used = mapper.openPositions(userId).stream().map(x -> x.margin).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal spare = acc.balance().subtract(acc.orderFrozen()).subtract(used).max(BigDecimal.ZERO);
        amount = gross.min(spare).negate();
      }
      if (amount.signum() != 0 && amount.abs().compareTo(gross) < 0) {
        log.warn("隔夜费不够扣，只扣了 {}（应扣 {}）position={} date={}", amount, gross, p.id, day);
      }
      if (mapper.insertSwap(p.id, userId, p.symbol, day, at, rate, price, usdRate, amount) == 0) return false;
      if (amount.signum() == 0) return true;

      ledger.apply(new LedgerCommand(userId, Bucket.BALANCE, amount, LedgerEntryType.SWAP, BIZ_SWAP, p.id + ":" + day, "隔夜费 " + p.symbol + " " + day));
      BigDecimal margin = p.margin;
      BigDecimal liq = p.liquidationPrice;
      if (open && amount.signum() < 0) {
        margin = p.margin.add(amount);
        liq = OrderCalc.liquidationPrice(side, p.openPrice, p.lots, p.contractSize, p.openUsdRate, margin, p.maintenanceMarginRate, spec.digits());
      }
      mapper.applySwap(p.id, margin, liq, amount);
      return true;
    });
    if (Boolean.TRUE.equals(done)) events.changed(userId, "positions", "account");
    return Boolean.TRUE.equals(done);
  }
}
