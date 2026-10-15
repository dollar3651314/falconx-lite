package com.falconx.lite.common.web;

import com.falconx.lite.common.error.BizException;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.ErrorResponseException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** 把异常翻译成统一的 {@link ApiError}；内部错误不把细节返回给客户。 */
@RestControllerAdvice
public class GlobalExceptionHandler {

  private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  /** 错误码对应的 HTTP 状态；没有列出的业务错误一律 400 */
  private static final Map<String, HttpStatus> STATUS = Map.of(
      "UNAUTHORIZED", HttpStatus.UNAUTHORIZED,
      "USER_FROZEN", HttpStatus.FORBIDDEN,
      "LOGIN_LOCKED", HttpStatus.TOO_MANY_REQUESTS,
      "CODE_TOO_FREQUENT", HttpStatus.TOO_MANY_REQUESTS,
      "EMAIL_TAKEN", HttpStatus.CONFLICT);

  @ExceptionHandler(BizException.class)
  public ResponseEntity<ApiError> biz(BizException e) {
    return ResponseEntity.status(STATUS.getOrDefault(e.code(), HttpStatus.BAD_REQUEST)).body(ApiError.of(e.code(), e.getMessage()));
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<ApiError> invalid(MethodArgumentNotValidException e) {
    var fields = e.getBindingResult().getFieldErrors().stream()
        .map(f -> new ApiError.FieldError(f.getField(), f.getDefaultMessage()))
        .toList();
    return ResponseEntity.badRequest().body(new ApiError("VALIDATION_FAILED", "请求字段不合法", fields));
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<ApiError> unreadable(HttpMessageNotReadableException e) {
    return ResponseEntity.badRequest().body(ApiError.of("BAD_REQUEST", "请求格式不正确"));
  }

  /** 框架自带状态码的错误（路径不存在 404、方法不支持 405 等）保持原状态码，不当成内部错误 */
  @ExceptionHandler(ErrorResponseException.class)
  public ResponseEntity<ApiError> framework(ErrorResponseException e) {
    return frameworkError(e);
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiError> unexpected(Exception e) {
    if (e instanceof ErrorResponse er) return frameworkError(er);
    log.error("未处理的异常", e);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(ApiError.of("INTERNAL_ERROR", "服务暂时不可用"));
  }

  private static ResponseEntity<ApiError> frameworkError(ErrorResponse e) {
    int status = e.getStatusCode().value();
    String code = status == 404 ? "NOT_FOUND" : status == 405 ? "METHOD_NOT_ALLOWED" : status == 413 ? "FILE_TOO_LARGE" : "BAD_REQUEST";
    return ResponseEntity.status(e.getStatusCode()).body(ApiError.of(code, "请求无法处理"));
  }
}
