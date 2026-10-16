# 转发到后端（S20）。客户端真实 IP 用 $remote_addr **覆盖** X-Forwarded-For（不追加），
# 客户端自己带的 X-Forwarded-For 不会传给后端；后端只信任内网代理传来的值（server.forward-headers-strategy: native）。
set $falconx_app http://app:8080;
proxy_pass $falconx_app;
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host "";
# 追踪号（v2 E9）：每个请求 Nginx 生成一个 $request_id（32 位十六进制），覆盖客户端自己带的 X-Request-Id；
# 后端（common/trace/TraceIdFilter）沿用它写日志、放进响应头和错误响应体。Nginx 的访问日志里也有，可以把两边的日志对上
proxy_set_header X-Request-Id $request_id;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
# 超时在各 location 里单独设（普通接口 120 秒，WebSocket 1 小时）
