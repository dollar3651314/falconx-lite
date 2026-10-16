# 部署脚本的公共函数（S20）。由 deploy.sh、rollback.sh、backup.sh、restore.sh、first-start.sh 引用，不单独运行。
# shellcheck shell=bash
FX_DIR=/opt/falconx
REG=ghcr.io/dollar3651314/falconx-lite
cd "$FX_DIR" || exit 1
mkdir -p "$FX_DIR/state" "$FX_DIR/logs" "$FX_DIR/backup"

# 拉取镜像。FX_OFFLINE_TEST=1 只用于在开发机上演练（镜像已在本机），服务器上不要设
pull() {
  [ -n "${FX_OFFLINE_TEST:-}" ] && return 0
  docker pull -q "$1" > /dev/null
}

# 带上两个变量文件运行 docker compose：.env（密钥和域名，Amos 填）、state/image.env（当前版本）
compose() {
  docker compose --project-name falconx --project-directory "$FX_DIR" -f "$FX_DIR/docker-compose.yml" \
    --env-file "$FX_DIR/.env" --env-file "$FX_DIR/state/image.env" "$@"
}

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$FX_DIR/logs/deploy.log"
}

# 当前运行的版本（提交号），没有时为空
current_tag() {
  sed -n 's/^IMAGE_TAG=//p' "$FX_DIR/state/image.env" 2>/dev/null || true
}

# 镜像里记录的提交号
revision() {
  docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$1"
}

# 等后端健康检查通过，并且返回的版本号等于要的提交号（最多 3 分钟）
wait_healthy() {
  local want=$1 got _
  for _ in $(seq 1 90); do
    got=$(curl -sf --max-time 3 http://127.0.0.1:8080/api/health | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)
    [ "$got" = "$want" ] && return 0
    sleep 2
  done
  return 1
}

# 换到某个版本（两个镜像用同一个提交号）
switch_to() {
  printf 'IMAGE_TAG=%s\n' "$1" > "$FX_DIR/state/image.env.new"
  mv "$FX_DIR/state/image.env.new" "$FX_DIR/state/image.env"
  compose up -d --remove-orphans
}

# 本机只保留最近 5 个版本的镜像（GitHub 镜像仓库保留 10 个），正在用的和上一个版本不删
prune_images() {
  local keep cur prev
  cur=$(current_tag)
  prev=$(cat "$FX_DIR/state/previous" 2>/dev/null || true)
  for repo in "$REG-app" "$REG-web"; do
    keep=0
    docker image ls "$repo" --format '{{.Tag}}' | while read -r tag; do
      [ "$tag" = "staging" ] && continue
      keep=$((keep + 1))
      if [ "$keep" -gt 5 ] && [ "$tag" != "$cur" ] && [ "$tag" != "$prev" ]; then
        docker image rm "$repo:$tag" > /dev/null 2>&1 || true
      fi
    done
  done
  docker image prune -f > /dev/null 2>&1 || true
}

# 从前端镜像里取出部署工具包（本目录的脚本、compose、systemd 文件），更新到服务器上。
# 用"写临时文件再改名"的方式替换，正在运行的脚本不受影响；.env、data/、state/、backup/ 不动。
sync_kit() {
  local tag=$1 tmp f
  tmp=$(mktemp -d)
  docker run --rm --entrypoint sh -v "$tmp:/out" "$REG-web:$tag" -c 'cp -r /falconx-kit/. /out/'
  for f in "$tmp"/* "$tmp"/systemd/*; do
    [ -f "$f" ] || continue
    local rel=${f#"$tmp"/}
    mkdir -p "$(dirname "$FX_DIR/$rel")"
    cp "$f" "$FX_DIR/$rel.new" && mv "$FX_DIR/$rel.new" "$FX_DIR/$rel"
  done
  chmod 755 "$FX_DIR"/*.sh
  rm -rf "$tmp"
}
