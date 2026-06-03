# 项目核算自动化系统 PRD V0.12

## 1. 目标

建设内部工时统计系统，统一管理员工周表、项目工日、组织架构、审批、加班和项目统计。
**V0.12 为 Supabase 全栈生产级版本，V0.12.2 已启用局域网 Realtime**，运行态完整基于 Supabase 技术栈，
审批状态机通过 Postgres RPC 函数实现。

- 认证：Supabase GoTrue (HS256 JWT)
- 数据：Supabase Postgres 16 + wal2json logical decoding
- 数据访问：PostgREST (REST) + RPC (状态机) + Supabase Realtime
- 前端：React 19 + Vite 8 + shadcn/ui 静态 SPA
- 部署：Python 静态文件服务容器 + `supabase-psa` 服务栈

## 2. 核心角色

- 员工：填写本人周表、保存草稿、提交审批、填写加班
- 主管/项目负责人：查看分配任务，审批或退回周表与加班
- 管理员：维护员工/组织/项目基础资料，查看全部审批与统计，拥有最高 RLS 权限

## 3. 周表规则

- 每名员工每周一张周表
- 每天项目工日比例合计 ≤ 1 工日
- 状态机：`draft → submitted → approved/rejected`，管理员可重开至 `draft`
- 已提交/已通过状态不可编辑
- 加班独立审批，周表通过 ≠ OT 自动通过

## 4. 审批规则 (RPC 驱动)

**审批链**：提交周表 → 按项目生成双级任务：
1. Stage 1：项目负责人 (`projects.project_owner_id`)
2. Stage 2：部门负责人 (`organizations.manager_user_id`)
3. 同人自动合并为一道审批

**RPC 函数** (`migration 010`)：

| 函数 | 功能 |
|------|------|
| `psa_timesheet_action(p_timesheet_id, p_action, p_comment)` | 状态机：submit/approve/reject/reopen |
| `psa_overtime_action(p_overtime_id, p_action, p_comment)` | OT 审批：approve/reject |
| `psa_resolve_timesheet_assignees(p_timesheet_id)` | 解析项目负责人+部门负责人 |

**关键特性**：
- 所有审批操作在 PG 单事务内完成（SECURITY DEFINER）
- `submit` → 校验状态 + 每日合计 ≤100% → 创建 workflow_tasks
- `approve` → 完成当前用户 task → 检查剩余 task → 全完则 approved，未完保持 submitted
- `reject` → 完成当前 task + 取消其余 pending task → timesheet → rejected
- `reopen` → 清空审批状态回到 draft
- 前端通过 PostgREST `/rpc/psa_*` 调用，不直接 PATCH 业务表

## 5. 数据表

### public schema

| 表 | 说明 | FK 状态 |
|----|------|--------|
| profiles | 登录名→auth UUID 映射 | ✅ |
| employees | 员工主实体 | ✅ |
| employee_profiles_v2 | 组织归属/岗位/状态 | ✅ |
| employee_contracts | 合同档案 (is_current) | ✅ |
| employee_salary_profiles | 薪酬档案 (is_current) | ✅ |
| user_roles | 角色 | ✅ |
| organizations | 组织架构 | ✅ |
| projects | 项目基础 + 负责人 | ✅ |
| timesheets | 周表 | ⚠️ user_id FK 缺失 |
| timesheet_entries | 周表明细 | ✅ |
| overtime_entries | 加班记录 | ✅ |
| workflow_tasks | 审批任务队列 | ⚠️ FK 缺失,已手动补 |
| approval_logs | 审批日志 | ✅ |
| audit_logs | 审计日志 | ✅ |
| hr_employee_current_view | 员工统一视图 (DISTINCT ON) | ✅ |

### GoTrue auth schema

16 张表：`auth.users`, `auth.sessions`, `auth.refresh_tokens`, `auth.identities` 等

## 6. 前端架构

### 6.1 技术栈

| 层 | 技术 |
|----|------|
| 框架 | React 19 + TypeScript |
| 构建 | Vite 8 |
| CSS | Tailwind CSS v4 + shadcn/ui |
| 图表 | Recharts |
| 状态 | Zustand (客户端) + TanStack Query (服务端) |
| 路由 | React Router 6, SPA 6 页面 |

### 6.2 API 兼容层

前端 `api("/api/xxx")` → `handleApi()` 分发为 GoTrue/PostgREST 请求。**无 FastAPI 后端**。

