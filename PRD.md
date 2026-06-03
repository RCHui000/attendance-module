# PSA 项目成本管理/考勤统计模块 PRD

版本：V0.12.1

更新日期：2026-06-01

当前状态：Supabase 全栈运行态，前端 SPA + Python 静态服务/受控代理

文档基线：`PRD_V0.12.md`，本文件为面向当前仓库实际状态的同步版。

## 1. 产品目标

建设内部项目成本与工时统计系统，统一管理员工周表、项目工时、组织架构、审批、加班、项目回款与人力成本统计。

V0.12 的主线目标是生产级 Supabase 运行态：

- 认证：Supabase GoTrue，使用 HS256 JWT。
- 数据：Supabase Postgres 16。
- 数据访问：PostgREST REST API + Postgres RPC。
- 前端：React 19 + TypeScript + Vite 8 静态 SPA。
- 服务容器：`python:3.12-slim` 托管 `frontend/dist`，提供 SPA fallback、`/auth/*` 与 `/rest/*` 代理，以及少量必须在服务端执行的安全端点。
- 部署：应用容器 `attendance-module` + `supabase-psa` 自托管服务栈。

明确不再使用 FastAPI、Flask、SQLite、本地文件数据库或旧 WebSocket 同步作为运行态。

## 2. 用户角色

| 角色 | 权限与主要任务 |
| --- | --- |
| 员工 | 登录系统，填写本人周表，保存草稿，提交审批，填写加班记录。 |
| 主管/项目负责人 | 查看分配给自己的审批任务，审批或退回周表与加班记录，查看项目工时统计。 |
| 管理员 | 维护员工、组织、项目资料，查看全部审批与统计，新增员工并创建 GoTrue 登录账号。 |

前端权限判断来自 `currentUser()` 返回的 `user_roles.role`，并额外将 `SUPERUSER_NAMES`、`SUPERUSER_IDS` 识别为超级管理员。

## 3. 核心业务规则

### 3.1 周表

- 每名员工每周只能有一张周表。
- 每天所有项目工时合计不得超过 1 工日。
- 周表状态机：`draft -> submitted -> approved/rejected`，管理员可 `reopen` 回 `draft`。
- `submitted`、`approved`、`locked` 状态下不可继续编辑周表明细。
- 周表保存仍由前端兼容层通过 PostgREST 写入：更新周表备注，删除旧明细，再插入新明细与加班记录。

### 3.2 加班

- 加班记录独立审批。
- 周表审批通过不代表加班自动通过。
- 加班审批通过或退回通过 `psa_overtime_action` RPC 完成。

### 3.3 审批

审批状态机已收敛到 Postgres RPC，不再由前端直接 PATCH 业务状态字段。

| RPC | 作用 |
| --- | --- |
| `psa_resolve_timesheet_assignees(p_timesheet_id)` | 解析项目负责人、部门负责人审批人。 |
| `psa_timesheet_action(p_timesheet_id, p_action, p_comment)` | 周表 `submit/approve/reject/reopen` 状态机。 |
| `psa_overtime_action(p_overtime_id, p_action, p_comment)` | 加班 `approve/reject` 状态机。 |

周表提交后按项目生成审批任务：

1. Stage 1：项目负责人，来自 `projects.project_owner_id`。
2. Stage 2：部门负责人，来自 `organizations.manager_user_id`。
3. 当项目负责人和部门负责人是同一人时，只生成一道审批任务。
4. 审批通过后当前任务移出待审核；所有任务完成后周表变为 `approved`。
5. 审批退回时当前任务完成，其余 pending 任务取消，周表变为 `rejected`。

## 4. 前端范围

当前前端是 React SPA，路由由 `react-router-dom` 管理。

