#!/bin/bash
# 回滚：更新 .env 的 IMAGE_TAG 到指定版本，重启容器
# 用法: ./rollback.sh          → 列出可用版本并交互选择
#       ./rollback.sh v0.10    → 直接回滚到 v0.10
#       ./rollback.sh --list   → 列出所有可用版本
#       不篡改任何镜像标签——v0.10 永远代表 v0.10
set -e
cd "$(dirname "$0")"

if [ "${1}" = "--list" ]; then
    echo "=== 可用版本 ==="
    docker images attendance-module --format "  {{.Tag}}" | grep -v latest | sort -V
    echo ""
    echo "当前运行: $(grep IMAGE_TAG .env 2>/dev/null | cut -d= -f2 || echo 'unknown')"
    exit 0
fi

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
    echo "=== 可用版本 ==="
    docker images attendance-module --format "  {{.Tag}}" | grep -v latest | sort -V
    echo ""
    echo "用法: ./rollback.sh v0.10"
    echo "      ./rollback.sh --list"
    exit 1
fi

TARGET="v${TARGET#v}"

# 检查镜像存在
if ! docker image inspect "attendance-module:${TARGET}" >/dev/null 2>&1; then
    echo "错误: 镜像 attendance-module:${TARGET} 不存在"
    echo "可用版本:"
    docker images attendance-module --format "  {{.Tag}}" | grep -v latest | sort -V
    exit 1
fi

PREV=$(grep IMAGE_TAG .env 2>/dev/null | cut -d= -f2 || echo "latest")
echo "=== 回滚 ==="
echo "当前: ${PREV}"
echo "目标: ${TARGET}"

# 更新 .env —— 不重新构建，不篡改任何镜像标签
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${TARGET}/" .env
docker compose up -d

echo ""
echo "=== 回滚完成: attendance-module:${TARGET} ==="
echo "v0.10、v0.12 等标签永远指向各自的原始构建，互不覆盖。"
