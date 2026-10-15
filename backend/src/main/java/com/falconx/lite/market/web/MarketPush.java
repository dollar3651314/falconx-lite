package com.falconx.lite.market.web;

import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.SymbolSpec;
import com.falconx.lite.market.kline.Bar;
import com.falconx.lite.market.kline.KlineService;
import com.falconx.lite.market.quote.QuoteProcessor;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 行情推送 WebSocket（/api/ws/market，需要登录，握手时由登录检查过滤器校验 Cookie）。
 * <ul>
 *   <li>连上后先推一次全部报价，之后每 250 毫秒推一次有变化的报价：{"type":"quotes","data":[…]}</li>
 *   <li>K 线：客户端发 {"op":"subKline","symbol":"XAUUSD","tf":"15m"} 订阅（同时只订阅一个），之后推 {"type":"kline",…}</li>
 * </ul>
 */
@Component
class MarketPush extends TextWebSocketHandler {

  private static final Logger log = LoggerFactory.getLogger(MarketPush.class);

  private final QuoteProcessor processor;
  private final MarketApi market;
  private final ObjectMapper json;
  private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
  /** 会话 → 订阅的 "symbol|tf" */
  private final Map<String, String> klineSubs = new ConcurrentHashMap<>();
  private final Map<String, Bar> pendingBars = new ConcurrentHashMap<>();
  private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(r -> new Thread(r, "market-push"));

  MarketPush(QuoteProcessor processor, MarketApi market, KlineService klines, ObjectMapper json, com.falconx.lite.market.MarketProperties props) {
    this.processor = processor;
    this.market = market;
    this.json = json;
    klines.onUpdate(b -> pendingBars.put(b.symbol() + "|" + b.tf().code, b));
    long ms = props.pushInterval().toMillis();
    timer.scheduleAtFixedRate(this::flush, ms, ms, TimeUnit.MILLISECONDS);
  }

  @Override
  public void afterConnectionEstablished(WebSocketSession s) {
    WebSocketSession safe = new ConcurrentWebSocketSessionDecorator(s, 2000, 512 * 1024);
    sessions.put(s.getId(), safe);
    send(safe, Map.of("type", "quotes", "data", quotes(null)));
  }

  @Override
  protected void handleTextMessage(WebSocketSession s, TextMessage msg) {
    try {
      JsonNode n = json.readTree(msg.getPayload());
      String op = n.path("op").asString("");
      if ("subKline".equals(op)) klineSubs.put(s.getId(), n.path("symbol").asString("") + "|" + n.path("tf").asString(""));
      else if ("unsubKline".equals(op)) klineSubs.remove(s.getId());
    } catch (RuntimeException e) {
      log.debug("忽略无法解析的消息");
    }
  }

  @Override
  public void afterConnectionClosed(WebSocketSession s, CloseStatus status) {
    sessions.remove(s.getId());
    klineSubs.remove(s.getId());
  }

  private List<Views.QuoteView> quotes(Set<String> only) {
    List<Views.QuoteView> out = new ArrayList<>();
    for (var e : processor.book().all()) {
      if (only != null && !only.contains(e.quote().symbol())) continue;
      market.symbol(e.quote().symbol()).ifPresent(s -> out.add(Views.quote(e, s, market)));
    }
    return out;
  }

  void flush() {
    try {
      Set<String> changed = processor.drainChanged();
      if (!changed.isEmpty() && !sessions.isEmpty()) {
        Map<String, Object> msg = Map.of("type", "quotes", "data", quotes(changed));
        sessions.values().forEach(s -> send(s, msg));
      }
      if (!pendingBars.isEmpty()) {
        Map<String, Bar> bars = Map.copyOf(pendingBars);
        pendingBars.keySet().removeAll(bars.keySet());
        klineSubs.forEach((sid, key) -> {
          Bar b = bars.get(key);
          WebSocketSession s = sessions.get(sid);
          if (b == null || s == null) return;
          int digits = market.symbol(b.symbol()).map(SymbolSpec::digits).orElse(8);
          send(s, Map.of("type", "kline", "symbol", b.symbol(), "tf", b.tf().code, "bar", Views.kline(b, digits)));
        });
      }
    } catch (RuntimeException e) {
      log.error("行情推送失败", e);
    }
  }

  private void send(WebSocketSession s, Object payload) {
    try {
      if (s.isOpen()) s.sendMessage(new TextMessage(json.writeValueAsString(payload)));
    } catch (IOException | RuntimeException e) {
      log.debug("推送失败，连接可能已断开");
    }
  }

  @PreDestroy
  void stop() {
    timer.shutdownNow();
  }
}
