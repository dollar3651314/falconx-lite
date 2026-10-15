package com.falconx.lite.trading.order;

import com.falconx.lite.common.web.CurrentUser;
import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import tools.jackson.databind.ObjectMapper;

/**
 * 交易推送 WebSocket（/api/ws/trading，需要登录）。只推当前用户自己的事件，见 {@link TradingEvents}。
 * 握手时登录检查过滤器已经校验了 Cookie，这里把用户 ID 记到连接上。
 */
@Component
class TradingPush extends TextWebSocketHandler {

  private static final Logger log = LoggerFactory.getLogger(TradingPush.class);
  static final String USER = "fx.userId";

  private final ObjectMapper json;
  private final Map<Long, Set<WebSocketSession>> byUser = new ConcurrentHashMap<>();

  TradingPush(ObjectMapper json) {
    this.json = json;
  }

  @Override
  public void afterConnectionEstablished(WebSocketSession s) {
    Long uid = (Long) s.getAttributes().get(USER);
    byUser.computeIfAbsent(uid, k -> ConcurrentHashMap.newKeySet()).add(new ConcurrentWebSocketSessionDecorator(s, 2000, 256 * 1024));
  }

  @Override
  public void afterConnectionClosed(WebSocketSession s, CloseStatus status) {
    Long uid = (Long) s.getAttributes().get(USER);
    Set<WebSocketSession> set = byUser.get(uid);
    if (set != null) set.removeIf(x -> x.getId().equals(s.getId()));
  }

  void send(long userId, Object payload) {
    Set<WebSocketSession> set = byUser.get(userId);
    if (set == null || set.isEmpty()) return;
    String text = json.writeValueAsString(payload);
    for (WebSocketSession s : set) {
      try {
        if (s.isOpen()) s.sendMessage(new TextMessage(text));
      } catch (IOException | RuntimeException e) {
        log.debug("交易推送失败，连接可能已断开");
      }
    }
  }

  /** 注册 /api/ws/trading，握手时把登录用户记到连接属性里 */
  @Configuration
  static class Config implements WebSocketConfigurer {

    private final TradingPush push;

    Config(TradingPush push) {
      this.push = push;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
      registry.addHandler(push, "/api/ws/trading").addInterceptors(new HandshakeInterceptor() {
        @Override
        public boolean beforeHandshake(ServerHttpRequest req, ServerHttpResponse res, WebSocketHandler h, Map<String, Object> attrs) {
          if (!(req instanceof ServletServerHttpRequest sr)) return false;
          var uid = CurrentUser.of(sr.getServletRequest());
          uid.ifPresent(id -> attrs.put(USER, id));
          return uid.isPresent();
        }

        @Override
        public void afterHandshake(ServerHttpRequest req, ServerHttpResponse res, WebSocketHandler h, Exception e) {}
      });
    }
  }
}
