package com.falconx.lite.risk.switches;

import com.falconx.lite.notification.api.MailApi;
import com.falconx.lite.risk.api.RiskApi;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 风控唯一一条自动规则（需求 4.5-3，AC-22）：每 5 秒算一次敞口，
 * 品种净敞口绝对值超过阈值 → 该品种自动禁开；平台总净敞口超过阈值 → 全部自动禁开。
 * 只在第一次触发时记事件、通知风控人员；恢复由风控人员手动操作（{@link RiskApi#resumeSymbol}、{@link RiskApi#resumeGlobal}）。
 */
@Component
class ExposureMonitor {

  private static final Logger log = LoggerFactory.getLogger(ExposureMonitor.class);

  private final RiskApi risk;
  private final RiskSwitchMapper mapper;
  private final MailApi mail;
  private final RiskProperties props;

  ExposureMonitor(RiskApi risk, RiskSwitchMapper mapper, MailApi mail, RiskProperties props) {
    this.risk = risk;
    this.mapper = mapper;
    this.mail = mail;
    this.props = props;
  }

  @Scheduled(fixedDelay = 5_000, initialDelay = 10_000)
  void tick() {
    if (!props.monitorEnabled()) return;
    try {
      check();
    } catch (RuntimeException e) {
      log.error("净敞口检查失败", e);
    }
  }

  /** 检查一次，返回这次新触发的自动禁开数量 */
  @Transactional
  int check() {
    RiskApi.Dashboard d = risk.dashboard();
    int n = 0;
    for (RiskApi.SymbolExposure s : d.symbols()) {
      if (s.threshold() == null || s.netUsd().abs().compareTo(s.threshold()) <= 0) continue;
      if (mapper.autoPauseSymbol(s.symbol()) == 1) {
        mapper.insertEvent("AUTO_PAUSE_SYMBOL", s.symbol(), s.netUsd(), s.threshold(), null);
        alert("品种净敞口超过阈值，已自动禁止新开仓", s.symbol(), s.netUsd().toPlainString(), s.threshold().toPlainString());
        n++;
      }
    }
    if (d.platformThreshold() != null && d.platformNetUsd().compareTo(d.platformThreshold()) > 0 && mapper.autoPauseGlobal() == 1) {
      mapper.insertEvent("AUTO_PAUSE_GLOBAL", null, d.platformNetUsd(), d.platformThreshold(), null);
      alert("平台总净敞口超过阈值，已自动禁止全部新开仓", "*", d.platformNetUsd().toPlainString(), d.platformThreshold().toPlainString());
      n++;
    }
    return n;
  }

  private void alert(String title, String symbol, String net, String threshold) {
    log.warn("风控自动禁开：{} symbol={} net={} threshold={}", title, symbol, net, threshold);
    var to = props.alertEmails().stream().filter(e -> e != null && !e.isBlank()).toList();
    if (to.isEmpty()) {
      log.warn("没有配置风控人员邮箱（falconx.risk.alert-emails），只记了日志和风控事件");
      return;
    }
    for (String email : to) {
      mail.send(email, "RISK_AUTO_PAUSE", Map.of("title", title, "symbol", symbol, "netUsd", net, "threshold", threshold));
    }
  }
}
