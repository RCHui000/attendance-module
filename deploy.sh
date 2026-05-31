#!/bin/bash
# 部署新版本：构建镜像 → 打不可变版本标签 → 更新 .env → 启动
# 用法: ./deploy.sh V0.12
set -e
cd "$(dirname "$0")"

VERSION="${1:-latest}"
if [ "$VERSION" != "latest" ]; then
    VERSION="v${VERSION#v}"
fi

echo "=== 部署 attendance-module:${VERSION} ==="

# 1. 构建镜像
docker compose build

# 2. 打不可变版本标签（永远不覆盖）
docker tag attendance-module:latest "attendance-module:${VERSION}"
echo "镜像已标签: attendance-module:${VERSION}"

# 3. 更新 .env 指向新版本
PREV=$(grep IMAGE_TAG .env 2>/dev/null | cut -d= -f2 || echo "latest")
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${VERSION}/" .env
echo "版本切换: ${PREV} → ${VERSION}"

# 4. 启动
docker compose up -d

echo ""
echo "=== 部署完成 ==="
echo "当前运行: attendance-module:${VERSION}"
echo "回滚命令:  ./rollback.sh"
echo "指定回滚:  ./rollback.sh v0.10"
echo "查看版本:  ./rollback.sh --list"
