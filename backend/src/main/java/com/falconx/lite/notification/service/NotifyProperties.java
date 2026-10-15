package com.falconx.lite.notification.service;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * 通知参数（application.yml 的 falconx.notify）。
 *
 * @param workerEnabled 是否定时发送邮件任务（测试环境关，测试里直接调用 {@link NotifyWorker#drain()}）
 * @param mail SMTP 服务器（通知方案 N1）。值都由 Amos 填在服务器环境变量里；host 为空表示没有配置，邮件只写日志、不发
 */
@ConfigurationProperties("falconx.notify")
record NotifyProperties(@DefaultValue("true") boolean workerEnabled, @DefaultValue Mail mail) {

  /**
   * @param security STARTTLS（一般是 587 端口）、SSL（一般是 465 端口）或 NONE（只在测试里用）
   */
  record Mail(String host, @DefaultValue("587") int port, String username, String password, String from,
      @DefaultValue("STARTTLS") String security) {

    boolean configured() {
      return host != null && !host.isBlank() && from != null && !from.isBlank();
    }

    /** 不打印密码 */
    @Override
    public String toString() {
      return "Mail[host=" + host + ", port=" + port + ", username=" + username + ", from=" + from + ", security=" + security
          + ", password=" + (password == null || password.isEmpty() ? "(空)" : "(已设置)") + "]";
    }
  }
}