| 前端路径 | 实际请求 | 方式 |
|---------|---------|------|
| `POST /api/login` | GoTrue `/token?grant_type=password` | 中文→拼音 email 映射 |
| `GET /api/bootstrap` | PostgREST 并行查询 | currentUser + projects |
| `GET /api/timesheet` | PostgREST 平铺查询 | timesheets + entries + overtime |
| `POST /api/timesheet/save` | PostgREST PATCH + DELETE + POST | 先删后插 |
| `POST /api/timesheet/action` | `/rpc/psa_timesheet_action` | **RPC** |
| `GET /api/approvals/tasks` | PostgREST 多表平铺 | 全量不按周过滤，已审核按 completed_at 降序去重 |
| `GET /api/timesheet-detail` | PostgREST 4 路平铺 + JS 关联 | 绕过 FK 缺失 |
| `POST /api/overtime/action` | `/rpc/psa_overtime_action` | **RPC**, approved/rejected→approve/reject 映射 |
| `GET /api/employees` | PostgREST `/hr_employee_current_view` | DISTINCT ON 去重 |
| `GET /api/projects` | PostgREST 4 路并行 | projects + orgs + employees + entries |
| `POST /api/employees/save` | PostgREST 串行 5 表写入 | employees + profiles_v2 + contracts + salary + roles |

### 6.3 登录映射

| 输入 | GoTrue 邮箱 | 默认密码 |
|------|-----------|---------|
| admin | admin@psa.local | (运维设置) |
| 鞠松松 | jss@psa.local | 123456 |
| 惠若超 | huirouchao@psa.local | 123456 |
| 王长志 | wangchangzhi@psa.local | 123456 |
| 陈京京 | chenjingjing@psa.local | 123456 |
| 赵嘉琪 | zhaojiaqi@psa.local | 123456 |
| 储小海 | chuxiaohai@psa.local | 123456 |
| 韩文治 | hanwenzhi@psa.local | 123456 |
| 温利峰 | wenlifeng@psa.local | 123456 |

### 6.4 组件树

```
pages/
├── LoginPage.tsx
├── DashboardPage.tsx    # 总览(指标卡+汇总+项目表) / 分析(月度面积图+标签)
├── ReviewPage.tsx       # 审批中心(待审核/已审核,行内展开)
├── ReportPage.tsx       # 项目列表(CRUD+负责人+累计工日/支出)
├── TimesheetPage.tsx    # 我的周表(动态表单+校验+保存/提交)
└── EmployeesPage.tsx    # 员工与组织(行内编辑+部门管理)

components/
├── dashboard/           # MetricCards, DashboardTable, PeriodFilter, AnalyticsTab, SimpleBarList
├── review/              # ApprovalTable, ExpandedReviewRow
├── timesheet/           # TimesheetTable, WeekNavigator, SheetWarnings, SheetActions
├── employees/           # EmployeeTable, EmployeeEditRow, OrganizationPanel, ReminderFloat
├── report/              # ProjectList
└── layout/              # AppLayout, Sidebar, Topbar, Brand, LoginScreen
```

## 7. 部署

### 7.1 服务拓扑

```
Browser (:8767) → SPA 静态服务 (Docker: attendance-module, :80)
                    ├── GoTrue (:8777) → psa-postgres (:5433)
                    ├── PostgREST (:8779) → psa-postgres
                    └── Realtime (:8778) → psa-postgres logical replication
```

### 7.2 端口

| 端口 | 服务 | 容器 |
|------|------|------|
| 8767 | Web SPA | attendance-module |
| 5433 | PostgreSQL 16 | psa-postgres |
| 8777 | GoTrue Auth | psa-gotrue |
| 8778 | Supabase Realtime | psa-realtime |
| 8779 | PostgREST | psa-postgrest |

### 7.3 迁移

