package com.falconx.lite.notification.service;

import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 通知模块的表（notify_*）。只有 notification 模块使用。 */
@Mapper
interface NotifyMapper {

  Rows.TemplateRow template(@Param("code") String code);

  Rows.PrefRow pref(@Param("userId") long userId);

  void upsertPref(@Param("userId") long userId, @Param("push") boolean push, @Param("email") boolean email);

  void upsertLang(@Param("userId") long userId, @Param("lang") String lang);

  void insertMessage(Rows.MessageRow m);

  List<Rows.MessageRow> messages(@Param("userId") long userId, @Param("offset") int offset, @Param("limit") int limit);

  long countMessages(@Param("userId") long userId);

  long countUnread(@Param("userId") long userId);

  int markRead(@Param("userId") long userId, @Param("id") long id, @Param("now") LocalDateTime now);

  int markAllRead(@Param("userId") long userId, @Param("now") LocalDateTime now);

  void insertRecord(Rows.RecordRow r);

  void updateRecord(@Param("id") long id, @Param("status") String status, @Param("error") String error);

  /** 某个客户的通知记录，最新的在前（测试和后台 S16 用） */
  List<Rows.RecordRow> recordsOf(@Param("userId") long userId, @Param("limit") int limit);

  Rows.RecordRow record(@Param("id") long id);
}
