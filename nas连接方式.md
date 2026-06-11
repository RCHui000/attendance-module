# NAS 连接方式

本文档只记录连接入口、项目路径和常用运维命令，不记录密码、私钥内容、token 或 `.env` 敏感值。

## SSH 连接

当前仓库常用的 NAS SSH alias：

```bash
ssh inquiry-nas
```

如果本机未配置 alias，需要在本机 SSH 配置中维护 NAS 的 Host、User、Port、IdentityFile 等信息。密钥文件和密码不要提交到 Git。

## 主要路径

应用代码路径：

```bash
/vol1/@team/个人工作文件/惠若超/attendance-module
```

Supabase 运行栈路径：

```bash
/vol1/@team/个人工作文件/惠若超/supabase-psa
```

前端生产环境变量文件：

```bash
/vol1/@team/个人工作文件/惠若超/attendance-module/frontend/.env.production
```

应用运行环境变量文件：

```bash
/vol1/@team/个人工作文件/惠若超/attendance-module/.env
```

## 访问入口

反向代理入口：

```text
http://192.168.2.100:8080
```

旧 Web 直连入口：

```text
http://192.168.2.100:8767
```

Supabase 内网服务端口：

```text
GoTrue:   8777
Realtime: 8778
PostgREST:8779
Postgres: 5433
```

## 常用命令

查看应用与代理容器状态：

```bash
ssh inquiry-nas "docker ps --format '{{.Names}} {{.Status}} {{.Ports}}' | grep -E 'attendance-module|psa-reverse-proxy|psa-postgrest|psa-gotrue|psa-realtime|psa-postgres'"
```

重启应用容器：

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

应用数据库迁移：

```bash
Get-Content supabase-psa\migrations\023_adaptive_approval_graph.sql | ssh inquiry-nas "docker exec -i psa-postgres psql -v ON_ERROR_STOP=1 -U psa_admin -d psa"
```

同步前端构建产物：

```bash
cd frontend
npm run build
cd ..
ssh inquiry-nas "rm -rf '/vol1/@team/个人工作文件/惠若超/attendance-module/frontend/dist'/* && mkdir -p '/vol1/@team/个人工作文件/惠若超/attendance-module/frontend/dist/assets' '/vol1/@team/个人工作文件/惠若超/attendance-module/frontend/dist/logo'"
scp -r frontend/dist/* inquiry-nas:"/vol1/@team/个人工作文件/惠若超/attendance-module/frontend/dist/"
```

## 版本检查

检查 NAS 前端环境版本号：

```bash
ssh inquiry-nas "grep -n '^VITE_APP_VERSION' '/vol1/@team/个人工作文件/惠若超/attendance-module/frontend/.env.production'"
```

检查反向代理首页：

```bash
curl -I http://192.168.2.100:8080/
```

## 安全注意事项

- 不要提交 `.env`、`.env.*`、`*.pem`、`*.key` 等密钥文件。
- 不要把 NAS、云服务器或 Supabase 的密码写入本文档。
- 若需要记录服务器账号、端口或密钥路径，优先放在本机 ignored 文件中，例如 `.env.aliyun.local` 或用户级 SSH config。