| 页面 | 路由 | 说明 |
| --- | --- | --- |
| 登录页 | 未登录默认 | 登录、改密入口。 |
| 我的周表 | `/timesheet` | 员工填写项目工时与加班。普通员工默认进入此页。 |
| 总览 | `/dashboard` | 指标卡、项目汇总、分析图表。具备审核权限的用户默认进入此页。 |
| 审批中心 | `/review` | 待审核、已审核、加班审批和周表详情。 |
| 项目报表 | `/report` | 项目列表、项目 CRUD、项目明细与工时统计。 |
| 员工与组织 | `/employees` | 员工资料、组织部门、员工新增/编辑/停用。 |

技术栈：

- React 19 + TypeScript。
- Vite 8。
- Tailwind CSS v4 + shadcn/ui 风格组件。
- TanStack Query。
- Zustand。
- Recharts。
- Lucide React。

## 5. API 与运行态架构

前端继续保留 `api("/api/...")` 调用形态作为兼容层，但实际分流如下：

- 浏览器可安全执行的业务读取/写入：由 `frontend/src/lib/api.ts` 转换为 GoTrue/PostgREST/RPC 请求。
- 必须使用服务端能力的动作：走 `serve_spa.py` 的受控端点。
- 本地同源代理：`serve_spa.py` 将 `/auth/*` 转发到 GoTrue，将 `/rest/*` 转发到 PostgREST。

```text
Browser
  -> attendance-module (:8767)
       -> static SPA / SPA fallback
       -> /auth/* proxy -> GoTrue (:8777)
       -> /rest/* proxy -> PostgREST (:8779)
       -> /api/create-employee-with-login
       -> /api/change-password
  -> Supabase Postgres (:5433)
```

### 5.1 前端兼容层路径

| 前端路径 | 实际请求/实现 | 说明 |
| --- | --- | --- |
| `POST /api/login` | GoTrue `/token?grant_type=password` | 登录名映射为 `@psa.local` 邮箱。 |
| `POST /api/logout` | 清理本地 token | 纯前端退出。 |
| `POST /api/password/change` | 服务端 `/api/change-password` | 支持登录页和已登录改密。 |
| `GET /api/me` | PostgREST 当前员工查询 | 通过 JWT `sub` 找员工。 |
| `GET /api/bootstrap` | 当前用户 + 项目列表 | 初始化用户、项目、本周日期。 |
| `GET /api/timesheet` | PostgREST 平铺查询 | 周表、明细、加班。 |
| `GET /api/timesheet-detail` | PostgREST 平铺查询 | 审批详情页使用，绕过缺失 FK。 |
| `POST /api/timesheet/save` | PostgREST PATCH/DELETE/POST | 草稿/退回状态可保存。 |
| `POST /api/timesheet/action` | `/rpc/psa_timesheet_action` | 周表状态机。 |
| `GET /api/approvals/tasks` | PostgREST 多表平铺查询 | 全量待审/已审，不按周过滤。 |
| `POST /api/overtime/action` | `/rpc/psa_overtime_action` | 加班审批。 |
| `GET /api/overtime/pending` | `approvalTasks()` 的加班子集 | 兼容旧调用。 |
| `GET /api/employees` | `/hr_employee_current_view` + `user_roles` | 员工列表去重并读取真实角色。 |
| `POST /api/employees/save` | 新增走服务端，编辑走 PostgREST | 新增员工创建 GoTrue 账号。 |
| `POST /api/employees/delete` | PostgREST 软删除 | `employees.is_active=false`，资料状态 terminated。 |
| `GET /api/organizations` | PostgREST | 组织树与负责人名称。 |
| `POST /api/organizations/save/delete` | PostgREST | 新增、编辑、软删除组织。 |
| `GET /api/projects` | PostgREST 多表查询 | 项目列表、人力小时汇总。 |
| `POST /api/projects/save/delete` | PostgREST | 新增、编辑、软删除项目。 |
| `GET /api/reports/weekly` | PostgREST + JS 聚合 | 工时周/月/区间统计。 |
| `GET /api/project-detail` | PostgREST 平铺查询 | 项目下员工工时明细。 |

