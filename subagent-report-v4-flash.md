# v4-flash 审计报告

> 审计时间：2026-06-01
> 审计范围：考勤统计模块 Supabase 生产级部署
> 审计代理：v4-flash 子代理（只读审计，未执行任何写操作）

---

## 结论摘要

整体评估：**架构迁移方向正确，前端已全面切换到 GoTrue/PostgREST 直连模式，无旧运行态残留。但存在 1 个 P0 功能缺陷、3 个 P1 上线前必须处理的问题，以及若干 RLS 策略冲突和迁移幂等性风险。**

---

## P0 必须处理

### P0-1: `/api/timesheet-detail` 路由缺失，审批详情页不可用

- **文件**：[frontend/src/lib/api.ts](frontend/src/lib/api.ts#L613-L672)
- **调用方**：[frontend/src/hooks/useApprovals.ts](frontend/src/hooks/useApprovals.ts#L22)
- **问题**：`useTimesheetDetail()` hook 调用 `/api/timesheet-detail?timesheetId=xxx`，但 `handleApi()` 函数中没有该路由的处理分支，请求会直接落入最后的 `throw new Error("Unsupported Supabase API route")`。
- **影响**：审批人员点击某条待审批记录查看详情时，请求必定失败。
- **建议**：在 `handleApi()` 中补充 `/api/timesheet-detail` 的实现。该接口应查询单张 timesheet 的完整数据（含 entries、overtime、员工信息）。参考 `approvalTasks()` 中已有的数据结构，可以基于现有的 `getTimesheet()` 封装。

### P0-2: 004 迁移脚本不可重复执行

- **文件**：[supabase-psa/migrations/004_full_supabase_runtime.sql](supabase-psa/migrations/004_full_supabase_runtime.sql#L72-L203)
- **问题**：`004` 中约 22 条 `CREATE POLICY` 语句没有 `DROP POLICY IF EXISTS ... ON ...` 前置守卫。首次执行正常，但重复执行（如 NAS 重建/迁移链路重放）时，所有已存在的 policy 会触发 `ERROR: policy "..." for table "..." already exists`。
- **具体受影响的 policy（按行号）**：
  - L72 `"Self read roles"` ON user_roles
  - L76 `"Admin all roles"` ON user_roles
  - L82 `"Reviewer read employees"` ON employees
  - L86 `"Reviewer read profiles v2"` ON employee_profiles_v2
  - L90 `"Reviewer read contracts"` ON employee_contracts
  - L94 `"Reviewer read salary"` ON employee_salary_profiles
  - L98 `"Reviewer read timesheets"` ON timesheets
  - L102 `"Reviewer read entries"` ON timesheet_entries
  - L106 `"Reviewer read overtime"` ON overtime_entries
  - L111 `"Self insert timesheet"` ON timesheets
  - L116 `"Self update draft rejected timesheet"` ON timesheets
  - L121 `"Self insert entries"` ON timesheet_entries
  - L132 `"Self delete draft entries"` ON timesheet_entries
  - L143 `"Self insert overtime"` ON overtime_entries
  - L154 `"Self delete draft overtime"` ON overtime_entries
  - L166 `"Self submit own workflow tasks"` ON workflow_tasks
  - L170 `"Assignee update own tasks"` ON workflow_tasks
  - L175 `"Reviewer insert approval logs"` ON approval_logs
  - L179 `"Reviewer update submitted timesheets"` ON timesheets
  - L184 `"Reviewer update overtime"` ON overtime_entries
  - L190 `"Admin all employees"` ON employees
  - L195 `"Admin all projects v12"` ON projects
  - L200 `"Admin all orgs v12"` ON organizations
- **安全的部分**（可重复执行）：
  - `CREATE ROLE ... IF NOT EXISTS`（L8-L16）✅
  - `CREATE SEQUENCE IF NOT EXISTS`（L22-L26）✅
  - `SELECT setval(...)`（L28-L32）✅
  - `ALTER TABLE ... ALTER COLUMN ... SET DEFAULT`（L34-L38）✅
  - `CREATE OR REPLACE FUNCTION`（L41-L69）✅
  - `DROP POLICY IF EXISTS ...` + `CREATE POLICY`（L115-L119）✅ — 这是唯一做了幂等处理的新 policy
- **建议**：在所有 `CREATE POLICY` 前统一加 `DROP POLICY IF EXISTS "name" ON table_name;`，或将 004 改为事务块内先统一 DROP 再 CREATE。`002` 和 `003` 也需要同样的幂等审查，迁移链路需要规范命名和顺序。

---

## P1 上线前建议处理

### P1-1: 审批状态机非原子事务，存在竞态条件

- **文件**：[frontend/src/lib/api.ts](frontend/src/lib/api.ts#L314-L386) 中的 `timesheetAction()`
- **风险**：审批操作涉及多个独立 HTTP 请求（PATCH timesheets → PATCH workflow_tasks → INSERT approval_logs），每个请求是独立的 PostgREST 调用，没有数据库事务保证。如果中间某步失败：
  - 场景 A：timesheet 状态已改为 approved，但 workflow_tasks 更新失败 → 审批任务仍然 pending，但周表已通过。
  - 场景 B：workflow_tasks 已标记完成，但 timesheet 状态更新失败 → 审批任务消失，但周表状态未变。
  - 场景 C：approval_logs 写入失败 → 审批操作无审计记录。
- **建议**：生产级应将审批状态流转收敛到 Postgres RPC 函数（`SECURITY DEFINER`），在单个数据库事务中完成所有写入。这与 task.md 中主代理标注的"高风险点 1"一致。

### P1-2: 周表保存的"删后重建"模式存在数据丢失风险

- **文件**：[frontend/src/lib/api.ts](frontend/src/lib/api.ts#L243-L282) 中的 `saveTimesheet()`
- **问题**：保存周表时，先 `DELETE` 所有旧 `timesheet_entries` 和 `overtime_entries`，再 `INSERT` 新数据。如果 DELETE 成功但 INSERT 失败（网络中断、服务端错误等），用户的所有周表条目将丢失。
- **建议**：
  - 短期：在 DELETE 前将旧数据暂存在前端内存，INSERT 失败后回写。
  - 长期：改为 Postgres RPC，在事务中完成 DELETE + INSERT，失败自动回滚。

### P1-3: 前端自增 ID 策略存在碰撞风险

- **文件**：[frontend/src/lib/api.ts](frontend/src/lib/api.ts#L102-L105) `nextId()` 和 L256-L261 `saveTimesheet()` 中的 `Date.now() + index`
- **问题**：
  - `nextId()` 通过 `SELECT MAX(id) + 1` 生成新 ID（针对 employees/projects/organizations），在并发场景下可能碰撞。
  - `timesheet_entries` 和 `overtime_entries` 使用 `Date.now() + index` 作为 ID，在多标签页同时操作时必定碰撞。
- **现状**：004 迁移已为表创建了 SEQUENCE 并设置 DEFAULT，理论上 PostgREST INSERT 时如果省略 id 会自动生成。但前端代码仍然手动计算 ID 并显式传入。
- **建议**：移除前端自增 ID 逻辑，INSERT 时省略 `id` 字段，让数据库 SEQUENCE 自动分配。对于 `timesheet_entries` 和 `overtime_entries`，因其 id 列类型已经是 BIGINT（非 BIGSERIAL），需确认 001 schema 中这两张表的 id 类型是否需要改为 BIGSERIAL 或确认 SEQUENCE 已正确绑定。

### P1-4: `timesheet_entries` 无 UPDATE 策略

- **文件**：[supabase-psa/migrations/004_full_supabase_runtime.sql](supabase-psa/migrations/004_full_supabase_runtime.sql)
- **问题**：`timesheet_entries` 表只有 INSERT（L121）和 DELETE（L132）策略，没有 UPDATE 策略。当前通过 DELETE ALL + INSERT ALL 绕过，但如果未来需要逐条更新条目（如审批过程中修改单条工时），将无法操作。
- **建议**：如果当前保存模式（全量替换）是最终设计，则无需 UPDATE 策略，但应在 PRD 中明确说明。否则应添加 `"Self update draft entries"` 策略。

---

## P2 后续优化

### P2-1: 003 与 004 存在重复的 admin 策略

- `003` 中 `"Admin manage projects"`（FOR ALL）与 `004` 中 `"Admin all projects v12"`（FOR ALL）功能完全重叠。
- `003` 中 `"Admin manage orgs"`（FOR ALL）与 `004` 中 `"Admin all orgs v12"`（FOR ALL）功能完全重叠。
- 虽然 Postgres RLS 的 OR 语义允许两个策略共存，但维护混乱，建议合并为单一策略。

### P2-2: `overtime_entries` 审批写入权限过宽

- **文件**：[supabase-psa/migrations/004_full_supabase_runtime.sql](supabase-psa/migrations/004_full_supabase_runtime.sql#L184-L187)
- **问题**：`"Reviewer update overtime"` 策略允许任何具有 `admin` 或 `manager` 角色的用户更新任意 `overtime_entries` 行。没有限制只能审批分配给自己的加班记录。
- **建议**：应缩小为只允许被分配为审批人的 reviewer 更新对应的 overtime，或改为 RPC 封装。

### P2-3: `approval_logs` 写入仅凭 actor 声明

- **文件**：[supabase-psa/migrations/004_full_supabase_runtime.sql](supabase-psa/migrations/004_full_supabase_runtime.sql#L175-L177)
- **问题**：`"Reviewer insert approval logs"` 的 CHECK 是 `actor_id = current_employee_id() AND current_user_can_review()`。任何 reviewer 可以插入任意 `target_id` 的审批日志，没有验证该 reviewer 是否确实被分配审批该 target。
- **建议**：改为 RPC 或在 CHECK 中加入 workflow_tasks 的存在性校验。

### P2-4: SPA 静态服务为 Python 标准库实现

- **文件**：[serve_spa.py](serve_spa.py)、[Dockerfile](Dockerfile)
- **说明**：当前用 `http.server` + `ThreadingHTTPServer` 提供静态文件和反向代理，这是轻量实现，功能正常但不是生产级 HTTP 服务器。
- **建议**：后续替换为 Nginx 或 Caddy 镜像，配置 SPA fallback、缓存策略、TLS 终结、限流等。这与 task.md 中提到的高风险点 4 一致。

### P2-5: docker-compose.yml 暴露敏感配置

- **文件**：[docker-compose.yml](docker-compose.yml#L8-L9)
- **说明**：`SUPABASE_AUTH_URL` 和 `SUPABASE_REST_URL` 直接写入 docker-compose.yml，其中包含 NAS IP 地址。这些不是密钥，但是基础设施细节。如果需要频繁切换环境，应考虑使用 `.env` 文件统一管理。
- **评价**：当前做法在生产环境中可接受，但建议添加注释说明这些值需与 NAS 实际 IP 保持一致。

---

## 残留扫描结果

扫描关键词：`fastapi`, `uvicorn`, `flask`, `sqlite`, `sqlite3`, `attendance_demo`, `ATTENDANCE_DB_PATH`, `fastapi_app`, `legacy`, `/ws`

| 文件 | 行号 | 命中内容 | 是否需要处理 | 原因 |
|------|------|----------|-------------|------|
| [task.md](task.md) | 5, 20, 35-44, 119, 195 | fastapi, uvicorn, flask, sqlite, sqlite3, attendance_demo, ATTENDANCE_DB_PATH, fastapi_app, legacy, /ws | **否** | 审计任务本身的指示文字，非运行态残留 |
| [package-lock.json](package-lock.json) | 152 | sha512 hash 字符串中含 `zg/chbXyeBtMQ1LbD/WSoW2DpC3I0mpmPdW+ynRTj/x2DAWYrIY7qeZIHidozwV24m4iavr15lNwIwLxRmOxhA==` | **否** | npm 依赖包完整性 hash，非运行态残留 |
| [frontend/package-lock.json](frontend/package-lock.json) | 2001 | 同上 hash 字符串 | **否** | npm 依赖包完整性 hash，非运行态残留 |
| [supabase-psa/migrations/001_v0.11_schema.sql](supabase-psa/migrations/001_v0.11_schema.sql) | 6 | `-- Base tables (existing from SQLite)` | **否** | SQL 注释中的历史说明文字，非运行态残留 |
| [supabase-psa/migrations/004_full_supabase_runtime.sql](supabase-psa/migrations/004_full_supabase_runtime.sql) | 21 | `-- Tables migrated from SQLite used explicit BIGINT ids` | **否** | SQL 注释中的历史说明文字，非运行态残留 |

**结论**：仓库中**未发现任何旧运行态残留文件**。FastAPI 入口 (`app.py`, `fastapi_app.py`)、Flask 入口、SQLite 数据库文件、`db.py` 等旧文件均已删除（git status 显示为 `D` 状态）。前端代码中无 WebSocket 引用。`serve_spa.py` 虽然使用 Python，但它只是无业务状态的静态文件服务器，不是 FastAPI/Flask 后端。

---

## RLS Findings

### [P0] 004 迁移不可重复执行（详见 P0-2）
见上文 P0-2 的详细说明。22 条 CREATE POLICY 无幂等守卫。

### [P1] `timesheet_entries` 无 UPDATE 策略（详见 P1-4）
仅支持 INSERT + DELETE，全量替换模式有数据丢失风险。

### [P1] 审批写入权限过宽
- `workflow_tasks` INSERT：`created_by = current_employee_id()` — 合理 ✅
- `workflow_tasks` UPDATE：`assignee_user_id = current_employee_id() OR admin` — 基本合理，但 admin 可越权修改任何人的 task ⚠️
- `timesheets` UPDATE（reviewer）：`status = 'submitted' AND current_user_can_review()` — 任何 reviewer 可修改任何已提交周表，不限于分配给自己的 ⚠️
- `overtime_entries` UPDATE（reviewer）：`current_user_can_review()` — 任何 reviewer 可修改任何加班记录 ⚠️

### [P2] 003 与 004 策略重复
- `projects` 表存在两条 FOR ALL admin 策略（003 的 `"Admin manage projects"` + 004 的 `"Admin all projects v12"`）
- `organizations` 表存在两条 FOR ALL admin 策略（003 的 `"Admin manage orgs"` + 004 的 `"Admin all orgs v12"`）

### RLS 覆盖度总览

| 表名 | RLS 开启 | SELECT | INSERT | UPDATE | DELETE |
|------|---------|--------|--------|--------|--------|
| profiles | ✅ 002 | 本人 + admin | ❌ | ❌ | ❌ |
| employees | ✅ 002 | 本人 + admin + manager(org) + reviewer(004) | admin(004) | admin(004) | admin(004) |
| employee_profiles_v2 | ✅ 002 | 本人 + manager(org) + admin + reviewer(004) | admin | admin | admin |
| employee_contracts | ✅ 002 | 本人 + admin + reviewer(004) | admin | admin | admin |
| employee_salary_profiles | ✅ 002 | 本人 + admin + reviewer(004) | admin | admin | admin |
| user_roles | ✅ 002 | 本人(004) + admin | admin | admin | admin |
| organizations | ✅ 002 | authenticated(active) + admin | admin | admin | admin |
| projects | ✅ 002 | authenticated(active) + admin | admin | admin | admin |
| timesheets | ✅ 002 | 本人 + approver + reviewer(004) | 本人(004) | 本人(draft/rejected) + reviewer(submitted)(004) | ❌ |
| timesheet_entries | ✅ 002 | 本人 + approver + reviewer(004) | 本人(004) | ❌ | 本人(004) |
| overtime_entries | ✅ 002 | 本人 + approver + reviewer(004) | 本人(004) | reviewer(004) | 本人(004) |
| workflow_tasks | ✅ 002 | assignee + admin | 本人(004) | assignee + admin(004) | ❌ |
| approval_logs | ✅ 002 | admin | reviewer(004) | ❌ | ❌ |
| audit_logs | ✅ 002 | admin | service(any) | ❌ | ❌ |

> 注：`profiles` 表无 INSERT/UPDATE/DELETE 策略，当前通过 GoTrue admin API 管理。符合设计预期。

---

## 前端 API 适配层 Findings

### 架构符合度

所有业务请求 100% 通过 `fetch()` 直连 GoTrue（`/auth/v1/`）或 PostgREST（`/rest/v1/`）。`handleApi()` 兼容层将 `/api/*` 路由映射为对应的内部函数调用：

| 旧路由风格 | 实际调用 | 后端 |
|-----------|---------|------|
| `/api/login` | `auth("/token?grant_type=password", ...)` | GoTrue ✅ |
| `/api/logout` | `clearStoredToken()` | 纯前端 ✅ |
| `/api/password/change` | `auth("/user", ...)` PUT | GoTrue ✅ |
| `/api/bootstrap` | `currentUser()` + `projects()` | PostgREST ✅ |
| `/api/timesheet` | `getTimesheet()` | PostgREST ✅ |
| `/api/timesheet/save` | `saveTimesheet()` | PostgREST ✅ |
| `/api/timesheet/action` | `timesheetAction()` | PostgREST ✅ |
| `/api/approvals/tasks` | `approvalTasks()` | PostgREST ✅ |
| `/api/reports/weekly` | `weeklyReport()` | PostgREST ✅ |
| `/api/projects/*` | `saveProject()` / 软删除 | PostgREST ✅ |
| `/api/employees/*` | `saveEmployee()` / 软删除 | PostgREST ✅ |
| `/api/organizations/*` | `saveOrganization()` / 软删除 | PostgREST ✅ |
| `/api/overtime/action` | `overtimeAction()` | PostgREST ✅ |
| `/api/me` | `currentUser()` | PostgREST ✅ |

### 密钥安全性

- `ANON_KEY` 通过 `import.meta.env.VITE_SUPABASE_ANON_KEY` 读取，由 Vite 在构建时注入，属于设计上允许暴露给浏览器的公钥。✅
- 无任何 `service_role` key、数据库密码、NAS 密码出现在前端源码中。✅
- Token 存储在 `localStorage`（`psa_access_token`），这是 SPA 的标准做法，但需注意 XSS 风险。⚠️（中等风险，属行业通用做法）

### 空值与类型问题

- `nextId()` 中 `rows[0]?.id || 0` 在表为空时返回 1，逻辑正确。✅
- `currentUser()` 正确使用 `Array.isArray()` 检查嵌套关联数据。✅
- `saveTimesheet()` 中 `Date.now() + index` 的 ID 在高并发下有碰撞风险。（已在 P1-3 中标注）
- `overtimeAction()` 未使用 `currentUser()` 校验权限，仅依赖后端的 RLS。可接受。⚠️

### 状态流转

- `saveTimesheet()` 正确检查 `["draft", "rejected"].includes(sheet.status)` 后才允许编辑。✅
- `timesheetAction()` 的 submit/approve/reject/reopen 状态机逻辑完整。✅
- `resolveTimesheetAssignees()` 正确实现了"项目负责人=部门负责人时去重"逻辑。✅
- 审批通过后正确检查 pending tasks 是否清空再更新 timesheet 状态。✅

### 缺失接口

- `/api/timesheet-detail` 被 `useApprovals.ts` 调用但在 `handleApi()` 中无实现。❌（P0）

---

## 生产验收 Checklist

> 此 checklist 为只读验收项，供主代理或人工在 NAS 上执行。不包含真实密码。

### 容器状态

- [ ] `attendance-module` 容器运行中：`docker ps --filter name=attendance-module`
- [ ] 容器重启策略为 `unless-stopped`：`docker inspect attendance-module --format '{{.HostConfig.RestartPolicy.Name}}'`
- [ ] 容器健康检查通过：`docker inspect attendance-module --format '{{.State.Health.Status}}'`
- [ ] `supabase-psa` 相关容器（GoTrue、PostgREST、Postgres）运行中

### HTTP 健康检查

- [ ] 主页可访问（返回 200 + HTML）：`curl -s -o /dev/null -w "%{http_code}" http://192.168.2.100:8767/`
- [ ] SPA fallback 生效：`curl -s -o /dev/null -w "%{http_code}" http://192.168.2.100:8767/dashboard`
- [ ] 静态资源缓存头正确：`curl -sI http://192.168.2.100:8767/assets/xxx.js | grep -i cache-control`
- [ ] GoTrue 健康：`curl -s http://192.168.2.100:8777/auth/v1/health`
- [ ] PostgREST schema cache：`curl -s http://192.168.2.100:8779/`

### GoTrue 登录

- [ ] 使用有效员工账号登录（username + password → GoTrue password grant）
- [ ] 登录后 `psa_access_token` 写入 localStorage
- [ ] 登录后 `/api/bootstrap` 返回 currentUser、projects、currentWeek
- [ ] 登出后 token 清除，页面重定向回登录页
- [ ] 使用错误密码登录时收到明确的错误提示

### 周表操作

- [ ] 打开周表页面，自动显示当前周（周一~周日）
- [ ] 可为每天添加项目工时（百分比或小时）
- [ ] 每天合计超过 100% 时显示错误提示
- [ ] 保存草稿成功（刷新后数据保留）
- [ ] 已提交/已通过的周表不可编辑

### 提交与审批

- [ ] 提交周表：状态从 draft → submitted
- [ ] 提交后 workflow_tasks 生成正确（项目负责人 + 部门负责人）
- [ ] 项目经理审批：审批通过后对应 task 状态变为 completed
- [ ] 部门经理审批：全部 task 完成后 timesheet 状态变为 approved
- [ ] 项目经理 = 部门经理时只生成一道审批任务 ⭐
- [ ] 审批退回：timesheet 状态变为 rejected
- [ ] 审批通过后从待审核列表移到已审核列表
- [ ] 审批操作写入 approval_logs

### 加班管理

- [ ] 加班记录可填写（日期 + 小时数 + 原因）
- [ ] 加班记录独立于周表提交
- [ ] 加班审批：通过/退回操作正常
- [ ] 退回的加班记录在周表中显示提示

### 报表统计

- [ ] 周报表按项目汇总工时正确
- [ ] 项目详情页显示参与人员和工日
- [ ] Dashboard 显示项目汇总（合同金额、工时、人工成本、毛利等）
- [ ] 月度横向对比数据正确
- [ ] 报表不重复计算（同一张 timesheet 不会被计入两次）

### 员工与组织管理

- [ ] 员工列表正常加载
- [ ] 新增员工 → 同步写入 employees + employee_profiles_v2 + employee_contracts + employee_salary_profiles + user_roles
- [ ] 编辑员工正常
- [ ] "删除"员工实际为 is_active=false（软删除）
- [ ] 组织架构树正常展示

### 路由与缓存

- [ ] `/dashboard` 直接访问不 404（SPA fallback 生效）
- [ ] `/employees` 直接访问不 404
- [ ] 页面刷新后保持登录状态（token 持久化）
- [ ] 浏览器缓存旧 `/ws/sync` 不影响新版本（确认无残留 WebSocket 连接尝试）
- [ ] 登录前访问任何路由都重定向到登录页

### 安全

- [ ] 浏览器开发者工具 Network 面板中无 `service_role` key 泄露
- [ ] 员工 A 无法通过修改请求看到员工 B 的周表（RLS 生效）
- [ ] 非管理员无法修改项目/组织/员工信息
- [ ] 非 reviewer 无法执行审批操作

---

## 建议交给主代理处理的事项

1. **修复 P0-1**：在 `handleApi()` 中补充 `/api/timesheet-detail` 路由实现。
2. **修复 P0-2**：在 `004_full_supabase_runtime.sql` 的每条 `CREATE POLICY` 前添加 `DROP POLICY IF EXISTS` 守卫，确保迁移幂等。
3. **评估 P1-1**：将审批状态机收敛为 Postgres RPC 函数，在数据库事务中完成 timesheet 状态更新 + workflow_tasks 更新 + approval_logs 插入。
4. **评估 P1-2**：将周表保存的 DELETE+INSERT 模式改为数据库事务内的原子操作。
5. **评估 P1-3**：移除前端自增 ID，使用数据库 SEQUENCE 自动分配。
6. **RLS 策略合并**：清理 003 与 004 中重复的 admin 策略。
7. **长期**：将 SPA 静态服务从 Python `http.server` 替换为 Nginx/Caddy。
8. **长期**：GoTrue 账号创建能力（目前前端无法安全创建用户，需 EDGE Function 或管理后台）。
