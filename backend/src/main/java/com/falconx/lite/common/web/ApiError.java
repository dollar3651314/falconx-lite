package com.falconx.lite.common.web;

import java.util.List;

/**
 * 所有接口出错时的统一格式。code 是稳定的错误码，前端按它显示翻译好的原因；message 只给开发排查看。
 * 字段错误一次全部返回（C56）。
 */
public record ApiError(String code, String message, List<FieldError> fields) {

  public record FieldError(String field, String code) {}

  public static ApiError of(String code, String message) {
    return new ApiError(code, message, List.of());
  }
}
