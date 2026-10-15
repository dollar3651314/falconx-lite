package com.falconx.lite.risk.switches;

import org.apache.ibatis.annotations.Mapper;

/** 风控开关的 SQL，见 resources/mapper/risk/RiskSwitchMapper.xml。 */
@Mapper
interface RiskSwitchMapper {

  boolean globalOpenPaused();
}
