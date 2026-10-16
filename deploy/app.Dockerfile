# 后端镜像（S20，部署方案 v1.1 第 4、7 节）。先打包 jar（CI 的 deploy-staging 里做，测试已经在 CI 跑过），再在仓库根目录构建：
#   mvn -B -ntp -f backend/pom.xml package -DskipTests
#   docker build -f deploy/app.Dockerfile --build-arg FX_VERSION=<提交号> -t falconx-lite-app:<提交号> .
# 镜像里不放任何密钥；数据库、Redis 等配置在运行时由 docker-compose.yml 和服务器的 .env 传入。
FROM eclipse-temurin:25-jre-noble
ARG FX_VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/dollar3651314/falconx-lite" \
      org.opencontainers.image.revision="${FX_VERSION}"
# FX_VERSION：健康检查返回的版本号（部署脚本用它确认新版本已经生效）
# 内存：堆最多 512MB，容器上限 768MB（部署方案第 2 节，2 核 2G 服务器）
ENV FX_VERSION=${FX_VERSION} \
    FX_STORAGE_DIR=/data/storage \
    TZ=UTC \
    JAVA_TOOL_OPTIONS="-Xms256m -Xmx512m -XX:MaxMetaspaceSize=192m -XX:ReservedCodeCacheSize=96m -Xss512k -XX:+UseSerialGC -XX:+ExitOnOutOfMemoryError"
RUN useradd --system --uid 10001 --home /app falconx && mkdir -p /app /data/storage && chown -R falconx /app /data
COPY backend/target/falconx-lite-*.jar /app/app.jar
USER falconx
WORKDIR /app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
