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

当前 NAS Docker socket 为 `root:docker`，`Huiruochao` 用户需要 sudo 或加入 docker 组后才能执行 `docker compose build/up`。

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
/home/Huiruochao/deploy/attendance-module/frontend/.env.production
/home/Huiruochao/deploy/attendance-module/.env
```

## 访问入口

```text
Web 直连: http://192.168.31.142:8767
```

## 构建与启动

```bash
cd /home/Huiruochao/deploy/attendance-module
npm --prefix frontend ci
npm --prefix frontend run build
sudo docker compose build
sudo docker compose up -d
```

应用容器默认通过 Nginx 服务静态 React 产物，并连接自托管 Supabase 运行栈。

## 数据库迁移

使用 ledger-aware 脚本按顺序执行 `supabase-psa/migrations/`：

```bash
POSTGRES_CONTAINER_NAME=psa-postgres POSTGRES_USER=psa_admin POSTGRES_DB=psa \
  bash deploy/scripts/apply-migrations.sh
```

临时执行单个迁移时，可通过 SSH 管道进入 Postgres 容器，但应优先使用迁移脚本保留 ledger。

## 常用命令

查看容器状态：

```bash
ssh home-nas "sudo docker ps --format '{{.Names}} {{.Status}} {{.Ports}}' | grep -E 'attendance-module|psa-reverse-proxy|psa-postgrest|psa-gotrue|psa-realtime|psa-postgres'"
```

重启应用：

```bash
ssh home-nas "cd /home/Huiruochao/deploy/attendance-module && sudo docker compose up -d --build attendance-module"
```

重启反向代理：

```bash
ssh home-nas "cd /home/Huiruochao/deploy/attendance-module && sudo docker compose -f docker-compose.proxy.yml up -d"
```

重启 PostgREST：

```bash
ssh home-nas "cd /home/Huiruochao/deploy/supabase-psa && sudo docker compose restart postgrest"
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
