package com.falconx.lite.risk.switches;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * 风控参数（application.yml 的 falconx.risk）。
 *
 * @param monitorEnabled 是否定时检查净敞口（测试环境默认关，测试里直接调用）
 * @param alertEmails 自动禁开时通知的风控人员邮箱（Amos 提供，H7）；站内信和推送在 S15、S16 接上后台账号后加
 */
@ConfigurationProperties("falconx.risk")
record RiskProperties(@DefaultValue("true") boolean monitorEnabled, @DefaultValue List<String> alertEmails) {}
