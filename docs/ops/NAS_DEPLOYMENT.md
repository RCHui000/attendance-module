# NAS / 本地部署补充

本文档记录 NAS 连接、路径、端口和常用运维命令。旧版 `NAS_DOCKER.md` 与 `nas连接方式.md` 已归档到 `docs/archive/`。

## 连接与路径

常用 NAS SSH alias：

```bash
ssh inquiry-nas
```

如果本机没有 alias，在用户级 SSH config 中维护 Host、User、Port、IdentityFile。不要把密码、私钥、token 或 `.env` 敏感值写进仓库。

主要路径：

```text
/vol1/@team/个人工作文件/惠若超/attendance-module
/vol1/@team/个人工作文件/惠若超/supabase-psa
```

环境变量文件：

```text
/vol1/@team/个人工作文件/惠若超/attendance-module/frontend/.env.production
/vol1/@team/个人工作文件/惠若超/attendance-module/.env
```

## 访问入口

```text
反向代理入口: http://192.168.2.100:8080
旧 Web 直连:   http://192.168.2.100:8767
GoTrue:        http://192.168.2.100:8777
Realtime:      http://192.168.2.100:8778
PostgREST:     http://192.168.2.100:8779
Postgres:      192.168.2.100:5433
```

## 构建与启动

```bash
cd /vol1/@team/个人工作文件/惠若超/attendance-module
npm --prefix frontend ci
npm --prefix frontend run build
docker compose build
docker compose up -d
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
ssh inquiry-nas "docker ps --format '{{.Names}} {{.Status}} {{.Ports}}' | grep -E 'attendance-module|psa-reverse-proxy|psa-postgrest|psa-gotrue|psa-realtime|psa-postgres'"
```

重启应用：

```bash
ssh inquiry-nas "cd '/vol1/@team/个人工作文件/惠若超/attendance-module' && docker compose up -d --build attendance-module"
```

重启反向代理：

```bash
ssh inquiry-nas "cd '/vol1/@team/个人工作文件/惠若超/attendance-module' && docker compose -f docker-compose.proxy.yml up -d"
```

重启 PostgREST：

```bash
ssh inquiry-nas "cd '/vol1/@team/个人工作文件/惠若超/supabase-psa' && docker compose restart postgrest"
```

同步前端构建产物：

```bash
cd frontend
npm run build
cd ..
ssh inquiry-nas "rm -rf '/vol1/@team/个人工作文件/惠若超/attendance-module/frontend/dist'/* && mkdir -p '/vol1/@team/个人工作文件/惠若超/attendance-module/frontend/dist/assets' '/vol1/@team/个人工作文件/惠若超/attendance-module/frontend/dist/logo'"
scp -r frontend/dist/* inquiry-nas:"/vol1/@team/个人工作文件/惠若超/attendance-module/frontend/dist/"
```

## 安全注意事项

- 不提交 `.env`、`.env.*`、`*.pem`、`*.key`。
- 不在本文档记录服务器密码、Supabase 密码或生产 token。
- 服务器账号、端口或密钥路径优先放入本机 ignored 文件或用户级 SSH config。
- NAS compose 可暴露内部服务端口，仅限受控内网；公网部署必须使用云端发布 Runbook。
