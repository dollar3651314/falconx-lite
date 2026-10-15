package com.falconx.lite.trading.order;

import com.falconx.lite.trading.api.UserEventsApi;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * 交易事件，推给这个用户的所有连接。事件名和客户端 web/client/src/api/types.ts 的 ServerEvent 一致（修复 T6）：
 * <ul>
 *   <li>{"type":"account"} / {"type":"positions"} / {"type":"orders"}：数据变了，客户端重新拉取</li>
 *   <li>{"type":"trade","kind":"fill|tp|sl|liquidation","symbol":…,"pnl":…,"price":…}：成交、止盈、止损、强平</li>
 * </ul>
 * 事务提交以后再调用，推送失败不影响交易。
 */
@Component
class TradingEvents implements UserEventsApi {

  private final TradingPush push;

  TradingEvents(TradingPush push) {
    this.push = push;
  }

  @Override
  public void send(long userId, Map<String, Object> event) {
    push.send(userId, event);
  }

  void changed(long userId, String... types) {
    for (String t : types) push.send(userId, Map.of("type", t));
  }

  void trade(long userId, String kind, String symbol, String pnl, String price) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("type", "trade");
    m.put("kind", kind);
    m.put("symbol", symbol);
    if (pnl != null) m.put("pnl", pnl);
    if (price != null) m.put("price", price);
    push.send(userId, m);
  }
}
