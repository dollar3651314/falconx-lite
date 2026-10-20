package com.falconx.lite.wallet.address;

import com.falconx.lite.wallet.Chain;
import com.falconx.lite.wallet.SweepEvmProperties;
import com.falconx.lite.wallet.WalletProperties;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 当前生效的合约地址参数（方案第 4.13 节）。四个地址都配了、格式对、parent 不是我们自己的地址时，第一次用到就登记进 {@code wallet_address_scheme}
 * 拿到套号；否则当作没配（继续用 xpub），问题由 {@link #problem()} 给告警和后台。
 * 后端额外检查（方案第 4.7 节）：parent 不能是 USDT 合约、热钱包或我们的充值地址（Amos 10-19 把合约地址当收款地址的教训）。
 */
@Component
@EnableConfigurationProperties(SweepEvmProperties.class)
public class ForwarderSchemes {

  private static final Logger log = LoggerFactory.getLogger(ForwarderSchemes.class);

  private final AddressMapper mapper;
  private final SweepEvmProperties props;
  private final WalletProperties wallet;
  private final String hotEthAddress;
  private volatile ForwarderScheme current;
  private volatile String problem;
  private volatile boolean resolved;

  ForwarderSchemes(AddressMapper mapper, SweepEvmProperties props, WalletProperties wallet, @Value("${falconx.wallet.hot.eth-address:}") String hotEthAddress) {
    this.mapper = mapper;
    this.props = props;
    this.wallet = wallet;
    this.hotEthAddress = hotEthAddress;
  }

  /** 合约地址参数配齐并且检查通过时的当前一套；否则为空（用 xpub） */
  public Optional<ForwarderScheme> current() {
    if (!resolved) resolve();
    return Optional.ofNullable(current);
  }

  /** 配置有问题时的说明（没配置时为空） */
  public Optional<String> problem() {
    if (!resolved) resolve();
    return Optional.ofNullable(problem);
  }

  public Optional<ForwarderScheme> byVer(int ver) {
    AddressMapper.SchemeRow r = mapper.schemeByVer(ver);
    return r == null ? Optional.empty() : Optional.of(r.toScheme());
  }

  /** 所有登记过的（老的永远不删：扫块、归集老地址都要用） */
  public List<ForwarderScheme> all() {
    return mapper.schemes().stream().map(AddressMapper.SchemeRow::toScheme).toList();
  }

  private synchronized void resolve() {
    if (resolved) return;
    List<String> problems = props.contractProblems();
    if (props.contractFieldsSet() == 0) {
      resolved = true;
      return;
    }
    if (!problems.isEmpty()) {
      fail(String.join("；", problems));
      return;
    }
    String parent = props.parent().strip();
    String pk = parent.toLowerCase();
    for (Chain c : Chain.values()) {
      WalletProperties.ChainConfig cfg = wallet.chain(c);
      if (c.family == Chain.Family.ETH && cfg != null && cfg.usdtContract() != null && cfg.usdtContract().strip().equalsIgnoreCase(parent)) {
        fail("parent（冷钱包）不能是 " + c + " 的 USDT 合约地址");
        return;
      }
    }
    if (hotEthAddress != null && hotEthAddress.strip().equalsIgnoreCase(parent)) {
      fail("parent（冷钱包）不能是热钱包地址");
      return;
    }
    if (mapper.ownerOf(Chain.Family.ETH.name(), pk) != null) {
      fail("parent（冷钱包）不能是我们的充值地址");
      return;
    }
    String key = String.join("|", props.factory().strip(), props.implementation().strip(), parent, props.batcher().strip()).toLowerCase();
    mapper.insertSchemeIgnore(Chain.Family.ETH.name(), props.factory().strip(), props.implementation().strip(), parent, props.batcher().strip(), key);
    AddressMapper.SchemeRow row = mapper.schemeByKey(key);
    current = row.toScheme();
    problem = null;
    resolved = true;
    log.info("以太坊体系充值地址用合约转发地址：第 {} 套（工厂 {}，parent {}，批量合约 {}）", current.ver(), current.factory(), current.parent(), current.feeAddress());
  }

  private void fail(String why) {
    problem = why;
    current = null;
    resolved = true;
    log.error("合约充值地址的配置有问题，继续用 xpub 派生地址：{}", why);
  }

  /** 测试用：配置变了以后重新判断 */
  void reset() {
    resolved = false;
    current = null;
    problem = null;
  }
}
