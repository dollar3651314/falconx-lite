package com.falconx.lite.trading.order;

import com.falconx.lite.trading.api.ExposureApi;
import java.util.List;
import org.springframework.stereotype.Component;

/** {@link ExposureApi} 的实现：按品种汇总持仓。 */
@Component
class ExposureQuery implements ExposureApi {

  private final OrderMapper mapper;

  ExposureQuery(OrderMapper mapper) {
    this.mapper = mapper;
  }

  @Override
  public List<SymbolLots> openLots() {
    return mapper.openLots();
  }
}
