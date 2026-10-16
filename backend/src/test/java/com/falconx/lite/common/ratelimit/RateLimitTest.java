package com.falconx.lite.common.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.falconx.lite.notification.api.MailApi;
import jakarta.servlet.http.Cookie;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * 通用限流（功能取舍对照表 P-05，安全审查 SEC-15）：真实的 MySQL 和 Redis（实际执行），上限设得很小来测。
 * 计数 key 带这个测试类独有的随机前缀，测试后只删自己的 key（Redis 和其他测试、其他人共用，不能 FLUSHALL）。
 * 每个请求默认用一个没用过的 IP，只有要测"同一个 IP"时才固定 IP，避免按 IP 的上限干扰按客户、按后台登录的测试。
 */
@SpringBootTest(properties = {
    "falconx.rate-limit.ip-per-minute=5",
    "falconx.rate-limit.ws-handshake-per-minute=3",
    "falconx.rate-limit.user-write-per-minute=3",
    "falconx.rate-limit.admin-login-per-ip=3"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RateLimitTest {

  static final String PREFIX = "fx:rl-test-" + UUID.randomUUID() + ":";
  private static final AtomicLong N = new AtomicLong(System.nanoTime() & 0xffffff);

  @DynamicPropertySource
  static void prefix(DynamicPropertyRegistry r) {
    r.add("falconx.rate-limit.key-prefix", () -> PREFIX);
  }

  @Autowired MockMvc mvc;
  @Autowired StringRedisTemplate redis;
  @MockitoBean MailApi mail;
  @Autowired @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping mappings;

  @AfterEach
  void cleanOwnKeys() {
    Set<String> keys = redis.keys(PREFIX + "*");
    if (keys != null && !keys.isEmpty()) redis.delete(keys);
  }

  /** 没用过的 IP（10.x 内网段） */
  static String ip() {
    long n = N.incrementAndGet();
    return "10." + (n >> 16 & 255) + "." + (n >> 8 & 255) + "." + (n & 255);
  }

  MockHttpServletResponse call(MockHttpServletRequestBuilder b, String ip, Cookie c, String body) throws Exception {
    b = b.with(r -> {
      r.setRemoteAddr(ip);
      return r;
    });
    if (c != null) b = b.cookie(c);
    if (body != null) b = b.contentType(MediaType.APPLICATION_JSON).content(body);
    return mvc.perform(b).andReturn().getResponse();
  }

  @SuppressWarnings("unchecked")
  Cookie register() throws Exception {
    String email = "rl" + System.nanoTime() + "@example.com";
    call(post("/api/auth/email-code"), ip(), null, "{\"email\":\"" + email + "\",\"purpose\":\"REGISTER\"}");
    ArgumentCaptor<Map<String, String>> p = ArgumentCaptor.forClass(Map.class);
    verify(mail, atLeastOnce()).send(eq(email), eq("EMAIL_CODE"), p.capture());
    MockHttpServletResponse r = call(post("/api/auth/register"), ip(), null, "{\"email\":\"" + email + "\",\"code\":\"" + p.getValue().get("code")
        + "\",\"password\":\"password123\",\"firstName\":\"A\",\"lastName\":\"B\",\"birthDate\":\"1990-05-01\",\"nationality\":\"CN\"}");
    assertThat(r.getStatus()).as(r.getContentAsString()).isEqualTo(200);
    return r.getCookie("fx_session");
  }

  static void assertLimited(MockHttpServletResponse r) throws Exception {
    assertThat(r.getStatus()).as(r.getContentAsString()).isEqualTo(429);
    assertThat(r.getContentAsString()).contains("\"code\":\"RATE_LIMITED\"").contains("\"cooldownSeconds\":");
    assertThat(Integer.parseInt(r.getHeader("Retry-After"))).isBetween(1, 900);
  }

  @Test
  void 同一IP每分钟超过上限的接口请求返回429_健康检查不算_别的IP和WebSocket握手不受影响() throws Exception {
    String ip = ip();
    // 上限 5：前 5 次照常处理（没登录是 401，说明进到了后面的检查），读写都算
    for (int i = 0; i < 4; i++) assertThat(call(get("/api/me/session"), ip, null, null).getStatus()).isEqualTo(401);
    assertThat(call(post("/api/auth/logout"), ip, null, null).getStatus()).isNotEqualTo(429);
    // 第 6 次：429 RATE_LIMITED，带还要等多少秒
    MockHttpServletResponse r = call(get("/api/me/session"), ip, null, null);
    assertLimited(r);
    assertThat(Integer.parseInt(r.getHeader("Retry-After"))).isBetween(1, 60);
    // 健康检查不限（部署脚本、外部探测每分钟都在调）
    assertThat(call(get("/api/health"), ip, null, null).getStatus()).isNotEqualTo(429);
    // WebSocket 握手单独计数
    assertThat(call(get("/api/ws/market"), ip, null, null).getStatus()).isNotEqualTo(429);
    // 别的 IP 不受影响；客户端自己带的 X-Forwarded-For 不起作用（真实 IP 来自 Nginx，后端用 getRemoteAddr）
    assertThat(call(get("/api/me/session"), ip(), null, null).getStatus()).isEqualTo(401);
    assertLimited(call(get("/api/me/session").header("X-Forwarded-For", ip()), ip, null, null));
  }

  @Test
  void 同一IP的WebSocket握手每分钟超过上限返回429_普通接口单独计数() throws Exception {
    String ip = ip();
    for (int i = 0; i < 3; i++) assertThat(call(get("/api/ws/market"), ip, null, null).getStatus()).isNotEqualTo(429);
    assertLimited(call(get("/api/ws/trading"), ip, null, null));
    assertLimited(call(get("/api/ws/market"), ip, null, null));
    // 同一个 IP 的普通接口照常
    assertThat(call(get("/api/me/session"), ip, null, null).getStatus()).isEqualTo(401);
  }

  @Test
  void 同一客户每分钟的交易和资金写操作超过上限返回429_读接口和别的客户不受影响() throws Exception {
    Cookie a = register();
    Cookie b = register();
    // 上限 3：撤单、删白名单、平仓都算同一个额度（不存在的 ID 返回 404，说明进到了接口）
    assertThat(call(delete("/api/trading/orders/999999999"), ip(), a, null).getStatus()).isEqualTo(404);
    assertThat(call(delete("/api/wallet/whitelist/999999999"), ip(), a, null).getStatus()).isEqualTo(404);
    assertThat(call(post("/api/trading/positions/999999999/close"), ip(), a, null).getStatus()).isEqualTo(404);
    // 第 4 次：换了 IP 也一样（按客户计数）
    assertLimited(call(post("/api/trading/orders"), ip(), a,
        "{\"symbol\":\"XAUUSD\",\"type\":\"market\",\"side\":\"buy\",\"lots\":\"0.01\",\"leverage\":100,\"clientOrderId\":\"rl-" + System.nanoTime() + "\"}"));
    assertLimited(call(post("/api/wallet/withdrawals"), ip(), a, "{}"));
    // 读接口不算
    assertThat(call(get("/api/trading/account"), ip(), a, null).getStatus()).isEqualTo(200);
    // 别的客户不受影响
    assertThat(call(delete("/api/trading/orders/999999999"), ip(), b, null).getStatus()).isEqualTo(404);
  }

  @Test
  void SEC15_后台登录按IP限次_换账号也算_别的IP不受影响() throws Exception {
    String ip = ip();
    for (int i = 0; i < 3; i++) {
      MockHttpServletResponse r = call(post("/api/admin/auth/login"), ip, null, "{\"username\":\"nobody" + i + System.nanoTime() + "\",\"password\":\"x\"}");
      assertThat(r.getContentAsString()).contains("INVALID_CREDENTIALS");
    }
    // 第 4 次：换一个用户名也拒绝（原来只按账号锁定，换账号可以一直试）
    assertLimited(call(post("/api/admin/auth/login"), ip, null, "{\"username\":\"another" + System.nanoTime() + "\",\"password\":\"x\"}"));
    // 别的 IP 照常
    assertThat(call(post("/api/admin/auth/login"), ip(), null, "{\"username\":\"nobody\",\"password\":\"x\"}").getContentAsString()).contains("INVALID_CREDENTIALS");
  }

  @Test
  void 按客户限流的接口正好是交易和资金写操作() {
    Set<String> limited = new TreeSet<>();
    mappings.getHandlerMethods().forEach((info, m) -> {
      if (m.hasMethodAnnotation(UserWriteLimited.class)) limited.add(info.getMethodsCondition().getMethods() + " " + info.getPathPatternsCondition().getPatternValues());
    });
    assertThat(limited).containsExactlyInAnyOrder(
        "[POST] [/api/trading/orders]",
        "[PUT] [/api/trading/orders/{id}]",
        "[DELETE] [/api/trading/orders/{id}]",
        "[POST] [/api/trading/positions/{id}/close]",
        "[PUT] [/api/trading/positions/{id}/tpsl]",
        "[POST] [/api/trading/positions/{id}/margin]",
        "[POST] [/api/wallet/withdrawals]",
        "[POST] [/api/wallet/whitelist]",
        "[DELETE] [/api/wallet/whitelist/{id}]");
  }
}
