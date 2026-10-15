package com.falconx.lite.notification.service;

import com.falconx.lite.account.api.AccountApi;
import com.falconx.lite.common.task.Task;
import com.falconx.lite.common.task.TaskService;
import com.falconx.lite.common.task.TaskStatus;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * 发送邮件任务（{@code MAIL_SEND}）。失败按任务表的规则退避重试，最多 5 次，仍失败把通知记录标为失败。
 * 发给客户的邮件在发送时才查邮箱（客户改了邮箱也发到新邮箱）。日志不打印邮件内容（可能有验证码）。
 */
@Component
class NotifyWorker {

  private static final Logger log = LoggerFactory.getLogger(NotifyWorker.class);
  private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};
  private static final TypeReference<Map<String, String>> PARAMS = new TypeReference<>() {};

  private final TaskService tasks;
  private final NotifyMapper mapper;
  private final MailTransport transport;
  private final AccountApi accounts;
  private final ObjectMapper json;

  NotifyWorker(TaskService tasks, NotifyMapper mapper, MailTransport transport, AccountApi accounts, ObjectMapper json) {
    this.tasks = tasks;
    this.mapper = mapper;
    this.transport = transport;
    this.accounts = accounts;
    this.json = json;
  }

  /** 把到期的邮件任务全部发完，返回处理的数量 */
  int drain() {
    int n = 0;
    while (true) {
      var batch = tasks.claim(NotifyService.MAIL_TASK, "notify", 20);
      if (batch.isEmpty()) return n;
      for (Task t : batch) {
        handle(t);
        n++;
      }
    }
  }

  void handle(Task t) {
    Long recordId = null;
    try {
      Map<String, Object> p = json.readValue(t.payload(), MAP);
      recordId = p.get("recordId") instanceof Number num ? num.longValue() : null;
      String to = p.get("to") instanceof String s ? s : null;
      if (to == null && p.get("userId") instanceof Number uid) to = accounts.email(uid.longValue());
      if (to == null) throw new IllegalStateException("没有收件人");
      Render.Text text;
      if (p.get("template") instanceof String code) {
        Rows.TemplateRow tpl = mapper.template(code);
        if (tpl == null) throw new IllegalStateException("模板不存在：" + code);
        Map<String, String> params = json.convertValue(p.getOrDefault("params", Map.of()), PARAMS);
        text = p.get("lang") instanceof String lang ? Render.render(tpl, params, lang) : Render.bilingual(tpl, params);
      } else {
        text = new Render.Text(String.valueOf(p.get("subject")), String.valueOf(p.get("body")));
      }
      transport.send(to, text.title(), text.body());
      tasks.succeed(t.id());
      if (recordId != null) mapper.updateRecord(recordId, "SENT", null);
    } catch (MailTransport.NotConfigured e) {
      log.warn("邮件未配置，未发送 task={}", t.id());
      tasks.succeed(t.id());
      if (recordId != null) mapper.updateRecord(recordId, "FAILED", e.getMessage());
    } catch (Exception e) {
      String msg = e.getClass().getSimpleName() + ": " + e.getMessage();
      log.warn("邮件发送失败 task={} 第 {} 次：{}", t.id(), t.attempts(), msg);
      tasks.fail(t.id(), msg);
      if (recordId != null) {
        Task after = tasks.find(t.id());
        boolean dead = after != null && after.status() == TaskStatus.FAILED;
        mapper.updateRecord(recordId, dead ? "FAILED" : "PENDING", msg.length() > 500 ? msg.substring(0, 500) : msg);
      }
    }
  }
}
