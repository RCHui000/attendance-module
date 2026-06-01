# v4-flash 子任务清单：Supabase 生产级部署审计

## 背景

当前主线目标是：考勤统计模块必须面向生产级部署，运行态完整基于 Supabase 技术栈，不再依赖 FastAPI、Flask、SQLite 或旧本地文件数据库。

当前生产路径：

- 前端：React + Vite 静态包
- 应用容器：静态文件服务，端口 `8767 -> 80`
- 认证：Supabase GoTrue，端口 `8777`
- 数据访问：PostgREST，端口 `8779`
- 数据库：Supabase Postgres
- 关键迁移：`supabase-psa/migrations/004_full_supabase_runtime.sql`

请把自己当成低风险审计/测试子代理。不要自行部署，不要连接 NAS，不要重写核心架构，不要引入新的后端框架。

## 严格禁止

1. 不要恢复、引用或新增 FastAPI、Flask、SQLite、本地 `.sqlite3` 数据库运行态。
2. 不要把 `service_role` key、数据库密码、NAS 密码写入前端代码、文档或日志。
3. 不要修改 `Dockerfile`、`docker-compose.yml`、`supabase-psa/migrations/*.sql` 的核心逻辑，除非只是在报告里提出补丁建议。
4. 不要删除现有业务功能、路由或类型定义。
5. 不要把浏览器端 API 重新改回服务器 `/api/*` 请求。

## 你可以做的工作

### 1. 残留审计

扫描仓库源码，确认是否还有旧运行态残留。

重点关键词：

```text
fastapi
uvicorn
flask
sqlite
sqlite3
attendance_demo
ATTENDANCE_DB_PATH
fastapi_app
legacy
/ws
```

要求：

- 排除 `node_modules`、`frontend/dist`。
- 如果命中的是依赖包 hash、历史备份目录或说明性文字，要标注为“非运行态残留”。
- 输出一张表：`文件 | 行号 | 命中内容 | 是否需要处理 | 原因`。

### 2. 前端 Supabase API 适配层审计

重点阅读：

- `frontend/src/lib/api.ts`
- `frontend/src/lib/supabase.ts`
- `frontend/src/stores/authStore.ts`
- `frontend/src/hooks/useTimesheet.ts`
- `frontend/src/hooks/useApprovals.ts`
- `frontend/src/hooks/useEmployees.ts`
- `frontend/src/hooks/useReport.ts`

检查项：

- 是否所有业务请求最终都走 GoTrue/PostgREST。
- 是否存在把密钥写死到前端源码的风险。
- 登录、登出、改密、周表保存、提交、审批、报表、项目、组织、员工接口是否都有对应实现。
- 是否有明显的空值、类型、并发或状态流转问题。

只输出审计结论和建议，不要直接大改。

### 3. RLS 与迁移审计

重点阅读：

- `supabase-psa/migrations/001_v0.11_schema.sql`
- `supabase-psa/migrations/002_v0.11_rls.sql`
- `supabase-psa/migrations/003_v0.11_policies_fk_fixes.sql`
- `supabase-psa/migrations/004_full_supabase_runtime.sql`

检查项：

- 哪些表开启了 RLS。
- 哪些表允许 authenticated 读写。
- `workflow_tasks`、`approval_logs`、`timesheets`、`timesheet_entries`、`overtime_entries` 的写权限是否过宽。
- `004` 是否重复执行安全；如果不安全，列出会失败的 policy/constraint/function/sequence 项。
- 是否存在前端可越权操作其他员工数据的风险。

输出格式：

```markdown
## RLS Findings
- [P0/P1/P2] 问题标题
  文件：...
  风险：...
  建议：...
```

### 4. 生产验收清单草案

编写一份只读验收 checklist，供主代理或人工在 NAS 上执行。

至少覆盖：

- 容器状态
- HTTP 健康检查
- GoTrue 登录
- PostgREST schema cache
- 周表保存
- 周表提交
- 项目经理审批
- 部门经理审批
- 项目经理=部门经理时只生成一道审批
- 审批通过后从待审核移到已审核
- 报表统计不重复
- 刷新和深链接 `/dashboard` 可用
- 浏览器缓存旧 `/ws/sync` 不影响新版本

不要包含真实密码。

### 5. 文档改进建议

检查：

- `PRD.md`
- `NAS_DOCKER.md`
- `release-manifest/V0.12.json`

输出：

- 哪些地方还不够生产化。
- 哪些地方缺部署步骤、回滚步骤、备份步骤。
- 哪些地方应该补充“禁止把 service key 放前端”的说明。

如果要给补丁建议，只给小块 diff，不要整篇重写。

## 交付物

请输出一个 Markdown 报告，建议文件名：

```text
subagent-report-v4-flash.md
```

报告结构：

```markdown
# v4-flash 审计报告

## 结论摘要

## P0 必须处理

## P1 上线前建议处理

## P2 后续优化

## 残留扫描结果

## RLS Findings

## 前端 API 适配层 Findings

## 生产验收 Checklist

## 建议交给主代理处理的事项
```

## 分工边界

你可以负责：

- 搜索、阅读、总结
- 编写审计报告
- 编写只读测试/验收 checklist
- 提出小补丁建议

主代理负责：

- 生产架构决策
- RLS/SQL 迁移实际修改
- NAS 部署与回滚
- 凭据处理
- 把前端业务写入逐步收敛到 Postgres RPC 或 Edge Function

## 当前主线已知高风险点

这些点请重点审计，但不要直接改：

1. 浏览器直连 PostgREST 写业务表，虽然 RLS 可控，但审批状态机不是数据库原子事务，生产级最好收敛为 Postgres RPC 或 Edge Function。
2. 员工新增只能维护业务员工资料，GoTrue 账号创建不能在前端安全完成，需要受控后台能力。
3. `004_full_supabase_runtime.sql` 已在 NAS 执行过，但需要确认重复执行和未来迁移链路是否可控。
4. 当前静态服务用 Python 标准库提供 SPA fallback，这是无业务状态的静态服务，不是 FastAPI；生产级可后续替换为预置 Nginx/Caddy 镜像或 NAS 原生静态站点。
