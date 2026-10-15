package com.falconx.lite.risk.api;

/** 风控对其他模块的接口。S7 只有全局暂停；S11 加品种净敞口自动禁开。风控数据不发给客户（T5），调用方只拿到"能不能开仓"。 */
public interface RiskApi {

  /** 平台是否全局暂停开仓（只能平仓）。 */
  boolean globalOpenPaused();
}
