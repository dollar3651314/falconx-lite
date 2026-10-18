package com.falconx.lite.trading.order;

import com.falconx.lite.trading.api.CustomerFlowApi;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** {@link CustomerFlowApi} 的实现：只读查询账本和订单（SQL 在 resources/mapper/trading/CustomerFlowMapper.xml）。 */
@Service
class CustomerFlows implements CustomerFlowApi {

  private final CustomerFlowMapper mapper;

  CustomerFlows(CustomerFlowMapper mapper) {
    this.mapper = mapper;
  }

  private static BigDecimal zero(BigDecimal v) {
    return v == null ? BigDecimal.ZERO : v;
  }

  @Override
  @Transactional(readOnly = true)
  public Deposits depositsSince(long userId, LocalDateTime since) {
    CustomerFlowMapper.DepositRow r = mapper.depositsSince(userId, since);
    return r == null ? new Deposits(BigDecimal.ZERO, null) : new Deposits(zero(r.net), r.firstAt);
  }

  @Override
  @Transactional(readOnly = true)
  public BigDecimal netDeposits(long userId) {
    return depositsSince(userId, null).net();
  }

  @Override
  @Transactional(readOnly = true)
  public BigDecimal realizedPnl(long userId, LocalDateTime since) {
    return zero(mapper.realizedPnl(userId, since));
  }

  @Override
  @Transactional(readOnly = true)
  public NetProfit netProfit(long userId) {
    CustomerFlowMapper.ProfitRow r = mapper.netProfit(userId);
    if (r == null) return new NetProfit(BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO);
    // 账本里手续费是负数、隔夜费付出是负数：取反成"客户付出的"
    return new NetProfit(zero(r.realized), zero(r.fee).negate(), zero(r.swap).negate());
  }

  @Override
  @Transactional(readOnly = true)
  public BigDecimal openedNotionalSince(long userId, LocalDateTime since) {
    return zero(mapper.openedNotionalSince(userId, since));
  }
}
