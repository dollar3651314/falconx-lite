package com.falconx.lite.trading.order;

import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.MarketQuote;
import com.falconx.lite.trading.api.AccountSnapshot;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * 浮动盈亏和可用余额。
 * <p>可用 = 余额 − 挂单冻结 − 已用保证金 + 各持仓的浮动亏损（浮动盈利不计入）。
 * 浮动盈利不能拿来开新仓或追加保证金：这样"余额 ≥ 挂单冻结 + 全部持仓保证金"始终成立，
 * 每个持仓最多亏掉自己的保证金（逐仓），平仓、强平都不会把余额扣成负数（AC-14）。
 * 原型把浮动盈利也算进可用，S8 起后端按这里的口径（数据库设计第 10 节，DF-02）。
 */
@Component
class Funds {

  private final MarketApi market;

  Funds(MarketApi market) {
    this.market = market;
  }

  /** 按当前平仓价和当前汇率算的浮动盈亏；没有报价或汇率时返回空 */
  Optional<BigDecimal> floatingPnl(PositionRow p) {
    Side side = Side.valueOf(p.side);
    Optional<MarketQuote> q = market.quote(p.symbol);
    Optional<BigDecimal> rate = market.toUsdRate(p.quoteCcy);
    if (q.isEmpty() || rate.isEmpty()) return Optional.empty();
    return Optional.of(OrderCalc.pnl(side, p.openPrice, side.closePrice(q.get()), p.lots, p.contractSize, rate.get()));
  }

  BigDecimal available(AccountSnapshot acc, List<PositionRow> positions) {
    BigDecimal v = acc.balance().subtract(acc.orderFrozen());
    for (PositionRow p : positions) {
      v = v.subtract(p.margin).add(floatingPnl(p).orElse(BigDecimal.ZERO).min(BigDecimal.ZERO));
    }
    return v;
  }
}
