package com.falconx.lite.risk.switches;

import java.math.BigDecimal;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 风控开关、阈值和事件的 SQL，见 resources/mapper/risk/RiskSwitchMapper.xml。 */
@Mapper
interface RiskSwitchMapper {

  /** 平台级：risk_switch 那一行 */
  record Platform(boolean globalOpenPaused, boolean autoGlobalPaused, boolean autoLiquidation, BigDecimal platformNetThreshold) {}

  /** 品种级：risk_symbol 一行 */
  record SymbolRow(String symbol, BigDecimal netThreshold, boolean manualPaused, boolean autoPaused) {}

  Platform platform();

  List<SymbolRow> symbols();

  /** 品种是否暂停（手动或自动） */
  Boolean symbolPaused(@Param("symbol") String symbol);

  int setGlobal(@Param("manual") boolean manual, @Param("auto") boolean auto);

  /** 只在还没自动禁开时设置，返回 1 表示这次才触发 */
  int autoPauseGlobal();

  int setAutoLiquidation(@Param("enabled") boolean enabled);

  int setPlatformThreshold(@Param("threshold") BigDecimal threshold);

  int upsertSymbol(@Param("symbol") String symbol);

  int setSymbolPaused(@Param("symbol") String symbol, @Param("manual") boolean manual, @Param("auto") boolean auto);

  /** 只在还没自动禁开时设置，返回 1 表示这次才触发 */
  int autoPauseSymbol(@Param("symbol") String symbol);

  int setSymbolThreshold(@Param("symbol") String symbol, @Param("threshold") BigDecimal threshold);

  int insertEvent(@Param("kind") String kind, @Param("symbol") String symbol, @Param("netUsd") BigDecimal netUsd, @Param("threshold") BigDecimal threshold,
      @Param("operatorId") Long operatorId);
}
