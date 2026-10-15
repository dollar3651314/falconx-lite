package com.falconx.lite.wallet.deposit;

import com.falconx.lite.trading.api.Bucket;
import com.falconx.lite.trading.api.LedgerApi;
import com.falconx.lite.trading.api.LedgerCommand;
import com.falconx.lite.trading.api.LedgerEntryType;
import com.falconx.lite.wallet.Chain;
import com.falconx.lite.wallet.WalletProperties;
import com.falconx.lite.wallet.address.AddressService;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 扫块和入账（充值方案第 2 节）。每条链：
 * <ol>
 *   <li>扫块：从上次扫到的区块往后，查配置好的 USDT 合约的转账，收款地址是我们的就记一条充值（待确认 / 低于最小充值金额）</li>
 *   <li>确认：确认数够了，再核对一次区块哈希没变（没被回滚），入账；变了就作废</li>
 * </ol>
 * 只认配置好的 USDT 合约（修复 F3）：没有配置合约的链不扫块；客户端返回的事件合约不对也不记，打日志（AC-08）。
 */
@Service
public class DepositService {

  private static final Logger log = LoggerFactory.getLogger(DepositService.class);
  static final String BIZ_DEPOSIT = "DEPOSIT";

  private final DepositMapper mapper;
  private final ChainClients clients;
  private final AddressService addresses;
  private final LedgerApi ledger;
  private final WalletProperties props;
  private final TransactionTemplate tx;

  DepositService(DepositMapper mapper, ChainClients clients, AddressService addresses, LedgerApi ledger, WalletProperties props, TransactionTemplate tx) {
    this.mapper = mapper;
    this.clients = clients;
    this.addresses = addresses;
    this.ledger = ledger;
    this.props = props;
    this.tx = tx;
  }

  /** 每 15 秒：每条链先扫块再确认 */
  @Scheduled(fixedDelay = 15_000, initialDelay = 20_000)
  void tick() {
    for (Chain c : Chain.values()) {
      try {
        run(c);
      } catch (RuntimeException e) {
        log.error("{} 扫块或入账失败", c, e);
      }
    }
  }

  /** 扫块 + 确认一次。没有客户端或没有配置 USDT 合约时什么也不做 */
  public void run(Chain chain) {
    WalletProperties.ChainConfig cfg = props.chain(chain);
    Optional<ChainClient> client = clients.get(chain);
    if (cfg == null || !cfg.scanReady() || client.isEmpty()) return;
    long head = client.get().headBlock();
    scan(chain, cfg, client.get(), head);
    confirm(chain, cfg, client.get(), head);
  }

  private void scan(Chain chain, WalletProperties.ChainConfig cfg, ChainClient client, long head) {
    Long last = mapper.cursor(chain.name());
    if (last == null) last = (cfg.startBlock() != null ? cfg.startBlock() : head) - 1;
    if (last >= head) return;
    long from = last + 1;
    long to = Math.min(head, last + cfg.scanBatch());
    for (ChainClient.TokenTransfer t : client.transfers(from, to, cfg.usdtContract())) {
      if (!sameContract(chain, t.contract(), cfg.usdtContract())) {
        log.warn("忽略非配置的代币合约 chain={} contract={} tx={}", chain, t.contract(), t.txHash());
        continue;
      }
      Optional<Long> user = addresses.userOf(chain, t.to());
      if (user.isEmpty()) continue;
      BigDecimal amount = new BigDecimal(t.rawAmount()).movePointLeft(cfg.usdtDecimals()).setScale(8, RoundingMode.DOWN);
      String status = amount.compareTo(props.minDeposit()) < 0 ? "BELOW_MIN" : "PENDING";
      if (mapper.insertIgnore(chain.name(), t.txHash(), t.logIndex(), t.blockNumber(), t.blockHash(), t.from(), t.to(), user.get(), amount, status) == 1) {
        log.info("发现充值 chain={} tx={} user={} amount={} status={}", chain, t.txHash(), user.get(), amount, status);
      }
    }
    mapper.saveCursor(chain.name(), to);
  }

  private void confirm(Chain chain, WalletProperties.ChainConfig cfg, ChainClient client, long head) {
    for (DepositMapper.DepositRow d : mapper.pending(chain.name())) {
      int conf = (int) Math.max(0, head - d.blockNumber() + 1);
      if (conf < cfg.confirmations()) {
        mapper.updateConfirmations(d.id(), conf);
        continue;
      }
      Optional<String> hash = client.blockHash(d.blockNumber());
      if (hash.isEmpty() || !hash.get().equalsIgnoreCase(d.blockHash())) {
        if (mapper.finish(d.id(), "DROPPED", conf) == 1) log.warn("充值所在区块被回滚，作废 chain={} tx={}", chain, d.txHash());
        continue;
      }
      credit(d, conf);
    }
  }

  /** 状态改成已入账和记账在同一个事务里；幂等键 链:交易:日志序号 */
  private void credit(DepositMapper.DepositRow d, int conf) {
    tx.executeWithoutResult(st -> {
      if (mapper.finish(d.id(), "CREDITED", conf) != 1) return;
      ledger.apply(new LedgerCommand(d.userId(), Bucket.BALANCE, d.amount(), LedgerEntryType.DEPOSIT, BIZ_DEPOSIT,
          d.chain() + ":" + d.txHash() + ":" + d.logIndex(), "充值 " + d.chain()));
    });
    log.info("充值入账 chain={} tx={} user={} amount={}", d.chain(), d.txHash(), d.userId(), d.amount());
  }

  /** 以太坊体系合约地址不区分大小写；TRON 原样比较 */
  private static boolean sameContract(Chain chain, String a, String b) {
    if (a == null || b == null) return false;
    return chain.family == Chain.Family.ETH ? a.equalsIgnoreCase(b) : a.equals(b);
  }
}
