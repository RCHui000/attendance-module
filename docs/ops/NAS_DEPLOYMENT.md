# NAS / 本地部署补充

本文档记录 NAS 连接、路径、端口和常用运维命令。旧版 `NAS_DOCKER.md` 与 `nas连接方式.md` 已归档到 `docs/archive/`。

## 连接与路径

优先从 `agentctx` 读取当前 NAS 测试环境上下文：

```powershell
agentctx show --target nas-test
```

当前 `nas-test` 目标解析到：

```text
SSH alias: home-nas
应用目录: /home/Huiruochao/deploy/attendance-module
Supabase 目录: /home/Huiruochao/deploy/supabase-psa
访问入口: http://192.168.31.142:8767
```

当前 NAS Docker socket 为 `root:docker`，`Huiruochao` 已加入 `docker` 组，可直接执行 `docker` / `docker compose`。

旧办公室 NAS 连接信息仍保留在归档文档中，仅在明确切回办公室 NAS 时使用。

常用 NAS SSH alias：

```bash
ssh home-nas
```

如果本机没有 alias，在用户级 SSH config 中维护 Host、User、Port、IdentityFile。不要把密码、私钥、token 或 `.env` 敏感值写进仓库。

主要路径：

```text
/home/Huiruochao/deploy/attendance-module
/home/Huiruochao/deploy/supabase-psa
```

环境变量文件：

```text
/home/Huiruochao/deploy/attendance-module/.env
/home/Huiruochao/deploy/supabase-psa/.env
```

这些 `.env` 文件必须是 Linux LF 换行。若从 Windows 生成或同步，先在 NAS 上执行 `sed -i 's/\r$//' .env`，否则 Docker Compose 可能把 `POSTGRES_USER` 解析成带 `\r` 的值，导致 Realtime 或 PostgREST 认证失败。

## 访问入口

```text
Web 直连: http://192.168.31.142:8767
GoTrue:   http://192.168.31.142:8777
Realtime: http://192.168.31.142:8778
PostgREST:http://192.168.31.142:8779
Postgres: 192.168.31.142:5433
```

## 构建与启动

```bash
cd /home/Huiruochao/deploy/attendance-module
npm --prefix frontend ci
npm --prefix frontend run build
docker compose build
docker compose up -d
```

应用容器默认通过 Nginx 服务静态 React 产物，并连接自托管 Supabase 运行栈。

首次部署 Supabase 栈时建议顺序：

```bash
cd /home/Huiruochao/deploy/supabase-psa
docker compose build postgres
docker compose up -d postgres gotrue realtime postgrest

cd /home/Huiruochao/deploy/attendance-module
MIGRATIONS_DIR=/home/Huiruochao/deploy/supabase-psa/migrations \
POSTGRES_CONTAINER_NAME=psa-postgres POSTGRES_USER=postgres POSTGRES_DB=psa \
  bash deploy/scripts/apply-migrations.sh
```

Realtime 需要 `psa-postgres:16-alpine-wal2json` 中存在 `wal2json.so`。如果 NAS 无法从 Docker Hub 拉镜像，可在本机用镜像源拉成 tar 后上传：

```bash
crane pull docker.1panel.live/supabase/realtime:v2.30.34 realtime-v2.30.34.tar
scp realtime-v2.30.34.tar home-nas:/home/Huiruochao/deploy/
ssh home-nas "docker load -i /home/Huiruochao/deploy/realtime-v2.30.34.tar && docker tag docker.1panel.live/supabase/realtime:v2.30.34 supabase/realtime:v2.30.34"
```

## 数据库迁移

使用 ledger-aware 脚本按顺序执行 `supabase-psa/migrations/`：

```bash
MIGRATIONS_DIR=/home/Huiruochao/deploy/supabase-psa/migrations \
POSTGRES_CONTAINER_NAME=psa-postgres POSTGRES_USER=postgres POSTGRES_DB=psa \
  bash deploy/scripts/apply-migrations.sh
```

脚本使用 `public.psa_schema_migrations` 作为应用迁移 ledger，避免和 GoTrue / Realtime 使用的 `public.schema_migrations` 冲突。临时执行单个迁移时，可通过 SSH 管道进入 Postgres 容器，但应优先使用迁移脚本保留 ledger。

## 常用命令

查看容器状态：

```bash
ssh home-nas "docker ps --format '{{.Names}} {{.Status}} {{.Ports}}' | grep -E 'attendance-module|psa-reverse-proxy|psa-postgrest|psa-gotrue|psa-realtime|psa-postgres'"
```

重启应用：

```bash
ssh home-nas "cd /home/Huiruochao/deploy/attendance-module && docker compose up -d --build attendance-module"
```

重启反向代理：

```bash
ssh home-nas "cd /home/Huiruochao/deploy/attendance-module && docker compose -f docker-compose.proxy.yml up -d"
```

重启 PostgREST：

```bash
ssh home-nas "cd /home/Huiruochao/deploy/supabase-psa && docker compose restart postgrest"
```

冒烟检查：

```bash
ssh home-nas "curl -fsS http://127.0.0.1:8767/ >/dev/null && curl -fsS http://127.0.0.1:8767/auth/health && curl -fsS http://127.0.0.1:8767/rest/ >/dev/null"
ssh home-nas "cd /home/Huiruochao/deploy/supabase-psa && docker compose ps"
```

同步前端构建产物：

```bash
cd frontend
npm run build
cd ..
ssh home-nas "mkdir -p /home/Huiruochao/deploy/attendance-module/frontend/dist"
scp -r frontend/dist/* home-nas:/home/Huiruochao/deploy/attendance-module/frontend/dist/
```

## 安全注意事项

- 不提交 `.env`、`.env.*`、`*.pem`、`*.key`。
- 不在本文档记录服务器密码、Supabase 密码或生产 token。
- 服务器账号、端口或密钥路径优先放入本机 ignored 文件或用户级 SSH config。
- NAS compose 可暴露内部服务端口，仅限受控内网；公网部署必须使用云端发布 Runbook。
