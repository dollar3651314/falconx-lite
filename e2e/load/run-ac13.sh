#!/usr/bin/env bash
# AC-13 压测（测试报告/v1-压测报告-AC13.md）：在本机复刻测试服务器（2 核 2G）后压测撮合耗时。
#   压测程序（taskset 绑核 2,3）→ falconx-lite-web（Nginx，HTTPS）→ falconx-lite-app（profile e2e，模拟报价源）→ MySQL、Redis
#   所有容器绑在 CPU 0,1（e2e/load/compose.load.yml）；替身接口（推动报价、注入充值、取验证码）直接访问后端 127.0.0.1:18080。
# 用 deploy/kit/docker-compose.yml + e2e/compose.deployed.yml + e2e/load/compose.load.yml 启动（compose 项目名 falconx-load），每次都是新库。
#
# 用法：bash e2e/load/run-ac13.sh
# 需要：Docker（含 compose 插件）、JDK 25 + Maven、Node 22、openssl、taskset；至少 4 个 CPU 核；本机 18443、18080 空闲。
# 可选环境变量：
#   LOAD_SKIP_BUILD=1    不重新构建 jar 和两个前端（用已有的 backend/target、web/*/dist），镜像照样重新打包
#   LOAD_MVN_ARGS        传给 Maven 的额外参数（例如本机离线时 -o）
#   LOAD_KEEP=1          结束后不停容器、不删临时目录（排查用；之后 docker compose -p falconx-load down -v 并手动删目录）
#   LOAD_APP_CPUS        容器用的核（默认 0,1，要和 compose.load.yml 一致）；LOAD_CLIENT_CPUS 压测程序用的核（默认 2,3）
#   LOAD_ALL_OPEN=1      50 个品种全部开市、都能开仓（只改临时库，见下面第 4 步）
#   LOAD_NAME            结果目录名（默认 load，即 e2e/logs/load/）
#   LOAD_DURATION_S、LOAD_USERS、LOAD_WS 等传给 ac13.mjs（见该文件开头）
# 密码（数据库、Redis、超管）每次随机生成，只写进临时目录的 .env，结束时连同临时目录一起删除，不进仓库、不打印。
# 结果：e2e/logs/load/（不进仓库）：app.log（后端日志）、stats.jsonl（docker stats 采样）、client.json（压测程序的统计）、summary.md（结果表）。
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
PROJECT=falconx-load
REG=ghcr.io/dollar3651314/falconx-lite
TAG=load-local
APP_DOMAIN=test-app.e2e.test
ADMIN_DOMAIN=test-admin.e2e.test
CLIENT_CPUS=${LOAD_CLIENT_CPUS:-2,3}
LOGS=$ROOT/e2e/logs/${LOAD_NAME:-load}
START=$(date +%s)
rm -rf "$LOGS"
mkdir -p "$LOGS"

say() { echo "== [$(($(date +%s) - START))s] $*" | tee -a "$LOGS/timing.txt"; }
die() { echo "错误：$*" >&2; exit 2; }
lcurl() { curl --noproxy '*' "$@"; }

# ---------- 0. 检查 ----------
say "检查环境"
for c in docker openssl curl node npm taskset; do command -v "$c" > /dev/null || die "缺少命令 $c"; done
[ "$(nproc)" -ge 4 ] || die "至少要 4 个 CPU 核（2 个给容器，2 个给压测程序）"
if docker compose ls -a --format json 2> /dev/null | grep -q "\"Name\":\"$PROJECT\""; then
  die "compose 项目 $PROJECT 已经存在：先 docker compose -p $PROJECT down -v"
fi
for p in 18443 18080; do
  if (exec 3<> "/dev/tcp/127.0.0.1/$p") 2> /dev/null; then die "本机端口 $p 已被占用；本脚本不会去停别人的进程"; fi
done

# ---------- 1. 构建 jar 和两个前端 ----------
if [ -z "${LOAD_SKIP_BUILD:-}" ]; then
  say "构建后端 jar"
  # shellcheck disable=SC2086
  mvn -B -ntp -q ${LOAD_MVN_ARGS:-} -f backend package -DskipTests
  for app in client admin; do
    say "构建 web/$app（真实接口模式）"
    [ -d "web/$app/node_modules" ] || npm ci --prefix "web/$app" --no-audit --no-fund
    (unset VITE_API_MODE; npm run build --prefix "web/$app" > "$LOGS/build-$app.log" 2>&1) || { tail -40 "$LOGS/build-$app.log" >&2; exit 1; }
  done
