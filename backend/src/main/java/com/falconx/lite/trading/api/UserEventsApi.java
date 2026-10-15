package com.falconx.lite.trading.api;

import java.util.Map;

/**
 * 推给某个客户的实时事件（走 /api/ws/trading，只推给本人）。事件格式和客户端 ServerEvent 一致，
 * 例如提现状态变化 {"type":"withdraw","status":"cooling","amount":"100"}。推送失败不影响业务。
 */
public interface UserEventsApi {

  void send(long userId, Map<String, Object> event);
}
