package com.falconx.lite.risk.switches;

import com.falconx.lite.notification.api.MailApi;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** 给风控人员发通知：现在是邮件（FX_RISK_ALERT_EMAILS），没有配置时只记日志。 */
@Component
class RiskAlerts {

  private static final Logger log = LoggerFactory.getLogger(RiskAlerts.class);

  private final MailApi mail;
  private final RiskProperties props;

  RiskAlerts(MailApi mail, RiskProperties props) {
    this.mail = mail;
    this.props = props;
  }

  void send(String template, Map<String, String> params) {
    log.warn("通知风控人员 template={} params={}", template, params);
    var to = props.alertEmails().stream().filter(e -> e != null && !e.isBlank()).toList();
    if (to.isEmpty()) {
      log.warn("没有配置风控人员邮箱（falconx.risk.alert-emails），只记了日志");
      return;
    }
    for (String email : to) mail.send(email, template, params);
  }
}