### 5.2 服务端受控端点

| 端点 | 方法 | 用途 |
| --- | --- | --- |
| `/api/create-employee-with-login` | POST | 管理员新增员工时创建 GoTrue 用户，并写入员工、资料、合同、薪资、角色等业务表。失败时尽量回滚 GoTrue 用户。 |
| `/api/change-password` | POST | 先校验旧密码，再调用 GoTrue 改密，并清除 `profiles.must_change_password`。 |
| `/auth/*` | 任意 | 同源代理到 GoTrue。 |
| `/rest/*` | 任意 | 同源代理到 PostgREST。 |

服务端使用短期自签 `service_role` JWT 调用 GoTrue Admin API 或 PostgREST。`JWT_SECRET` 与 `DEFAULT_INITIAL_PASSWORD` 必须来自运行环境，不得写入前端、Git、文档示例或日志。

## 6. 数据模型

核心 public schema：

| 表/视图 | 说明 | 当前备注 |
| --- | --- | --- |
| `profiles` | 登录名、GoTrue 邮箱、auth UUID 映射 | 含 `must_change_password`。 |
| `employees` | 员工主表 | 通过 `auth_user_id` 关联 GoTrue 用户。 |
| `employee_profiles_v2` | 组织归属、岗位、在职状态 | 管理员全权限策略由 migration 012 补强。 |
| `employee_contracts` | 合同档案 | `is_current` 标记当前合同。 |
| `employee_salary_profiles` | 薪资档案 | `is_current` 标记当前薪资。 |
| `user_roles` | 用户角色 | `employee/manager/admin`。 |
| `organizations` | 组织架构 | `manager_user_id` 为部门负责人。 |
| `projects` | 项目基础资料 | 包含负责人、合同金额、回款金额。 |
| `timesheets` | 周表 | 历史原因下 `user_id -> employees` FK 尚不完整。 |
| `timesheet_entries` | 周表明细 | 关联项目和周表。 |
| `overtime_entries` | 加班记录 | 独立审批。 |
| `workflow_tasks` | 审批任务 | 部分 FK 因历史数据不完整，前端使用平铺查询。 |
| `approval_logs` | 审批日志 | RPC 写入。 |
| `audit_logs` | 审计日志 | 预留/运行审计。 |
| `hr_employee_current_view` | 员工当前档案视图 | 用于员工列表去重。 |

已知边界：

- `timesheets.user_id -> employees.id` 与 `workflow_tasks.target_id -> timesheets.id` 的 FK 因历史孤儿数据尚未完全修复。
- 前端遇到缺失 FK 的场景统一使用平铺查询 + JS 关联，不使用 PostgREST 嵌入资源语法。

## 7. RLS 与数据库迁移

所有核心业务表已启用 RLS。权限判断主要通过：

- `current_employee_id()`
- `current_user_has_role(role_name)`
- `current_user_can_review()`

迁移文件按顺序执行：

| 序号 | 文件 | 说明 |
| --- | --- | --- |
| 001 | `001_v0.11_schema.sql` | 全量表结构、视图、基础约束。 |
| 002 | `002_v0.11_rls.sql` | 初始 RLS 策略。 |
| 003 | `003_v0.11_policies_fk_fixes.sql` | 已认证用户读取策略与 FK 修复。 |
| 004 | `004_full_supabase_runtime.sql` | Supabase 运行态补齐、角色/函数/数据迁移。 |
| 005 | `005_fix_auth_user_claims.sql` | auth claims 兼容修复。 |
| 006 | `006_grant_service_schema_permissions.sql` | service/anon/authenticated schema 权限。 |
| 007 | `007_fix_postgrest_rls_runtime.sql` | PostgREST RLS 函数与运行时修复。 |
| 008 | `008_remove_recursive_employee_policies.sql` | 移除递归 employee policy。 |
| 009 | `009_report_dedup_constraints.sql` | 报表去重与约束修复。 |
| 010 | `010_timesheet_workflow_rpc.sql` | 周表审批 RPC。 |
| 011 | `011_overtime_rpc.sql` | 加班审批 RPC。 |
| 012 | `012_admin_employee_create_rls.sql` | 管理员新增员工所需的 profile/contract/salary RLS 补强。 |

