package com.falconx.lite.market.quote.feed;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

/**
 * 测试用的本地 WebSocket 服务器（只在 127.0.0.1，JDK 的 ServerSocket 自己实现握手和帧，不加依赖）：模拟 AllTick、iTick 的服务器，
 * 记下每条连接的请求路径、参数、请求头和收到的消息，可以主动推消息、拒绝握手（返回 HTTP 状态码）、突然断开。
 * 只实现测试用到的部分：文本帧、关闭帧、ping；客户端发来的帧都带掩码（RFC 6455）。
 */
final class FakeWsServer implements AutoCloseable {

  /** 一条连接 */
  static final class Conn {
    final String path;
    final String query;
    final Map<String, String> headers;
    final BlockingQueue<String> received = new LinkedBlockingQueue<>();
    private final Socket socket;
    private final OutputStream out;
    volatile boolean closed;

    Conn(Socket socket, String path, String query, Map<String, String> headers) throws IOException {
      this.socket = socket;
      this.path = path;
      this.query = query;
      this.headers = headers;
      this.out = socket.getOutputStream();
    }

    /** 推一条文本消息 */
    synchronized void send(String text) {
      try {
        frame(1, text.getBytes(StandardCharsets.UTF_8));
      } catch (IOException e) {
        closed = true;
      }
    }

    private synchronized void frame(int opcode, byte[] payload) throws IOException {
      ByteArrayOutputStream b = new ByteArrayOutputStream();
      b.write(0x80 | opcode);
      if (payload.length < 126) {
        b.write(payload.length);
      } else if (payload.length < 65536) {
        b.write(126);
        b.write(payload.length >> 8);
        b.write(payload.length & 0xff);
      } else {
        b.write(127);
        for (int i = 7; i >= 0; i--) b.write((int) (((long) payload.length >> (8 * i)) & 0xff));
      }
      b.write(payload);
      out.write(b.toByteArray());
      out.flush();
    }

    /** 等下一条客户端发来的消息 */
    String next(Duration timeout) throws InterruptedException {
      return received.poll(timeout.toMillis(), TimeUnit.MILLISECONDS);
    }

    /** 等下一条包含 needle 的消息（跳过其他消息，例如心跳） */
    String nextContaining(String needle, Duration timeout) throws InterruptedException {
      long end = System.nanoTime() + timeout.toNanos();
      while (System.nanoTime() < end) {
        String m = received.poll(Math.max(1, (end - System.nanoTime()) / 1_000_000), TimeUnit.MILLISECONDS);
        if (m != null && m.contains(needle)) return m;
      }
      return null;
    }

    /** 突然断开（不发关闭帧，模拟网络中断） */
    void kill() {
      closed = true;
      try {
        socket.close();
      } catch (IOException e) {
        // 忽略
      }
    }
  }

  private final ServerSocket server;
  private final List<Conn> conns = new CopyOnWriteArrayList<>();
  private final List<Socket> sockets = new CopyOnWriteArrayList<>();
  /** 非 0 时拒绝握手，返回这个 HTTP 状态码 */
  volatile int rejectStatus;
  /** 连接建立后（101 已发出）调用 */
  volatile Consumer<Conn> onConnect = c -> {};
  /** 收到客户端消息时调用（在读线程上） */
  volatile BiConsumer<Conn, String> onMessage = (c, m) -> {};
  /** 握手次数（含被拒绝的） */
  volatile int handshakes;

  FakeWsServer() throws IOException {
    server = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
    Thread t = new Thread(this::acceptLoop, "fake-ws-accept");
    t.setDaemon(true);
    t.start();
  }

  String url(String path) {
    return "ws://127.0.0.1:" + server.getLocalPort() + path;
  }

  String baseUrl() {
    return "ws://127.0.0.1:" + server.getLocalPort();
  }

  List<Conn> connections() {
    return new ArrayList<>(conns);
  }

  /** 等第 n 条（从 1 数）连接建立 */
  Conn awaitConnection(int n, Duration timeout) throws InterruptedException {
    long end = System.nanoTime() + timeout.toNanos();
    while (System.nanoTime() < end) {
      if (conns.size() >= n) return conns.get(n - 1);
      Thread.sleep(10);
    }
    throw new AssertionError("等了 " + timeout + " 也没有第 " + n + " 条连接（现在 " + conns.size() + " 条，握手 " + handshakes + " 次）");
  }

