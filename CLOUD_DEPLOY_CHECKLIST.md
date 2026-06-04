# 阿里云预生产上线检查清单

## 域名
- [ ] 域名实名认证通过
- [ ] A 记录指向 ECS 公网 IP
- [ ] www A 记录指向 ECS 公网 IP
- [ ] `SITE_URL`、`GOTRUE_SITE_URL`、`API_EXTERNAL_URL` 已使用正式域名

## 服务器
- [ ] SSH 可以登录
- [ ] Docker 已安装
- [ ] Docker Compose 已安装
- [ ] 代码目录位于 `/opt/approval-app/app`
- [ ] 环境变量文件位于 `/opt/approval-app/env/production.env`
- [ ] 已执行 `deploy/scripts/init-aliyun-dirs.sh`

## 安全组 / 防火墙
- [ ] 80 已开放
- [ ] 443 已开放
- [ ] SSH 端口只允许可信来源或已改为非默认策略
- [ ] Postgres 未公网暴露
- [ ] PostgREST 未公网暴露
- [ ] GoTrue 未公网暴露
- [ ] Realtime 未公网暴露
- [ ] Docker 内部服务只通过 Nginx 访问
- [ ] 未使用会公网暴露 `5433/8777/8778/8779/8767` 的 NAS compose 配置

## HTTPS
- [ ] Certbot 已安装或证书来源已确认
- [ ] Let's Encrypt 证书申请成功
- [ ] HTTP 自动跳转 HTTPS
- [ ] `certbot renew --dry-run` 成功
- [ ] 证书目录已持久化到 `/opt/approval-app/nginx/letsencrypt`

## 环境变量
- [ ] 生产 `.env` 已从 `.env.production.example` 创建
- [ ] 未从 NAS 直接复制真实 `.env`
- [ ] `JWT_SECRET` 已更换
- [ ] `POSTGRES_PASSWORD` 已更换
- [ ] `ANON_KEY` 与 `SERVICE_ROLE_KEY` 已由同一个 `JWT_SECRET` 生成
- [ ] `DEFAULT_INITIAL_PASSWORD` 已设置为强密码
- [ ] `DB_ENC_KEY` 为 16 字符
- [ ] CORS 只允许正式域名
- [ ] 前端 `VITE_SUPABASE_*` 使用同源代理或正式域名

## 数据
- [ ] Postgres 使用宿主机持久化目录 `/opt/approval-app/data/postgres`
- [ ] 数据库初始化迁移已按顺序执行
- [ ] 数据库迁移版本已记录，当前至少覆盖到 `023`
- [ ] `deploy/scripts/backup-postgres.sh` 可运行
- [ ] 已配置每日凌晨备份 cron
- [ ] 已测试恢复流程
- [ ] 恢复后系统可登录
- [ ] 备份文件有保留周期和磁盘空间告警
- [ ] 备份文件有异地副本或下载归档策略

## 账号
- [ ] 管理员账号已列出
- [ ] 不需要 admin 的账号已降权
- [ ] 管理员密码已重置
- [ ] 默认密码仅用于首次登录
- [ ] 弱密码账号已处理
- [ ] 测试账号已准备并标记用途

## 部署
- [ ] 当前 GitHub tag 已确认
- [ ] `docker-compose.aliyun.yml` 已通过 `docker compose config`
- [ ] `deploy/nginx/app.conf` 已替换正式域名
- [ ] `deploy/scripts/deploy-aliyun.sh` 完整跑通
- [ ] `docker compose ps` 全部核心服务为 healthy 或 running
- [ ] 应用、Nginx、PostgREST、GoTrue、Realtime 日志可查看
- [ ] Playwright 冒烟测试已设置 `E2E_BASE_URL=https://正式域名`

## 回滚
- [ ] 上线前数据库备份点已确认
- [ ] 当前应用镜像 tag 已确认
- [ ] 上一个稳定 Git tag 已确认
- [ ] 回滚命令已记录
- [ ] 回滚后冒烟测试流程已准备
