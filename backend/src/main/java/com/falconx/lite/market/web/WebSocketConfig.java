package com.falconx.lite.market.web;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/** 注册行情 WebSocket。只接受同源连接（客户端和接口在同一个域名下，由 Nginx 转发）。 */
@Configuration
@EnableWebSocket
class WebSocketConfig implements WebSocketConfigurer {

  private final MarketPush push;

  WebSocketConfig(MarketPush push) {
    this.push = push;
  }

  @Override
  public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
    registry.addHandler(push, "/api/ws/market");
  }
}
