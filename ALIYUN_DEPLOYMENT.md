# 阿里云部署说明

## 目录结构

建议云服务器统一使用：

```text
/opt/approval-app/
  app/              # 代码
  data/             # 持久化数据
  data/postgres/    # 数据库数据
  backups/          # 数据库备份
  logs/             # 额外日志
  nginx/            # Nginx 证书与配置备份
  env/              # 生产环境 env 文件
```

初始化：

```bash
sudo APP_ROOT=/opt/approval-app bash deploy/scripts/init-aliyun-dirs.sh
```

## 环境变量

不要复制 NAS 的真实 `.env`。在服务器创建：

```bash
cp .env.production.example /opt/approval-app/env/production.env
chmod 600 /opt/approval-app/env/production.env
```

然后只在服务器上填写真实值。

## 部署

```bash
cd /opt/approval-app/app
bash deploy/scripts/deploy-aliyun.sh
```

脚本会执行：

- `git pull --ff-only`
- `npm --prefix frontend ci`
- `npm --prefix frontend run build`
- `docker compose --env-file ... -f docker-compose.aliyun.yml build`
- `docker compose --env-file ... -f docker-compose.aliyun.yml up -d`
- 输出容器状态和最近日志

## 端口原则

公网只暴露：

- 80
- 443
- SSH 端口

不要公网暴露：

- Postgres
- PostgREST
- GoTrue
- Realtime
- Docker 内部应用端口

`docker-compose.aliyun.yml` 默认只映射 Nginx 的 80/443，其他服务只在 Docker 内网访问。

不要在公网环境直接使用 NAS 版本的 `docker-compose.yml`、`docker-compose.proxy.yml`、`supabase-psa/docker-compose.yml` 组合；它们会把应用或 Supabase 内部端口映射到宿主机。

## 备份

手动备份：

```bash
bash deploy/scripts/backup-postgres.sh
```

推荐 cron：

```cron
0 3 * * * APP_ROOT=/opt/approval-app /opt/approval-app/app/deploy/scripts/backup-postgres.sh >> /opt/approval-app/logs/backup.log 2>&1
```

恢复前先确认目标环境，并准备维护窗口：

```bash
bash deploy/scripts/restore-postgres.sh /opt/approval-app/backups/postgres-YYYY-MM-DD-HHMMSS.sql
```

## 上线验收

按以下文件执行：

- `CLOUD_DEPLOY_CHECKLIST.md`
- `SMOKE_TEST.md`
- `ACCOUNT_SECURITY_RUNBOOK.md`

自动冒烟测试示例：

```bash
E2E_BASE_URL=https://your-domain.com npm --prefix frontend run test:e2e:prod
```
