package com.falconx.lite.common.web;

import com.falconx.lite.common.error.BizException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

/**
 * 当前登录的客户。登录检查由 account 模块的过滤器完成，其他模块只从这里读用户 ID，不直接接触会话。
 */
public final class CurrentUser {

  static final String ATTR = "fx.userId";

  private CurrentUser() {}

  public static void set(HttpServletRequest request, long userId) {
    request.setAttribute(ATTR, userId);
  }

  /** 当前请求的用户 ID；没有登录时抛 UNAUTHORIZED（过滤器已拦截，正常不会走到这里）。 */
  public static long id() {
    RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
    Object v = attrs == null ? null : attrs.getAttribute(ATTR, RequestAttributes.SCOPE_REQUEST);
    if (v instanceof Long id) return id;
    throw new BizException("UNAUTHORIZED", "未登录");
  }
}