| 序号 | 文件 | 说明 |
|------|------|------|
| 001 | `v0.11_schema.sql` | 全量表 + 视图 |
| 002 | `v0.11_rls.sql` | RLS 策略 |
| 003 | `policies_fk_fixes.sql` | 已认证用户读策略 |
| 004 | `full_supabase_runtime.sql` | CodeX 运行时迁移 |
| 005 | `fix_auth_user_claims.sql` | Auth claims 修复 |
| 006-009 | grant/RLS 修复 | PostgREST 权限修复 |
| 010 | `timesheet_workflow_rpc.sql` | **审批 RPC** |
| 011 | `overtime_rpc.sql` | **OT RPC** |
| 012 | `admin_employee_create_rls.sql` | 管理员新增员工 RLS |
| 013 | `realtime_publication.sql` | Realtime publication + replica identity |
| 014 | `realtime_schema_migrations_compat.sql` | Realtime/Ecto schema_migrations 兼容 |
| 015 | `realtime_lan_tenants.sql` | LAN/IP/localhost Realtime tenants |
| 016 | `realtime_internal_schema.sql` | Realtime 内部 schema |

### 7.4 部署命令

```bash
cd frontend && npm run build
tar czf - dist/ | ssh inquiry-nas "cd .../frontend && tar xzf -"
ssh inquiry-nas "cd .../attendance-module && docker compose up -d --build"
```

### 7.5 回滚

```bash
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=v0.10/' .env && docker compose up -d
```

## 8. V0.12 变更总结 (自 V0.11)

| 类别 | 变更 |
|------|------|
| 审批 | PATCH 直写 → `psa_timesheet_action` / `psa_overtime_action` RPC (SECURITY DEFINER, 单事务) |
| 审批列表 | 不再按周过滤，全量展示；已审核按 completed_at 降序去重（最新结果优先） |
| 员工列表 | hr_employee_current_view 加 DISTINCT ON 去重；每人仅保留最新一条 is_current contract/salary |
| 员工角色 | listEmployees() 从 user_roles 表读实际 role（不再是硬编码 "employee"） |
| 新增员工 | `POST /api/create-employee-with-login` 单接口原子操作：校验admin→GoTrue建用户→写6表→绑UUID，失败回滚 |
| 密码安全 | DEFAULT_INITIAL_PASSWORD 从环境变量读取，不硬编码，不提交 Git，不返回给前端 |
| 改密 | 支持登录页(login参数)和已登录(JWT)两种模式；改密后置 must_change_password=false |
| 数据看板 | 分析页图表加数值标签（13px, 常驻, 0 值隐藏）；默认"总计—所有项目"+"年"；项目名显示名称 |
| 序列修复 | workflow_tasks_id_seq 等从 1 重置到 MAX(id)（修复 duplicate key 错误） |
| RLS | 新增 auth_read_* + admin_insert/update/delete 策略；Grant SELECT on hr_employee_current_view |
| FK | 补 timesheets.user_id→employees FK；workflow_tasks FK 因孤儿数据未完成 |
| GoTrue | 配置 CORS；禁用 signup；中文名→拼音 email 映射 |
| 前端 | Topbar 移除无效修改密码按钮；登录页改密支持 login 参数 |
| Realtime | **V0.12.2 已启用**：Supabase Realtime + wal2json + logical publication；BroadcastChannel 与短轮询作为 fallback |

## 9. 已知边界

- Realtime 已在本机/NAS 局域网部署启用；容器冷启动后首个订阅会触发 CDC 初始化，前端保留短轮询 fallback
- timesheets→employees / workflow_tasks→timesheets FK 尚未完成（历史孤儿数据）
- 月度回款额数据源缺失（需后端接口）
- 新建 GoTrue 账号通过 `/api/create-employee-with-login`（server-side service_role）
- admin 密码独立运维设置，不存 Git
- service_role key 不出前端，仅在 serve_spa.py 使用
- DEFAULT_INITIAL_PASSWORD 存在 NAS .env，不提交 Git

## 10. 服务端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/create-employee-with-login` | POST | 管理员新增员工（含 GoTrue 建用户） |
| `/api/change-password` | POST | 修改密码（支持 JWT 或 login 参数） |
| `/auth/*` | * | 代理到 GoTrue |
| `/rest/*` | * | 代理到 PostgREST |

## 11. Agent 协作规范

1. 前端改动 → `npm run build` → `tar + ssh` 部署
2. DB 变更 → `migrations/` 目录，按序号命名，部署后 `restart postgrest`
3. 审批 → 必须走 RPC，不 PATCH 业务表
4. PostgREST 查询 → 无 FK 则平铺 + JS 关联
5. 权限 → 用 `current_user_has_role()` / `current_user_can_review()`
6. 密码 → 绝不出现在前端代码、Git、API 返回中
7. 不改 `serve_spa.py` 端口映射、IMAGE_TAG
