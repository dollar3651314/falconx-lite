package com.falconx.lite.market.quote.feed;

import com.falconx.lite.support.FixedClockConfig;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.List;

/**
 * 给别的包的测试（{@code QuoteFeedsWiringTest}）用的假服务器：同一个端口同时扮演 AllTick（路径 /quote-b-ws-api、/quote-stock-b-ws-api）
 * 和 iTick（路径 /forex、/indices、/crypto、/stock），按两家文档的格式回应订阅、心跳和鉴权。
 */
public final class FakeWsServerAccess implements AutoCloseable {

  public static final String FAKE_TOKEN = FeedTestSupport.FAKE_TOKEN;
  private static final List<String> ITICK = List.of("/forex", "/indices", "/crypto", "/stock");

  private final FakeWsServer server;
  private volatile int subscribed;

  private FakeWsServerAccess(FakeWsServer server) {
    this.server = server;
    server.onConnect = c -> {
      if (ITICK.contains(c.path)) {
        c.send("{\"code\":1,\"msg\":\"Connected Successfully\"}");
        c.send("{\"code\":1,\"resAc\":\"auth\",\"msg\":\"authenticated\"}");
      }
    };
    server.onMessage = (c, m) -> {
      if (m.contains("\"cmd_id\":22002")) {
        subscribed++;
        c.send("{\"ret\":200,\"msg\":\"ok\",\"cmd_id\":22003,\"seq_id\":1,\"trace\":\"x\",\"data\":{}}");
      } else if (m.contains("\"cmd_id\":22000")) {
        c.send("{\"ret\":200,\"msg\":\"ok\",\"cmd_id\":22001,\"seq_id\":1,\"trace\":\"x\",\"data\":{}}");
      } else if (m.contains("\"ac\":\"subscribe\"")) {
        subscribed++;
        c.send("{\"code\":1,\"resAc\":\"subscribe\",\"msg\":\"subscribe Successfully\"}");
      } else if (m.contains("\"ac\":\"ping\"")) {
        c.send("{\"resAc\":\"pong\",\"data\":{\"params\":\"1\"}}");
      }
    };
  }

  public static FakeWsServerAccess start() {
    try {
      return new FakeWsServerAccess(new FakeWsServer());
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  public String url(String path) {
    return server.url(path);
  }

  public String baseUrl() {
    return server.baseUrl();
  }

  /** 收到的订阅请求数（两家合计，含重连后的） */
  public int subscribed() {
    return subscribed;
  }

  public String allTickQuery() {
    return last("/quote-b-ws-api").query;
  }

  public String iTickTokenHeader() {
    return last("/forex").headers.get("token");
  }

  /** AllTick 外汇连接推一条订单簿，时间是测试时钟的现在 */
  public void allTickDepth(String code, String bid, String ask) {
    last("/quote-b-ws-api").send("{\"cmd_id\":22999,\"data\":{\"code\":\"" + code + "\",\"seq\":1,\"tick_time\":" + FixedClockConfig.NOW.toEpochMilli()
        + ",\"bids\":[{\"price\":\"" + bid + "\",\"volume\":\"1\"}],\"asks\":[{\"price\":\"" + ask + "\",\"volume\":\"1\"}]}}");
  }

  /** iTick 外汇连接推一条 depth */
  public void iTickDepth(String s, String r, String bid, String ask) {
    last("/forex").send("{\"code\":1,\"data\":{\"s\":\"" + s + "\",\"r\":\"" + r + "\",\"a\":[{\"po\":1,\"p\":" + ask + "}],\"b\":[{\"po\":1,\"p\":" + bid
        + "}],\"type\":\"depth\"}}");
  }

  /** 之后的握手返回这个 HTTP 状态码（0 = 正常接受） */
  public void rejectStatus(int status) {
    server.rejectStatus = status;
  }

  public void killAll() {
    server.killAll();
  }

  private FakeWsServer.Conn last(String path) {
    List<FakeWsServer.Conn> l = server.connections().stream().filter(c -> c.path.equals(path) && !c.closed).toList();
    if (l.isEmpty()) throw new AssertionError("没有 " + path + " 的连接");
    return l.getLast();
  }

  @Override
  public void close() {
    try {
      server.close();
    } catch (IOException e) {
      // 忽略
    }
  }
}