数据库变更必须新增迁移文件，不应直接修改已上线迁移。应用新迁移后需要刷新或重启 PostgREST 以更新 schema cache。

## 8. 部署与环境变量

### 8.1 应用容器

当前 `Dockerfile`：

- 基础镜像：`python:3.12-slim`。
- 复制 `frontend/dist` 到 `/app`。
- 复制 `serve_spa.py` 到 `/serve_spa.py`。
- 暴露 80。
- 内置 HTTP healthcheck。
- 启动命令：`python /serve_spa.py`。

应用端口：

```text
192.168.2.100:8767 -> attendance-module:80
```

### 8.2 Supabase 服务栈

| 端口 | 服务 | 容器 |
| --- | --- | --- |
| 5433 | PostgreSQL 16 | `psa-postgres` |
| 8777 | GoTrue | `psa-gotrue` |
| 8778 | Realtime | `psa-realtime`，当前不作为主运行态依赖 |
| 8779 | PostgREST | `psa-postgrest` |

### 8.3 必需环境变量

前端构建变量：

```bash
VITE_SUPABASE_AUTH_URL=http://192.168.2.100:8777
VITE_SUPABASE_REST_URL=http://192.168.2.100:8779
VITE_SUPABASE_ANON_KEY=<anon key>
```

应用容器变量：

```bash
SUPABASE_AUTH_URL=http://192.168.2.100:8777
SUPABASE_REST_URL=http://192.168.2.100:8779
GOTRUE_URL=http://192.168.2.100:8777
JWT_SECRET=<runtime secret>
DEFAULT_INITIAL_PASSWORD=<runtime initial password>
IMAGE_TAG=<release tag>
```

安全要求：

- `JWT_SECRET`、`POSTGRES_PASSWORD`、`DEFAULT_INITIAL_PASSWORD`、service role token/key 不得提交到 Git。
- `DEFAULT_INITIAL_PASSWORD` 不应返回给前端页面展示；账号创建后由受控运维流程交付初始密码。
- `VITE_SUPABASE_ANON_KEY` 属于浏览器可见公钥，但仍应只用于 anon/authenticated 场景。

## 9. 实时同步策略

Supabase Realtime 容器存在 `RLIMIT_NOFILE` 相关启动问题，当前不作为业务主依赖。

前端使用 `BroadcastChannel("psa-supabase-sync")` 做同源标签页同步，按模块刷新 TanStack Query：

- `timesheet`
- `approvals`
- `reports`
- `dashboard`
- `employees`
- `organizations`

跨浏览器、跨设备实时同步暂不在 V0.12 范围内。

## 10. 测试与验收

### 10.1 本地构建

```bash
cd frontend
npm run build
```

### 10.2 生产冒烟测试

Playwright 脚本位于 `frontend/e2e/prod-smoke.spec.ts`。

```bash
cd frontend
npm run test:e2e:prod
```

覆盖场景：

- 管理员登录并看到 Dashboard 首屏。
- 管理员进入审批中心，待审/已审区域可加载。
- Dashboard 分析图表或空状态可渲染。
- 普通员工登录并看到我的周表首屏。

生产验收还应人工验证：

- 容器状态与 healthcheck。
- GoTrue 登录。
- PostgREST schema cache。
- 周表保存、提交、审批、退回、重开。
- 项目负责人与部门负责人同人时只生成一道审批任务。
- 审批通过后待审核移入已审核。
- 报表统计不重复。
- 刷新和深链 `/dashboard`、`/timesheet`、`/review` 可用。
- 浏览器缓存旧 `/ws/sync` 不影响新版本。
- Network 面板无 service role key、数据库密码、NAS 密码泄露。

