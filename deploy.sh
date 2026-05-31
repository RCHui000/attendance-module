#!/bin/bash
# 部署：构建镜像 → 打版本标签 → 更新容器
# 用法: ./deploy.sh V0.11
set -e
cd "$(dirname "$0")"

VERSION="${1:-latest}"
if [ "$VERSION" != "latest" ]; then
    VERSION="v${VERSION#v}"
fi

echo "=== 部署 attendance-module:${VERSION} ==="

# 1. 构建新镜像
docker compose build
docker tag attendance-module:latest "attendance-module:${VERSION}"

# 2. 记录当前版本（用于回滚）
PREV=$(cat .current-version 2>/dev/null || echo "none")
echo "$VERSION" > .current-version
echo "上一版本: $PREV"
echo "当前版本: $VERSION"

# 3. 启动
docker compose up -d

echo ""
echo "=== 部署完成 ==="
echo "回滚到上一版本: ./rollback.sh"
echo "回滚到指定版本: ./rollback.sh V0.10"
