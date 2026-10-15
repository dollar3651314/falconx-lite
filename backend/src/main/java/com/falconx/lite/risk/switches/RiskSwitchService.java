package com.falconx.lite.risk.switches;

import com.falconx.lite.risk.api.RiskApi;
import org.springframework.stereotype.Service;

/** {@link RiskApi} 的实现。每次下单读一次开关（主键查询），后台改了立即生效，不做缓存。 */
@Service
class RiskSwitchService implements RiskApi {

  private final RiskSwitchMapper mapper;

  RiskSwitchService(RiskSwitchMapper mapper) {
    this.mapper = mapper;
  }

  @Override
  public boolean globalOpenPaused() {
    return mapper.globalOpenPaused();
  }
}
