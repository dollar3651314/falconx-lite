package com.falconx.lite.account.auth;

import com.falconx.lite.common.web.CurrentUser;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 客户端接口的登录检查：/api/ 下除公开接口和后台接口（/api/admin/，S16 另有一套）外，都要求有效会话。
 * 通过后把用户 ID 放进 {@link CurrentUser}，其他模块从那里读。
 */
@Component
class SessionFilter extends OncePerRequestFilter {

  /** 不需要登录的接口 */
  static final Set<String> PUBLIC = Set.of(
      "/api/health", "/api/auth/email-code", "/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/password/reset");

  private final SessionService sessions;
  private final AuthProperties props;

  SessionFilter(SessionService sessions, AuthProperties props) {
    this.sessions = sessions;
    this.props = props;
  }

  static String token(HttpServletRequest req, String cookieName) {
    Cookie[] cookies = req.getCookies();
    if (cookies == null) return null;
    for (Cookie c : cookies) if (cookieName.equals(c.getName())) return c.getValue();
    return null;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest req) {
    String p = req.getRequestURI();
    return !p.startsWith("/api/") || p.startsWith("/api/admin/") || PUBLIC.contains(p);
  }

  @Override
  protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
    Long userId = sessions.resolve(token(req, props.cookieName()));
    if (userId == null) {
      res.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
      res.setContentType(MediaType.APPLICATION_JSON_VALUE);
      res.setCharacterEncoding(StandardCharsets.UTF_8.name());
      res.getWriter().write("{\"code\":\"UNAUTHORIZED\",\"message\":\"未登录或登录已失效\",\"fields\":[]}");
      return;
    }
    CurrentUser.set(req, userId);
    chain.doFilter(req, res);
  }
}
