package com.falconx.lite.admin.ops;

import com.falconx.lite.admin.security.AdminContext;
import com.falconx.lite.admin.security.AdminLoginOnly;
import com.falconx.lite.admin.security.Permission;
import com.falconx.lite.admin.security.RequiresPermission;
import com.falconx.lite.market.api.MarketApi;
import com.falconx.lite.market.api.SymbolSpec;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 后台接口（S16c）：仪表盘、交易监控、风控、品种与行情、交易参数。每个接口都声明了权限点，操作类都要原因并记审计。
 * 和原型字段不同的地方见后台方案第 9 节。
 */
@RestController
class MonitorController {

  record ReasonBody(String reason) {}

  record SwitchBody(Boolean value, String reason) {}

  record ValueBody(String value, String reason) {}

  record HolidayBody(String symbol, String date, String reason) {}

  private final DashboardOps dashboard;
  private final TradingOps trading;
  private final RiskOps risk;
  private final MarketOps market;
  private final MarketApi marketApi;

  MonitorController(DashboardOps dashboard, TradingOps trading, RiskOps risk, MarketOps market, MarketApi marketApi) {
    this.dashboard = dashboard;
    this.trading = trading;
    this.risk = risk;
    this.market = market;
    this.marketApi = marketApi;
  }

  private static boolean on(SwitchBody b) {
    return b != null && Boolean.TRUE.equals(b.value());
  }

  private static String reason(SwitchBody b) {
    return b == null ? null : b.reason();
  }

  // ---------- 仪表盘、交易参数 ----------

  @RequiresPermission(Permission.DASHBOARD_VIEW)
  @GetMapping("/api/admin/dashboard")
  DashboardOps.Stats dashboard() {
    return dashboard.stats();
  }

  @RequiresPermission(Permission.PARAMS_VIEW)
  @GetMapping("/api/admin/params")
  DashboardOps.Params params() {
    return dashboard.params();
  }

  @RequiresPermission(Permission.PARAMS_EDIT)
  @PutMapping("/api/admin/params")
  DashboardOps.Params updateParams(@RequestBody DashboardOps.ParamsBody body) {
    return dashboard.updateParams(AdminContext.current(), body);
  }

  // ---------- 交易监控 ----------

  /** 筛选下拉框用的品种代码（启用的） */
  @AdminLoginOnly
  @GetMapping("/api/admin/trade-symbols")
  List<String> tradeSymbols() {
    return marketApi.symbols().stream().map(SymbolSpec::code).toList();
  }

