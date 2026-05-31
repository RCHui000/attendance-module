# 考勤统计模块 NAS 部署说明

## 访问地址

```text
http://192.168.2.100:8767
```

## NAS 部署目录

```text
/vol1/@team/个人工作文件/惠若超/attendance-module
```

## 前端技术栈

新前端使用 **React 18 + TypeScript + shadcn/ui + Tailwind CSS**，源码在 `frontend/` 目录。
Docker 构建时通过多阶段构建自动编译为静态文件，无需在 NAS 上安装 Node.js。

## 部署步骤

### 1. 同步代码到 NAS

```bash
# 将本地代码推送到 git，然后在 NAS 上 pull
# 或者直接用 rsync/scp 同步整个项目目录到 NAS
```

### 2. 构建并启动（Docker）

```bash
cd /vol1/@team/个人工作文件/惠若超/attendance-module
docker compose up -d --build
```

首次构建会执行：
1. **Stage 1** (node:22-alpine): 安装 `frontend/` 的 npm 依赖并执行 `npm run build`，产出 `frontend/dist/`
2. **Stage 2** (python:3.12-slim): 安装 FastAPI/uvicorn，复制 Python 代码 + 旧 `static/` + 新 `frontend/dist/`

启动后 FastAPI (uvicorn) 会在 `0.0.0.0:8767` 提供服务。

### 3. 查看日志

```bash
docker logs -f attendance-module
```

### 4. 更新部署

```bash
cd /vol1/@team/个人工作文件/惠若超/attendance-module
git pull   # 拉取最新代码
docker compose up -d --build   # 重新构建并重启
```

## Docker Compose

```yaml
services:
  attendance-module:
    build: .
    container_name: attendance-module
    restart: unless-stopped
    environment:
      TZ: Asia/Shanghai
      ATTENDANCE_HOST: 0.0.0.0
      ATTENDANCE_PORT: 8767
      ATTENDANCE_DB_PATH: /data/attendance_demo.sqlite3
    ports:
      - "8767:8767"
    volumes:
      - ./data:/data
```

## 持久化

数据库文件：
```text
./data/attendance_demo.sqlite3
```

## 容器内运行架构

```
                 ┌────────────────────────┐
  Browser        │  Docker: attendance-module      │
                 │                        │
  GET /      ───┤→ frontend/dist/index.html   │  ← React SPA (新前端)
  GET /assets/* ─┤→ frontend/dist/assets/      │  ← JS/CSS chunks
  GET /api/*  ───┤→ FastAPI routes             │  ← Python 后端
  GET /ws/sync ──┤→ WebSocket hub              │  ← 实时同步
                 │                        │
                 │  (static/ 保留作为旧前端兜底)  │
                 └────────────────────────┘
```

## 新旧前端并存

- **新前端** (`frontend/dist/`)：默认入口，React + shadcn/ui
- **旧前端** (`static/`)：保留在容器中，如果 `frontend/dist/` 不存在则自动回退到旧版

## 故障排查

### 前端构建失败
```bash
# 在本地验证
cd frontend && npm ci && npm run build
# 确认 dist/ 目录正常产出
ls -la dist/
```

### 容器无法启动
```bash
docker compose logs attendance-module
```

### 数据库
如果数据库文件损坏或丢失，容器启动时会自动创建空库并写入种子数据（3 个用户、10 个项目、1 个部门）。
