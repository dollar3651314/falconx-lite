package com.falconx.lite.notification.api;

import java.util.Map;

/**
 * 发邮件。调用方只给收件人、模板和参数；模板内容、语言、发送重试由通知模块负责。
 * 可以在业务事务里调用：邮件写成任务，业务提交后才会发出（S15 接真实的邮件服务商）。
 */
public interface MailApi {

  /** 模板名，例如 {@code EMAIL_CODE}（参数 code、purpose） */
  void send(String to, String template, Map<String, String> params);
}
