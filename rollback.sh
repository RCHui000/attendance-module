#!/bin/bash
# 回滚：切换到指定版本（默认上一版本）
# 用法: ./rollback.sh          → 回滚到上一版本
#       ./rollback.sh V0.10    → 回滚到指定版本
#       ./rollback.sh --list   → 列出所有可用版本
set -e
cd "$(dirname "$0")"

if [ "${1}" = "--list" ]; then
    echo "=== 本地可用版本 ==="
    docker images attendance-module --format "table {{.Tag}}\t{{.Size}}" | sort
    echo ""
    echo "当前运行: $(cat .current-version 2>/dev/null || echo 'unknown')"
    exit 0
fi

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
    # 默认：回退到 .rollback-target 或上一版本
    if [ -f .rollback-target ]; then
        TARGET=$(cat .rollback-target)
        rm .rollback-target
    else
        echo "未指定目标版本。用法: ./rollback.sh V0.10"
        echo "可用版本:"
        docker images attendance-module --format "  {{.Tag}}" | sort
        exit 1
    fi
fi

TARGET="v${TARGET#v}"

echo "=== 回滚到 attendance-module:${TARGET} ==="

# 检查镜像是否存在
if ! docker image inspect "attendance-module:${TARGET}" >/dev/null 2>&1; then
    echo "错误: 镜像 attendance-module:${TARGET} 不存在"
    echo "可用版本:"
    docker images attendance-module --format "  {{.Tag}}" | sort
    exit 1
fi

# 把目标版本设为 latest
docker tag "attendance-module:${TARGET}" attendance-module:latest
echo "$TARGET" > .current-version

# 重启容器
docker compose up -d

echo "=== 回滚完成: attendance-module:${TARGET} ==="
