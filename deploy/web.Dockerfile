# 前端 + Nginx 镜像（S20，部署方案 v1.1 第 4、7 节）。先构建两个前端（真实接口模式，不设 VITE_API_MODE），再在仓库根目录构建：
#   npm ci --prefix web/client && npm run build --prefix web/client
#   npm ci --prefix web/admin && npm run build --prefix web/admin
#   docker build -f deploy/web.Dockerfile --build-arg FX_VERSION=<提交号> -t falconx-lite-web:<提交号> .
# 里面有：两个前端的构建产物、Nginx 配置、服务器端部署工具包（/falconx-kit，deploy.sh 每次更新时从这里同步到服务器）。
FROM nginx:1.27-bookworm
ARG FX_VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/dollar3651314/falconx-lite" \
      org.opencontainers.image.revision="${FX_VERSION}"
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/nginx/site.conf.template /etc/nginx/templates/site.conf.template
COPY deploy/nginx/proxy.inc /etc/nginx/snippets/proxy.inc
COPY deploy/nginx/security.inc /etc/nginx/snippets/security.inc
COPY web/client/dist /usr/share/nginx/client
COPY web/admin/dist /usr/share/nginx/admin
COPY deploy/kit /falconx-kit
RUN echo "${FX_VERSION}" > /falconx-kit/VERSION
