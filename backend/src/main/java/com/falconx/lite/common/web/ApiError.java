package com.falconx.lite.common.web;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * 所有接口出错时的统一格式。code 是稳定的错误码，前端按它显示翻译好的原因；message 只给开发排查看。
 * 字段错误一次全部返回（C56）。cooldownSeconds 只在"操作太频繁"（429，例如验证码 60 秒内重发）时出现：还要等多少秒。
 */
public record ApiError(String code, String message, List<FieldError> fields, @JsonInclude(JsonInclude.Include.NON_NULL) Long cooldownSeconds) {

  public record FieldError(String field, String code) {}

  public ApiError(String code, String message, List<FieldError> fields) {
    this(code, message, fields, null);
  }

  public static ApiError of(String code, String message) {
    return new ApiError(code, message, List.of());
  }
}