  /** 等到某个路径的连接数达到 n，返回最后一条 */
  Conn awaitConnection(String path, int n, Duration timeout) throws InterruptedException {
    long end = System.nanoTime() + timeout.toNanos();
    while (System.nanoTime() < end) {
      List<Conn> l = conns.stream().filter(c -> c.path.equals(path)).toList();
      if (l.size() >= n) return l.get(n - 1);
      Thread.sleep(10);
    }
    throw new AssertionError("等了 " + timeout + " 也没有 " + path + " 的第 " + n + " 条连接");
  }

  private void acceptLoop() {
    while (!server.isClosed()) {
      try {
        Socket s = server.accept();
        sockets.add(s);
        Thread t = new Thread(() -> handle(s), "fake-ws-conn");
        t.setDaemon(true);
        t.start();
      } catch (IOException e) {
        return;
      }
    }
  }

  private void handle(Socket s) {
    Conn conn = null;
    try {
      InputStream in = s.getInputStream();
      String requestLine = line(in);
      Map<String, String> headers = new HashMap<>();
      for (String l = line(in); !l.isEmpty(); l = line(in)) {
        int i = l.indexOf(':');
        if (i > 0) headers.put(l.substring(0, i).strip().toLowerCase(Locale.ROOT), l.substring(i + 1).strip());
      }
      handshakes++;
      String target = requestLine.split(" ")[1];
      String path = target.contains("?") ? target.substring(0, target.indexOf('?')) : target;
      String query = target.contains("?") ? target.substring(target.indexOf('?') + 1) : "";
      OutputStream out = s.getOutputStream();
      if (rejectStatus != 0) {
        out.write(("HTTP/1.1 " + rejectStatus + " Rejected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        out.flush();
        s.close();
        return;
      }
      String accept = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1")
          .digest((headers.get("sec-websocket-key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)));
      out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n")
          .getBytes(StandardCharsets.US_ASCII));
      out.flush();
      Conn c = new Conn(s, path, query, headers);
      conn = c;
      conns.add(c);
      onConnect.accept(c);
      readFrames(c, new DataInputStream(in));
    } catch (Exception e) {
      // 连接断开
    } finally {
      if (conn != null) conn.closed = true;
      try {
        s.close();
      } catch (IOException e) {
        // 忽略
      }
    }
  }

  private void readFrames(Conn c, DataInputStream in) throws IOException {
    ByteArrayOutputStream text = new ByteArrayOutputStream();
    while (!c.closed) {
      int b0 = in.readUnsignedByte();
      int b1 = in.readUnsignedByte();
      boolean fin = (b0 & 0x80) != 0;
      int opcode = b0 & 0x0f;
      long len = b1 & 0x7f;
      if (len == 126) len = in.readUnsignedShort();
      else if (len == 127) len = in.readLong();
      byte[] mask = new byte[4];
      if ((b1 & 0x80) != 0) in.readFully(mask);
      byte[] payload = new byte[(int) len];
      in.readFully(payload);
      for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      switch (opcode) {
        case 0, 1 -> {
          text.write(payload);
          if (fin) {
            String m = text.toString(StandardCharsets.UTF_8);
            text.reset();
            c.received.add(m);
            onMessage.accept(c, m);
          }
        }
        case 8 -> {
          c.frame(8, payload);
          c.kill();
          return;
        }
        case 9 -> c.frame(10, payload);
        default -> {
          // pong 等忽略
        }
      }
    }
  }

  private static String line(InputStream in) throws IOException {
    ByteArrayOutputStream b = new ByteArrayOutputStream();
    int prev = -1;
    for (int ch = in.read(); ch != -1; ch = in.read()) {
      if (prev == '\r' && ch == '\n') {
        byte[] a = b.toByteArray();
        return new String(a, 0, a.length - 1, StandardCharsets.US_ASCII);
      }
      b.write(ch);
      prev = ch;
    }
    throw new IOException("连接关闭");
  }

  /** 断开所有连接 */
  void killAll() {
    for (Conn c : conns) c.kill();
  }

  @Override
  public void close() throws IOException {
    server.close();
    for (Socket s : sockets) s.close();
  }
}