## 11. V0.12 关键变更与本次同步点

| 类别 | 当前事实 |
| --- | --- |
| 运行态 | 移除旧业务后端与本地数据库运行态，使用 Supabase + SPA。 |
| 静态服务 | 使用 Python 标准库 HTTP server 托管 SPA，并保留受控代理/安全端点。 |
| 审批 | 周表与加班审批通过 Postgres RPC 单事务完成。 |
| 审批中心 | 全量加载待审/已审任务，不再按周过滤；已审按 `completed_at` 降序去重。 |
| 员工列表 | 使用 `hr_employee_current_view`，并从 `user_roles` 读取真实角色。 |
| 新增员工 | 管理员通过 `/api/create-employee-with-login` 创建 GoTrue 用户并写业务表。 |
| 改密 | `/api/change-password` 校验旧密码后调用 GoTrue 改密。 |
| 密码安全 | 初始密码来自运行环境，不硬编码，不进 Git。 |
| 报表 | 周报/项目详情用平铺查询 + JS 聚合，避免缺失 FK 影响。 |
| Realtime | 暂停依赖，使用 BroadcastChannel 做同源刷新。 |
| RLS | migration 012 补强管理员新增员工相关写入权限。 |

相对 `PRD_V0.12.md` 的本次同步重点：

- 将“静态服务容器”从笼统静态托管明确为当前 `python:3.12-slim + serve_spa.py` 实现。
- 将迁移链从 011 补充到实际存在的 012。
- 明确 `/api/create-employee-with-login` 与 `/api/change-password` 是服务端受控端点，不属于浏览器直连 PostgREST 的兼容层。
- 明确 `release-manifest/V0.12.json` 仍只列到 004，已经落后于实际迁移链。
- 保留 V0.12 的核心结论：无 FastAPI/Flask/SQLite 运行态，审批走 RPC，Realtime 暂不作为主依赖。

## 12. 已知边界与待办

| ID | 问题 | 影响 | 当前处理 |
| --- | --- | --- | --- |
| K-01 | `psa-realtime` 不作为主运行态依赖 | 无跨设备实时推送 | BroadcastChannel 同源同步。 |
| K-02 | 部分历史 FK 不完整 | PostgREST 嵌入查询不可用 | 前端平铺查询 + JS 关联。 |
| K-03 | 月度回款来源不足 | Dashboard 回款分析准确性受限 | 目前使用项目表金额，后续需要正式回款流水。 |
| K-04 | 新增员工 ID 仍取 `max(id)+1` | 并发创建存在潜在冲突 | 后续建议改为数据库序列/RPC。 |
| K-05 | 编辑员工仍由浏览器串行写多表 | 失败时可能局部成功 | 后续建议收敛为 RPC 或 Edge Function。 |
| K-06 | `release-manifest/V0.12.json` 只列到 migration 004 | 发布清单落后于实际迁移 | 后续应补齐 005-012。 |

## 13. Agent 协作规范

1. 前端改动后必须执行 `npm run build`，生产发布前再执行冒烟测试。
2. 数据库变更必须新增 `supabase-psa/migrations/` 顺序迁移。
3. 审批相关业务状态必须走 RPC，不得重新改回前端直接 PATCH 状态机。
4. PostgREST 查询遇到缺失 FK 时使用平铺查询 + JS 关联。
5. 不得把 `service_role`、`JWT_SECRET`、数据库密码、NAS 密码、初始密码写入前端代码、文档明文或日志。
6. 不要恢复 FastAPI、Flask、SQLite、本地 `.sqlite3` 或旧 `/ws` 同步运行态。
7. 不要随意修改 `serve_spa.py` 端口行为、`docker-compose.yml` 端口映射或 `.env` 中的 `IMAGE_TAG` 语义。
