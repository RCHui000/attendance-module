# 云端发布与运维 Runbook

本文档是云端发布、部署、验证和回滚的权威入口。旧版 `ALIYUN_DEPLOYMENT.md`、`CLOUD_DEPLOY_CHECKLIST.md`、`DEVOPS_RELEASE_RUNBOOK.md`、`RELEASE_PROCESS.md` 已归档到 `docs/archive/`。

## 生产目标

- Repository: `RCHui000/attendance-module`
- Default branch: `main`
- Production URL: `https://xpjs.asia/`
- Cloud app directory: `/opt/approval-app/app`
- Cloud env file: `/opt/approval-app/env/production.env`
- Cloud backup directory: `/opt/approval-app/backups`

`/opt/approval-app/app` 不是 git checkout。生产发布应上传 tag 对应源码包并覆盖应用目录，不在服务器上直接 `git pull`。

## 目录与环境

云服务器统一使用：

```text
/opt/approval-app/
  app/
  data/postgres/
  backups/
  logs/
  nginx/
  env/
```

初始化目录：

```bash
sudo APP_ROOT=/opt/approval-app bash deploy/scripts/init-aliyun-dirs.sh
```

生产环境变量从示例文件创建，但真实值只在服务器维护：

```bash
cp .env.production.example /opt/approval-app/env/production.env
chmod 600 /opt/approval-app/env/production.env
```

不要复制 NAS 的真实 `.env`，不要在文档、日志或 release notes 中粘贴生产密钥。

## 标准发布流程

1. 根据最新 `V*` tag 选择目标版本，通常递增 patch。
2. 检查工作区，只纳入有意改动。
3. 更新或新增 `release-manifest/<version>.json`。
4. 本地运行：

```powershell
git diff --check
npm --prefix frontend run build
```

5. 发布前运行安全门禁：

```bash
bash deploy/scripts/verify-jwt-keys.sh
bash deploy/scripts/pre-deploy-check.sh
```

6. 函数/RPC 权限有变化时运行：

```bash
psql < scripts/audit-public-function-grants.sql
psql < scripts/assert-function-grants.sql
```

7. 提交 release 变更，创建并推送 tag。
8. 创建 GitHub release。
9. 上传源码包和预构建 `frontend/dist` 到云服务器。
10. 部署后执行版本、前端渲染、容器健康和业务冒烟检查。

## 前端生产构建

服务器当前不依赖 Node/npm 构建前端。发布前在本地用生产 `VITE_*` 构建 `frontend/dist`，再单独打包上传。缺少 `VITE_SUPABASE_ANON_KEY` 会导致部署成功但前端空白。

推荐流程：

```powershell
$version = "V0.16.48"
$env:VITE_APP_VERSION = $version
$env:APP_IMAGE_TAG = $version
$env:IMAGE_TAG = $version
npm --prefix frontend run build
```

如需从服务器生产 env 临时读取构建变量，只加载 `VITE_`、`APP_IMAGE_TAG`、`IMAGE_TAG`，构建后删除临时 env 文件。

## 云端部署

生产 compose 使用 `docker-compose.aliyun.yml`，公网只暴露 80、443 和 SSH。不要在公网环境使用 NAS compose 组合暴露 Postgres、PostgREST、GoTrue、Realtime 或内部应用端口。

部署脚本入口：

```bash
APP_IMAGE_TAG=<version> VITE_APP_VERSION=<version> bash deploy/scripts/deploy-aliyun.sh
```

如果云端没有 Node/npm，先同步本地构建好的 `frontend/dist`，再使用：

```bash
SKIP_FRONTEND_BUILD=1 APP_IMAGE_TAG=<version> VITE_APP_VERSION=<version> bash deploy/scripts/deploy-aliyun.sh
```

只构建 `app` 服务。除非必要，不要在云端执行全服务 `docker compose build`。

## 上线检查清单

- [ ] 域名 A 记录和 `SITE_URL` / `GOTRUE_SITE_URL` / `API_EXTERNAL_URL` 指向正式域名。
- [ ] SSH、Docker、Docker Compose 可用。
- [ ] `/opt/approval-app/app`、`/opt/approval-app/env/production.env`、持久化数据目录已就绪。
- [ ] 80、443 开放；Postgres、PostgREST、GoTrue、Realtime 未公网暴露。
- [ ] HTTPS 证书可用，续期 dry-run 通过。
- [ ] `JWT_SECRET`、`POSTGRES_PASSWORD`、`DEFAULT_INITIAL_PASSWORD`、`DB_ENC_KEY` 已按生产要求设置。
- [ ] `ANON_KEY` 与 `SERVICE_ROLE_KEY` 由同一个 `JWT_SECRET` 生成。
- [ ] 数据库迁移已按顺序执行，备份脚本和恢复流程已验证。
- [ ] 管理员账号、弱密码和测试账号已按 [ACCOUNT_SECURITY_RUNBOOK.md](ACCOUNT_SECURITY_RUNBOOK.md) 检查。
- [ ] `deploy/scripts/pre-deploy-check.sh`、`deploy/scripts/verify-jwt-keys.sh`、函数权限检查通过。

## 发布后验证

```powershell
$env:EXPECTED_VERSION = "<version>"
$env:E2E_BASE_URL = "https://xpjs.asia/"
node scripts/smoke-frontend-render.mjs
```

审批或周表相关变更还应运行：

```bash
docker exec -i approval-postgres psql -U psa_admin -d psa < /opt/approval-app/app/scripts/smoke-timesheet-withdraw.sql
```

健康信号：

- `approval-app` 为 `Up` 且 healthy；
- `approval-nginx` 为 `Up`；
- 前端 smoke 能看到页面文本和期望版本；
- `pre-deploy-check.sh` 通过；
- 没有前端空白页。

## 备份与回滚

手动数据库备份：

```bash
bash deploy/scripts/backup-postgres.sh
```

推荐 cron：

```cron
0 3 * * * APP_ROOT=/opt/approval-app /opt/approval-app/app/deploy/scripts/backup-postgres.sh >> /opt/approval-app/logs/backup.log 2>&1
```

恢复前确认目标环境和维护窗口：

```bash
bash deploy/scripts/restore-postgres.sh /opt/approval-app/backups/postgres-YYYY-MM-DD-HHMMSS.sql
```

优先回滚到上一个稳定镜像 tag：

```bash
cd /opt/approval-app/app
sed -i "s/^APP_IMAGE_TAG=.*/APP_IMAGE_TAG=<previous-version>/" /opt/approval-app/env/production.env
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=<previous-version>/" /opt/approval-app/env/production.env
sed -i "s/^VITE_APP_VERSION=.*/VITE_APP_VERSION=<previous-version>/" /opt/approval-app/env/production.env
docker compose --env-file /opt/approval-app/env/production.env -f docker-compose.aliyun.yml up -d app nginx
```

只有在代码覆盖本身需要回退时，才恢复备份的 app 目录。任何破坏性恢复前，先确认目标路径正是 `/opt/approval-app/app`。

## 已知风险

- 前端空白页通常是生产 `VITE_*` 缺失。
- 服务器 app 目录不是 git checkout。
- 迁移执行异常时，先检查 migration ledger，不要盲目重跑旧迁移。
- 生产密钥、SSH key 和 `.env` 内容不得进入仓库。
