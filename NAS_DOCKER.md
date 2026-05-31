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
cd /vol1/@team/个人工作文件/惠若超/attendance-module
git pull origin main
```

### 2. 部署新版本

```bash
./deploy.sh V0.11
```

脚本会自动：构建镜像 → 打版本标签 → 启动容器 → 记录当前版本。

首次使用需先给脚本执行权限：`chmod +x deploy.sh rollback.sh`

### 3. 查看日志

```bash
docker logs -f attendance-module
```

### 4. 更新到新版本

```bash
git pull origin main
./deploy.sh V0.12
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

## 回滚

### 回滚到上一版本

```bash
./rollback.sh
```

### 回滚到指定版本

```bash
./rollback.sh V0.10
```

### 查看所有可用版本

```bash
./rollback.sh --list
```

回滚秒级完成——不重新构建，只切换镜像标签然后重启容器。

## 版本管理

| 层级 | 工具 | 作用 |
|------|------|------|
| 源码版本 | Git + GitHub | 代码变更记录、分支协作、blame 溯源 |
| 发布版本 | Git Tags (`V0.01`, `V0.10`...) | 标记每个稳定版本，对应 MR/PR |
| 运行时版本 | Docker 镜像标签 (`v0.10`, `v0.11`...) | 生产环境快速回滚，审计 `docker images` |

三者配合：Git 管源码历史，Tag 管发布节点，Docker 镜像管运行时回滚。

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
