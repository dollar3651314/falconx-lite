package com.falconx.lite.notification.mail;

import com.falconx.lite.common.task.TaskService;
import com.falconx.lite.notification.api.MailApi;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * 把邮件写成 {@code MAIL_SEND} 任务。S15 加上任务执行器，调用邮件服务商发出；在那之前邮件不会真正发出。
 * 日志里不打印参数（验证码等），只记录收件人和模板。
 */
@Service
class TaskMailSender implements MailApi {

  static final String TASK_TYPE = "MAIL_SEND";

  private final TaskService tasks;
  private final ObjectMapper json;

  TaskMailSender(TaskService tasks, ObjectMapper json) {
    this.tasks = tasks;
    this.json = json;
  }

  @Override
  public void send(String to, String template, Map<String, String> params) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("to", to);
    payload.put("template", template);
    payload.put("params", params);
    tasks.enqueue(TASK_TYPE, json.writeValueAsString(payload), 0, 5);
  }
}
