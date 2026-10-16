# AC-13 压测工具

AC-13："挂单成交、止盈止损、强平：从应用收到触发价格到写入成交记录 ≤1 秒。口径：在测试环境 50 个品种同时推送报价的压力下，按应用日志里的两个时间点计算，99% 的触发 ≤1 秒。"

方法、环境和结果见 `测试报告/v1-压测报告-AC13.md`。这里只写怎么跑。

## 为什么不在测试服务器上直接压
测试服务器上没有替身接口（不能推动报价、注入充值、取验证码），也注册不了大量账号。所以在本机用**同样的两个镜像、同样的 `deploy/kit/docker-compose.yml`（内存上限、MySQL 和 Redis 参数、镜像里的 JVM 参数）**复刻一台"2 核"的服务器：所有容器绑在 CPU 0、1，压测程序绑在 CPU 2、3。

## 文件
| 文件 | 作用 |
|---|---|
| `compose.load.yml` | 压测专用覆盖文件，叠在 `deploy/kit/docker-compose.yml` 和 `e2e/compose.deployed.yml`（e2e profile、模拟报价源）后面：容器绑核 `cpuset: "0,1"`、端口换成本机 18443 / 18080、发验证码按 IP 的限次调大。**不能用在测试环境和生产**（约定 18） |
| `run-ac13.sh` | 一条命令跑完：构建 → 镜像 → 临时 `.env`（随机密码）和自签名证书 → compose 启动（项目名 `falconx-load`，新库）→ 跟随写后端日志、每 5 秒 `docker stats` → 压测程序 → 统计 → `down -v`、删临时目录 |
| `ac13.mjs` | 压测程序（只用 Node 自带模块）：注册客户、充值、开 WebSocket、循环"布单 → 同时推上去 → 推下来 → 推回原价" |
| `analyze.mjs` | 从后端日志统计撮合耗时（按类型和合计的次数、p50、p90、p99、最大值、超过 1 秒的比例），加上资源占用、错误日志和压测程序的统计 |

## 怎么跑
需要：Docker（含 compose 插件）、JDK 25 + Maven、Node 22、openssl、`taskset`；**至少 4 个 CPU 核**；本机 18443、18080 端口空闲。镜像 `nginx:1.27-bookworm`、`eclipse-temurin:25-jre-noble`、`mysql:8.4`、`redis:7` 要已在本机（`--pull never`，不访问 Docker Hub）。

```bash
bash e2e/load/run-ac13.sh                         # 真实交易时段：当时开市的品种参与
LOAD_ALL_OPEN=1 LOAD_NAME=load-b bash e2e/load/run-ac13.sh   # 50 个品种全部开市、都能开仓（只改临时库）
```

常用变量：`LOAD_SKIP_BUILD=1`（已经构建过 jar 和前端）、`LOAD_MVN_ARGS=-o`（Maven 离线）、`LOAD_KEEP=1`（结束后保留容器排查）、`LOAD_DURATION_S`（布单阶段持续秒数，默认 600）、`LOAD_USERS`（客户数，默认 30）、`LOAD_WS`（看行情的客户数，每人一条行情推送和一条交易推送，默认 20）、`LOAD_UP` / `LOAD_DOWN`（推动幅度，默认 +0.6% / −1.2%）、`LOAD_TRIGGER`（止盈止损、限价离当前价的距离，默认 0.25%）。

结果在 `e2e/logs/<LOAD_NAME>/`（默认 `load`，不进仓库）：`summary.md`（结果表）、`app.log`（后端日志）、`stats.jsonl`（资源采样）、`client.json`（压测程序的统计）、`containers.txt`（绑核和内存上限）。

## 每一轮做什么（约 13 秒一轮）
对每个能开仓的品种布 7 条单（价格相对当前报价，距离 `LOAD_TRIGGER`）：

| 单 | 什么时候触发 | 日志里的类型 |
|---|---|---|
| 多单带止盈、空单带止损、卖出限价 | 推上去（+0.6%） | TP、SL、挂单成交 |
| 多单带止损、空单带止盈、买入限价、最高杠杆多单 | 推下来（−1.2%） | SL、TP、挂单成交、LIQUIDATED |
| 卖出限价成交后的空单（带止盈） | 推下来 | TP |
| 买入限价成交后的多单（带止盈） | 推回原价 | TP |

推动报价用替身 `/api/e2e/market/move`，所有品种同时推（几十个并发请求），每一步有几十个品种、上百条单同时触发；模拟报价源的随机游走一直在跑（每 500 毫秒 50 个品种各一条）。

## 注意
- 发验证码一个一个发：不同邮箱同时发验证码时后端会死锁（压测报告 LT-1）。
- 压测程序不带 `Origin` 头（非浏览器客户端）；带了会被按同源检查（假域名的端口和 Nginx 传给后端的 Host 对不上）。