fi
ls backend/target/falconx-lite-*.jar > /dev/null 2>&1 || die "没有 backend/target/falconx-lite-*.jar"
for app in client admin; do [ -f "web/$app/dist/index.html" ] || die "没有 web/$app/dist（去掉 LOAD_SKIP_BUILD 重跑）"; done

# ---------- 2. 两个镜像（和测试环境同样的 Dockerfile） ----------
SHA=$(git rev-parse HEAD 2> /dev/null || echo dev)
say "构建镜像 $REG-app:$TAG、$REG-web:$TAG（FX_VERSION=$SHA）"
docker build -q -f deploy/app.Dockerfile --build-arg FX_VERSION="$SHA" -t "$REG-app:$TAG" . > /dev/null
docker build -q -f deploy/web.Dockerfile --build-arg FX_VERSION="$SHA" -t "$REG-web:$TAG" . > /dev/null

# ---------- 3. 临时目录 ----------
TMP=$(mktemp -d "${TMPDIR:-/tmp}/falconx-load.XXXXXX")
chmod 700 "$TMP"
compose() {
  docker compose --project-name "$PROJECT" --project-directory "$TMP" \
    -f "$ROOT/deploy/kit/docker-compose.yml" -f "$ROOT/e2e/compose.deployed.yml" -f "$ROOT/e2e/load/compose.load.yml" \
    --env-file "$TMP/.env" --env-file "$TMP/state/image.env" "$@"
}
STATS_PID=""
LOGS_PID=""
# shellcheck disable=SC2317  # 由 trap 调用
cleanup() {
  local rc=$?
  set +e
  [ -n "$STATS_PID" ] && kill "$STATS_PID" 2> /dev/null
  [ -n "$LOGS_PID" ] && kill "$LOGS_PID" 2> /dev/null
  if [ -f "$TMP/.env" ]; then
    compose ps -a > "$LOGS/ps.txt" 2>&1
    for s in web mysql redis; do compose logs --no-color "$s" > "$LOGS/$s.log" 2>&1; done
  fi
  if [ -n "${LOAD_KEEP:-}" ]; then
    echo "LOAD_KEEP=1：容器和临时目录 $TMP 保留；用完执行 docker compose -p $PROJECT down -v，再删除该目录（里面有密码）"
  else
    [ -f "$TMP/.env" ] && compose down -v --remove-orphans > /dev/null 2>&1
    docker run --rm -v "$TMP:/t" --entrypoint sh redis:7 -c 'rm -rf /t/* /t/.[!.]*' > /dev/null 2>&1
    rm -rf "$TMP"
  fi
  say "结束（退出码 $rc），结果在 $LOGS"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

rnd() { echo "load$(openssl rand -hex 16)"; }
mkdir -p "$TMP/state" "$TMP/data/mysql" "$TMP/data/redis" "$TMP/data/storage" "$TMP/certs/live/falconx" "$TMP/certs/www"
(
  umask 077
  cat > "$TMP/.env" << EOF
APP_DOMAIN=$APP_DOMAIN
ADMIN_DOMAIN=$ADMIN_DOMAIN
MYSQL_ROOT_PASSWORD=$(rnd)
FX_DB_PASSWORD=$(rnd)
FX_REDIS_PASSWORD=$(rnd)
FX_ADMIN_INIT_USERNAME=load_admin
FX_ADMIN_INIT_PASSWORD=$(rnd)
E2E_CERT_DIR=$TMP/certs
EOF
)
printf 'IMAGE_TAG=%s\n' "$TAG" > "$TMP/state/image.env"
chown 10001 "$TMP/data/storage" 2> /dev/null || chmod 777 "$TMP/data/storage"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=$APP_DOMAIN" \
  -addext "subjectAltName=DNS:$APP_DOMAIN,DNS:$ADMIN_DOMAIN" \
  -keyout "$TMP/certs/live/falconx/privkey.pem" -out "$TMP/certs/live/falconx/fullchain.pem" 2> /dev/null

# ---------- 4. 启动 ----------
say "启动容器（compose 项目 $PROJECT，容器绑核 0,1）"
E2E_CERT_DIR="$TMP/certs" compose up -d --pull never --quiet-pull > "$LOGS/up.log" 2>&1 || { cat "$LOGS/up.log" >&2; exit 1; }
say "等后端健康检查（版本 $SHA）"
ok=""
for _ in $(seq 1 120); do
  v=$(lcurl -sf --max-time 3 http://127.0.0.1:18080/api/health | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)
  if [ "$v" = "$SHA" ]; then ok=1; break; fi
  sleep 2
done
[ -n "$ok" ] || { compose logs --no-color --tail 80 app >&2; die "后端 4 分钟内没有通过健康检查"; }
lcurl -skf --max-time 3 --resolve "$APP_DOMAIN:18443:127.0.0.1" "https://$APP_DOMAIN:18443/api/health" > /dev/null || die "Nginx 没有起来"

# LOAD_ALL_OPEN=1：让 50 个品种全部开市、都能开仓（只改这次压测的临时库）：
# 美股（默认 UTC 13:30–20:00）加一段全天的交易时段，BTCUSD 取消"暂停开仓"（新库默认暂停，交付说明 E2E-1）。
# 品种和交易时段在后端启动时加载，所以改完重启一次后端。
if [ -n "${LOAD_ALL_OPEN:-}" ]; then
  say "LOAD_ALL_OPEN=1：临时库里美股加全天交易时段、BTCUSD 取消暂停开仓，重启后端"
  compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" falconx 2> /dev/null' << 'SQL'
INSERT INTO market_session (symbol, day_of_week, open_minute, close_minute)
SELECT s.code, d.d, 0, 1440 FROM market_symbol s
JOIN (SELECT 1 AS d UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7) d
WHERE s.category = 'stock';
UPDATE market_symbol SET open_paused = 0 WHERE code = 'BTCUSD';
SQL
  compose restart app > /dev/null 2>&1
  ok=""
  for _ in $(seq 1 120); do
    v=$(lcurl -sf --max-time 3 http://127.0.0.1:18080/api/health | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)
    if [ "$v" = "$SHA" ]; then ok=1; break; fi
    sleep 2
  done
  [ -n "$ok" ] || die "重启后端后没有通过健康检查"
fi
# 记录绑核情况（报告里写）
for s in web app mysql redis; do
  echo "$s cpuset=$(docker inspect -f '{{.HostConfig.CpusetCpus}}' "$PROJECT-$s-1") mem=$(docker inspect -f '{{.HostConfig.Memory}}' "$PROJECT-$s-1")" >> "$LOGS/containers.txt"
done
cat "$LOGS/containers.txt"

# 后端日志从现在开始一直写到文件（日志轮转也不丢）；docker stats 每 5 秒采样一次（采样程序也绑在压测的核上）
compose logs -f --no-color --no-log-prefix app > "$LOGS/app.log" 2>&1 &
LOGS_PID=$!
(
  while true; do
    taskset -c "$CLIENT_CPUS" docker stats --no-stream --format '{"t":"'"$(date -u +%FT%TZ)"'","name":"{{.Name}}","cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","memPerc":"{{.MemPerc}}"}' \
      "$PROJECT-web-1" "$PROJECT-app-1" "$PROJECT-mysql-1" "$PROJECT-redis-1" >> "$LOGS/stats.jsonl" 2> /dev/null
    sleep 5
  done
) &
STATS_PID=$!

# ---------- 5. 压测 ----------
say "运行压测程序（绑核 $CLIENT_CPUS）"
set +e
LOAD_BASE="https://$APP_DOMAIN:18443" LOAD_STUB="http://127.0.0.1:18080" LOAD_CA="$TMP/certs/live/falconx/fullchain.pem" \
  LOAD_OUT="$LOGS/client.json" taskset -c "$CLIENT_CPUS" node "$ROOT/e2e/load/ac13.mjs" 2>&1 | tee "$LOGS/client.log"
rc=${PIPESTATUS[0]}
set -e
say "压测程序结束（退出码 $rc）"
sleep 3
kill "$STATS_PID" 2> /dev/null || true
STATS_PID=""
kill "$LOGS_PID" 2> /dev/null || true
LOGS_PID=""
compose logs --no-color --no-log-prefix app > "$LOGS/app-final.log" 2>&1 || true

# ---------- 6. 统计 ----------
node "$ROOT/e2e/load/analyze.mjs" "$LOGS" | tee "$LOGS/summary.md"
exit "$rc"