  @RequiresPermission(Permission.ORDER_VIEW)
  @GetMapping("/api/admin/orders")
  Ops.Page<TradingOps.OrderView> orders(@RequestParam(required = false) String symbol, @RequestParam(required = false) String side,
      @RequestParam(required = false) String status, @RequestParam(required = false) String keyword, @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "20") int pageSize) {
    return trading.orders(symbol, side, status, keyword, page, pageSize);
  }

  @RequiresPermission(Permission.POSITION_VIEW)
  @GetMapping("/api/admin/positions")
  Ops.Page<CustomerOps.PositionView> positions(@RequestParam(required = false) String symbol, @RequestParam(required = false) String side,
      @RequestParam(required = false) String keyword, @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize) {
    return trading.positions(symbol, side, keyword, page, pageSize);
  }

  @RequiresPermission(Permission.POSITION_LIQUIDATE)
  @PostMapping("/api/admin/positions/{id}/liquidate")
  Map<String, String> liquidate(@PathVariable long id, @RequestBody ReasonBody body) {
    return trading.liquidate(id, body == null ? null : body.reason());
  }

  @RequiresPermission(Permission.PENDING_VIEW)
  @GetMapping("/api/admin/pending")
  Ops.Page<TradingOps.PendingView> pending(@RequestParam(required = false) String symbol, @RequestParam(required = false) String side,
      @RequestParam(required = false) String keyword, @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int pageSize) {
    return trading.pending(symbol, side, keyword, page, pageSize);
  }

  @RequiresPermission(Permission.PENDING_FORCE_CANCEL)
  @PostMapping("/api/admin/pending/{id}/cancel")
  void forceCancel(@PathVariable long id, @RequestBody ReasonBody body) {
    trading.forceCancel(id, body == null ? null : body.reason());
  }

  // ---------- 风控 ----------

  @RequiresPermission(Permission.RISK_VIEW)
  @GetMapping("/api/admin/risk")
  RiskOps.Overview risk() {
    return risk.overview();
  }

  /** value：true 暂停 / false 恢复 */
  @RequiresPermission(Permission.RISK_GLOBAL_PAUSE)
  @PostMapping("/api/admin/risk/global-pause")
  RiskOps.Overview globalPause(@RequestBody SwitchBody body) {
    risk.setGlobalPause(AdminContext.current(), on(body), reason(body));
    return risk.overview();
  }

  @RequiresPermission(Permission.RISK_AUTO_LIQUIDATION)
  @PostMapping("/api/admin/risk/auto-liquidation")
  RiskOps.Overview autoLiquidation(@RequestBody SwitchBody body) {
    risk.setAutoLiquidation(AdminContext.current(), on(body), reason(body));
    return risk.overview();
  }

  @RequiresPermission(Permission.RISK_SYMBOL_PAUSE)
  @PostMapping("/api/admin/risk/symbols/{symbol}/pause")
  RiskOps.Overview symbolPause(@PathVariable String symbol, @RequestBody SwitchBody body) {
    risk.setSymbolPaused(AdminContext.current(), symbol, on(body), reason(body));
    return risk.overview();
  }

  /** value 为空表示不监控 */
  @RequiresPermission(Permission.RISK_THRESHOLD)
  @PutMapping("/api/admin/risk/symbols/{symbol}/threshold")
  RiskOps.Overview symbolThreshold(@PathVariable String symbol, @RequestBody ValueBody body) {
    risk.setSymbolThreshold(AdminContext.current(), symbol, body == null ? null : body.value(), body == null ? null : body.reason());
    return risk.overview();
  }

  @RequiresPermission(Permission.RISK_THRESHOLD)
  @PutMapping("/api/admin/risk/platform-threshold")
  RiskOps.Overview platformThreshold(@RequestBody ValueBody body) {
    risk.setPlatformThreshold(AdminContext.current(), body == null ? null : body.value(), body == null ? null : body.reason());
    return risk.overview();
  }

  @RequiresPermission(Permission.RISK_USER_LIMIT)
  @PutMapping("/api/admin/risk/per-user-limit")
  RiskOps.Overview perUserLimit(@RequestBody ValueBody body) {
    risk.setPerUserLimit(AdminContext.current(), body == null ? null : body.value(), body == null ? null : body.reason());
    return risk.overview();
  }

  // ---------- 品种与行情 ----------

  @RequiresPermission(Permission.SYMBOL_VIEW)
  @GetMapping("/api/admin/symbols")
  MarketOps.SymbolPage symbols(@RequestParam(required = false) String category, @RequestParam(required = false) String keyword,
      @RequestParam(required = false) Boolean enabled, @RequestParam(required = false) Boolean missingSwap, @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "50") int pageSize) {
    return market.symbols(category, keyword, enabled, missingSwap, page, pageSize);
  }

  /** v2 E3：新增品种（高危，必须填原因）；新增后默认暂停开仓 */
  @RequiresPermission(Permission.SYMBOL_CREATE)
  @PostMapping("/api/admin/symbols")
  MarketOps.SymbolView createSymbol(@RequestBody MarketOps.SymbolCreateBody body) {
    return market.createSymbol(body);
  }

  @RequiresPermission(Permission.SYMBOL_EDIT)
  @PutMapping("/api/admin/symbols/{code}")
  MarketOps.SymbolView updateSymbol(@PathVariable String code, @RequestBody MarketOps.SymbolPatchBody body) {
    return market.updateSymbol(code, body);
  }

  @RequiresPermission(Permission.SYMBOL_EDIT)
  @PostMapping("/api/admin/symbols/{code}/enabled")
  MarketOps.SymbolView setEnabled(@PathVariable String code, @RequestBody SwitchBody body) {
    return market.setEnabled(code, on(body), reason(body));
  }

  @RequiresPermission(Permission.SESSION_VIEW)
  @GetMapping("/api/admin/sessions")
  List<MarketOps.SessionView> sessions() {
    return market.sessions();
  }

  @RequiresPermission(Permission.SESSION_VIEW)
  @GetMapping("/api/admin/holidays")
  List<MarketOps.HolidayView> holidays() {
    return market.holidays();
  }

  @RequiresPermission(Permission.SESSION_EDIT)
  @PostMapping("/api/admin/holidays")
  MarketOps.HolidayView addHoliday(@RequestBody HolidayBody body) {
    HolidayBody b = body == null ? new HolidayBody(null, null, null) : body;
    return market.addHoliday(b.symbol(), b.date(), b.reason());
  }

  @RequiresPermission(Permission.SESSION_EDIT)
  @DeleteMapping("/api/admin/holidays/{id}")
  void deleteHoliday(@PathVariable long id) {
    market.deleteHoliday(id);
  }

  @RequiresPermission(Permission.FX_VIEW)
  @GetMapping("/api/admin/fx-rates")
  List<MarketOps.FxView> fx() {
    return market.fx();
  }
}
