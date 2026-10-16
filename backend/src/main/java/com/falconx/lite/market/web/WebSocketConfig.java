package com.falconx.lite.market.web;

import com.falconx.lite.common.trace.TraceWebSocket;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/** 注册行情 WebSocket。只接受同源连接（客户端和接口在同一个域名下，由 Nginx 转发）。连接上的处理带握手请求的追踪号（E9）。 */
@Configuration
@EnableWebSocket
class WebSocketConfig implements WebSocketConfigurer {

  private final MarketPush push;

  WebSocketConfig(MarketPush push) {
    this.push = push;
  }

  @Override
  public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
    registry.addHandler(TraceWebSocket.wrap(push), "/api/ws/market").addInterceptors(TraceWebSocket.handshake());
  }
}
