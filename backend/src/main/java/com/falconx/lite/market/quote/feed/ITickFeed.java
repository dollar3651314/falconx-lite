package com.falconx.lite.market.quote.feed;

import io.micrometer.core.instrument.MeterRegistry;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.WebSocket;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * iTick（技术方案/v2-报价源接入.md 第 1.2 节，出处 https://docs.itick.org/en/websocket/forex 等）：
 * <ul>
 *   <li>按品类各一条连接：{@code /forex}、{@code /indices}、{@code /crypto}、{@code /stock}；token 放在握手请求头 {@code token} 里；</li>
 *   <li>服务器回 {@code {"resAc":"auth","code":1}} 后订阅 {@code {"ac":"subscribe","params":"EURUSD$GB,…","types":"depth"}}；
 *       5 秒内没收到鉴权回应也照样订阅一次（文档没写清楚鉴权消息一定会来）；</li>
 *   <li>心跳 {@code {"ac":"ping","params":"<毫秒>"}}，每 20 秒（文档要求至少 30 秒一次）；</li>
 *   <li>推送 depth：{@code data.s}、{@code data.r}（代码 = s$r）、{@code b[0].p}、{@code a[0].p}；depth 没有时间字段，用收到的时间。</li>
 * </ul>
 * quote、tick 只有最新价，不订阅、收到也忽略。
 */
public class ITickFeed extends WsFeed {

  public static final String NAME = "itick";
  static final Set<String> CHANNELS = Set.of("forex", "indices", "crypto", "stock");
  private static final Duration SUBSCRIBE_FALLBACK = Duration.ofSeconds(5);

  private static final Logger log = LoggerFactory.getLogger(ITickFeed.class);

  private final ObjectMapper json;

  public ITickFeed(QuoteFeedsProperties props, Map<String, List<String>> codesByChannel, QuoteSink sink, ObjectMapper json, MeterRegistry metrics) {
    super(NAME, props, sink, metrics, channels(props.itick(), codesByChannel));
    this.json = json;
  }

  private static List<ChannelSpec> channels(QuoteFeedsProperties.ITick p, Map<String, List<String>> codes) {
    List<ChannelSpec> out = new ArrayList<>();
    for (String ch : List.of("forex", "indices", "crypto", "stock")) {
      List<String> c = codes.getOrDefault(ch, List.of());
      if (!c.isEmpty()) out.add(new ChannelSpec(ch, URI.create(p.url() + "/" + ch), c, Duration.ZERO));
    }
    return out;
  }

  @Override
  protected String secret() {
    return props.itick().token();
  }

  @Override
  protected WebSocket.Builder handshake(WebSocket.Builder b) {
    return b.header("token", props.itick().token());
  }

  @Override
  protected Duration heartbeatInterval() {
    return props.itick().heartbeat();
  }

  @Override
  protected void opened(Conn c) {
    later(c, SUBSCRIBE_FALLBACK, () -> {
      if (!c.subscribed) subscribe(c);
    });
  }

  private void subscribe(Conn c) {
    c.subscribed = true;
    ObjectNode m = json.createObjectNode();
    m.put("ac", "subscribe");
    m.put("params", String.join(",", c.codes()));
    m.put("types", "depth");
    send(c, json.writeValueAsString(m));
  }

  @Override
  protected String heartbeat(Conn c) {
    ObjectNode m = json.createObjectNode();
    m.put("ac", "ping");
    m.put("params", String.valueOf(System.currentTimeMillis()));
    return json.writeValueAsString(m);
  }

  @Override
  protected void received(Conn c, String text) {
    JsonNode m = json.readTree(text);
    String res = m.path("resAc").asString("");
    int code = m.path("code").asInt(-1);
    switch (res) {
      case "auth" -> {
        if (code == 1) {
          markHealthy(c);
          laterSubscribe(c);
        } else {
          String err = "鉴权失败：" + m.path("msg").asString("");
          noteError(c, err);
          log.warn("报价源 itick 的 {} 连接{}", c.channel(), redact(err));
        }
      }
      case "subscribe" -> {
        if (code == 1) {
          markHealthy(c);
        } else {
          String err = "订阅被拒绝：" + m.path("msg").asString("");
          noteError(c, err);
          log.warn("报价源 itick 的 {} 连接{}", c.channel(), redact(err));
        }
      }
      case "pong" -> {
        // 心跳回应
      }
      default -> {
        JsonNode d = m.path("data");
        if ("depth".equals(d.path("type").asString(""))) depth(c, d);
      }
    }
  }

  /** 鉴权成功后在调度线程上订阅（只订一次；重连后 subscribed 会清掉） */
  private void laterSubscribe(Conn c) {
    later(c, Duration.ZERO, () -> {
      if (!c.subscribed) subscribe(c);
    });
  }

  private void depth(Conn c, JsonNode d) {
    String s = d.path("s").asString("");
    String r = d.path("r").asString("");
    BigDecimal bid = best(d.path("b"), true);
    BigDecimal ask = best(d.path("a"), false);
    if (s.isEmpty() || r.isEmpty() || bid == null || ask == null) return;
    long t = d.path("t").asLong(0);
    emit(s + "$" + r, bid, ask, t > 0 ? Instant.ofEpochMilli(t) : null);
  }

  /** 最优价：买盘取最高、卖盘取最低（不依赖档位顺序）；价格是数字，也接受字符串；没有正数价格为空 */
  static BigDecimal best(JsonNode levels, boolean highest) {
    if (!levels.isArray()) return null;
    BigDecimal out = null;
    for (JsonNode l : levels) {
      JsonNode p = l.path("p");
      BigDecimal v;
      try {
        v = p.isNumber() ? p.decimalValue() : new BigDecimal(p.asString("").strip());
      } catch (NumberFormatException e) {
        continue;
      }
      if (v.signum() <= 0) continue;
      if (out == null || (highest ? v.compareTo(out) > 0 : v.compareTo(out) < 0)) out = v;
    }
    return out;
  }
}
