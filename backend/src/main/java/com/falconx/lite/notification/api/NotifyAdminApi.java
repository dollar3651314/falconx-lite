package com.falconx.lite.notification.api;

import java.util.Set;

/** 后台使用的通知操作（页面、权限、二次确认和审计在 S16）。 */
public interface NotifyAdminApi {

  /**
   * 手动发送给单个客户（原型"手动发送"，不支持群发）。标题和正文原样发送，不按模板翻译。
   * 推送和邮件同样遵守客户的通知偏好，关闭的渠道记为已跳过。
   */
  void manual(long userId, Set<NotifyChannel> channels, String title, String body, long operatorId);
}
