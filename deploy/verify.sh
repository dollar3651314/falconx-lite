#!/usr/bin/env bash
# 从外部确认测试环境部署成功（S20，部署方案 v1.1 第 8 节）。在任何能上网的机器上运行，不需要登录服务器：
#   bash deploy/verify.sh test-app.<域名> test-admin.<域名> [期望的提交号]
# 检查：版本、HTTPS 和证书、跳转、不该开放的路径和端口、页面能打开、测试环境标识。
# 真实 IP（伪造 X-Forwarded-For 不起作用）、WebSocket、冒烟流程要在浏览器里手动确认，见部署方案第 8 节。
set -uo pipefail
app=${1:?用法：verify.sh <客户端域名> <后台域名> [提交号]}
admin=${2:?用法：verify.sh <客户端域名> <后台域名> [提交号]}
want=${3:-}
fail=0
ok() { echo "  ✓ $1"; }
bad() { echo "  ✗ $1"; fail=1; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }

echo "== 版本和健康检查"
h=$(curl -sf --max-time 10 "https://$app/api/health" || true)
case "$h" in *'"status":"UP"'*) ok "健康检查 UP" ;; *) bad "健康检查不是 UP：${h:-无法访问}" ;; esac
case "$h" in *'"env":"test"'*) ok "测试环境标识 env=test" ;; *) bad "健康检查里没有 env=test" ;; esac
if [ -n "$want" ]; then
  case "$h" in *"\"version\":\"$want\""*) ok "版本是 $want" ;; *) bad "版本不是 $want" ;; esac
fi

echo "== HTTPS"
[ "$(code "http://$app/")" = 301 ] && ok "http 跳转到 https" || bad "http 没有跳转"
for d in "$app" "$admin"; do
  if curl -s -o /dev/null --max-time 10 "https://$d/"; then ok "$d 证书有效"; else bad "$d 证书无效或无法访问"; fi
done

echo "== 页面"
[ "$(code "https://$app/")" = 200 ] && ok "客户端首页 200" || bad "客户端首页打不开"
[ "$(code "https://$admin/admin/")" = 200 ] && ok "后台首页 200" || bad "后台首页打不开"

echo "== 不该对外的路径"
# 带分号的写法（Spring 会忽略分号后面的内容）也要拦住（安全审查 SEC-02）
for u in "https://$app/api/admin/me" "https://$app/api/admin;x/me" "https://$app/api/e2e/mail/code" "https://$app/actuator/health" "https://$admin/actuator/health" "https://$admin/api/trading/ledger"; do
  c=$(code "$u"); { [ "$c" = 404 ] || [ "$c" = 401 ]; } && ok "$c $u" || bad "$c $u（应为 404）"
done

echo "== 端口（只应开放 80、443；22 只对 Amos 的 IP 开放，这里看到不通是正常的）"
ip=$(getent hosts "$app" | awk '{print $1; exit}')
for p in 3306 6379 8080 8081 22; do
  if timeout 5 bash -c "exec 3<>/dev/tcp/$ip/$p" 2> /dev/null; then
    [ "$p" = 22 ] && echo "  ! 22 从本机可以连上（如果本机不是 Amos 的 IP，说明 SSH 对外开放了）" || bad "端口 $p 对外开放"
  else
    ok "端口 $p 不通"
  fi
done

echo
[ "$fail" = 0 ] && echo "全部通过" || echo "有检查没通过"
exit "$fail"
