package com.falconx.lite.account.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 登录相关的参数（application.yml 的 falconx.auth）。默认值沿用现有系统（功能地图 A-02）：
 * 连续失败 5 次锁定 15 分钟；现有系统只按 IP 计数，这里按账号和 IP 同时计数（需求 4.1-2、AC-02）。
 */
@ConfigurationProperties(prefix = "falconx.auth")
record AuthProperties(
    int loginFailureLimit,
    int lockMinutes,
    int sessionTtlHours,
    int codeTtlMinutes,
    int codeResendSeconds,
    int codeMaxAttempts,
    String cookieName,
    boolean cookieSecure) {}
