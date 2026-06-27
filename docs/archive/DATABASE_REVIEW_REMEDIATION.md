# 数据库审查与整改建议

审查日期：2026-06-16  
项目：考勤统计模块  
范围：`supabase-psa/migrations`、`frontend/src/lib/api.ts`、`serve_spa.py`

## 1. 审查结论摘要

当前数据库可以支撑现有业务，但已经出现明显的“历史模型 + 兼容层 + 补丁层”叠加。主要风险集中在四个区域：

1. 审批模型从 `workflow_tasks` 演进到 `approval_*` 图模型后，部分旧表、旧日志、旧读模型仍残留。
2. 项目负责人/项目角色存在 `projects.project_owner_id`、`project_department_owners`、`project_roles` 多套表达。
3. 权限模型有 `user_roles`、`permission_roles`、`role_permissions`、`permission_resource_effects`，其中 `permission_resource_effects` 更像说明表，并未真正驱动 RLS。
4. 前端大量全量拉表并在浏览器聚合，数据量增长后会成为最先暴露的性能瓶颈。

建议其他 agent 按“先确认生产数据，再收敛模型，再优化高频查询”的顺序整改，不要直接删除表。

## 2. 表级审查结果

### 2.1 建议保留的核心表

以下表有明确业务职责，应保留并继续优化：

| 表 | 判断 | 说明 |
| --- | --- | --- |
| `organizations` | 保留 | 组织树、部门负责人、部门归属。 |
| `projects` | 保留 | 项目主数据。建议弱化 `project_owner_id` 的配置源地位。 |
| `timesheets` | 保留 | 周表主表。 |
| `timesheet_entries` | 保留 | 周表项目工时明细。 |
| `overtime_entries` | 保留 | 加班明细。 |
| `employees` | 保留 | 员工主数据。 |
| `employee_profiles` | 保留 | 员工组织、岗位、用工状态等扩展资料。 |
| `employee_contracts` | 保留 | 员工合同历史。 |
| `employee_salary_profiles` | 保留 | 员工薪资历史。 |
| `profiles` | 保留 | 登录账号元数据，需与 `employees` 明确边界。 |
| `user_roles` | 保留 | 员工拥有的平台角色。 |
| `business_documents` | 保留 | 审批图的业务单据入口。 |
| `approval_instances` | 保留 | 审批实例。 |
| `approval_rounds` | 保留 | 审批轮次。 |
| `approval_nodes` | 保留 | 审批节点。 |
| `approval_edges` | 保留 | 审批节点依赖关系。 |
| `approval_events` | 保留 | 审批事件日志，建议作为唯一审批日志事实源。 |
| `approval_node_assignees` | 保留 | 节点审批人。 |
| `approval_templates` | 保留 | 审批模板。 |
| `approval_template_nodes` | 保留 | 模板节点。 |
| `approval_template_edges` | 保留 | 模板边。 |
| `project_roles` | 保留 | 建议作为项目角色/负责人唯一配置源。 |
| `permission_roles` | 保留 | 可配置平台角色。 |
| `permission_resources` | 保留 | 可配置权限资源。 |
| `role_permissions` | 保留 | 角色与资源权限关系。 |

### 2.2 建议合并、退役或归档的表

| 表 | 建议 | 原因 | 建议动作 |
| --- | --- | --- | --- |
| `workflow_templates` | 退役候选 | 旧审批模型表。当前审批主路径已迁移到 `approval_templates`。 | 查询生产行数和引用后删除或转归档。 |
| `workflow_steps` | 退役候选 | 旧审批模型表。当前审批主路径已迁移到 `approval_template_nodes` / `approval_template_edges`。 | 同 `workflow_templates`。 |
| `approval_logs` | 合并候选 | 与 `approval_events` 职责重叠。旧 RPC 曾写入，当前新审批图以 `approval_events` 为主。 | 将历史记录迁移/归档到 `approval_events` 语义下，后续只读新表。 |
| `timesheet_project_reviews` | 退役或只读归档候选 | 旧 `workflow_tasks` 到新 approval graph 的项目块审批读模型。前端主要读 `approval_project_review_records_view`。 | 确认是否仍有写入需求；若没有，改由 view 派生或归档。 |
| `project_department_owners` | 合并候选 | 与 `project_roles` 都表达项目-部门/角色-人员关系。 | 迁移到 `project_roles(project_id, org_id, role_key, employee_id)`。 |
| `project_labor_costs` | 删除或重建候选 | 初始 schema 中的人工成本缓存表，当前代码未见有效消费。 | 若要保留，改为物化视图或定时刷新表；否则删除。 |
| `migration_id_map` | 删除或归档候选 | SQLite 迁移辅助表，当前业务无引用。 | 确认迁移完成后归档或删除。 |
| `audit_logs` | 保留/退役待定 | 有审计表结构和 RLS，但当前业务代码未见持续写入。 | 若要审计，补统一写入机制；否则归档。 |
| `permission_resource_effects` | 删除或明确为文档表 | 目前不驱动权限，只描述权限影响范围。 | 若不做权限审计 UI，删除；若保留，在命名和注释中标明是说明表。 |
| `approval_graph_cutover_audit` | 归档候选 | V0.15 审批图切换审计。 | 生产切换验证完成后归档。 |
| `approval_graph_history_repair_audit` | 归档候选 | 审批图历史修复审计。 | 历史修复验收后归档。 |

## 3. 字段和命名统一问题

### 3.1 员工 ID 命名混乱

现状：

- `timesheets.user_id` 实际引用员工 ID。
- `project_roles.employee_id` 与 `project_roles.user_id` 都引用 `employees(id)`。
- `approval_node_assignees.assignee_user_id` 实际也是员工 ID。
- `approval_events.actor_user_id` / `actor_employee_id` 两套字段并存。

风险：

- 后续接入真实 auth user / UUID 时容易混淆。
- 开发者难判断字段是否引用 `auth.users.id`、`profiles.id` 还是 `employees.id`。

建议：

1. 数据库中引用 `employees(id)` 的字段统一命名为 `*_employee_id`。
2. 如需保留兼容字段，增加注释并在 view 中提供兼容别名，不再让业务代码写双字段。
3. 优先处理 `project_roles.employee_id` / `project_roles.user_id`，保留一个事实字段。

验收标准：

- 新代码不再写入同义双字段。
- schema 注释明确所有 ID 字段指向。
- 前端 API 类型中不再混用 `user_id` 与 `employee_id` 表达同一含义。

### 3.2 登录资料与员工资料边界不清

现状：

- `employees.auth_user_id` 与 `profiles.auth_user_id` 都保存登录关联。
- `employees.name` 与 `profiles.display_name` 都保存展示名。

建议：

1. `employees` 作为人事主体：员工编号、姓名、启停状态。
2. `profiles` 作为登录主体：登录名、邮箱、是否必须改密、账号启停。
3. 允许 `profiles.auth_user_id` 和 `employees.auth_user_id` 共存，但必须明确其中一个是主事实源，另一个作为冗余/兼容字段由服务端同步。

验收标准：

- 创建/禁用员工时，两表同步逻辑集中到一个 RPC 或服务端事务。
- 不允许前端分散写 `employees`、`profiles` 多张表来完成一个账号动作。

### 3.3 项目负责人多套来源

现状：

- `projects.project_owner_id`
- `project_department_owners.project_owner_id`
- `project_roles.employee_id` / `user_id`
- `approval_nodes.snapshot` 中的 route/assignee 快照

建议：

1. `project_roles` 作为项目角色配置唯一事实源。
2. `projects.project_owner_id` 作为兼容字段或默认负责人字段，逐步退役。
3. `project_department_owners` 迁移到 `project_roles` 后停止写入。
4. 审批节点 snapshot 只作为历史快照，不参与新路由决策。

验收标准：

- 修改项目负责人只写 `project_roles`。
- 审批路由函数只从 `project_roles`、组织负责人和模板配置解析，不再从多个旧表 fallback。

### 3.4 状态值过多

现状状态值包括但不限于：

- 周表状态：`draft`、`submitted`、`approved`、`rejected`、`revision_required`、`locked`、`summarized`
- 项目块状态：`pending_project_review`、`project_approved`、`needs_revision`、`needs_reapproval`、`final_confirmed`
- 审批节点状态：`waiting`、`pending`、`active`、`approved`、`rejected`、`skipped`、`cancelled`

建议：

1. 明确三类状态：业务单据状态、审批节点状态、读模型展示状态。
2. 建立状态映射文档或枚举表，不要在前端散落 `if/else` 映射。
3. 逐步将前端展示状态改为读取 view/RPC 已整理好的字段。

验收标准：

- 每个状态只属于一个状态机。
- 新增状态必须更新约束、view/RPC 和前端枚举。

## 4. 性能优化建议

### 4.1 项目列表全量拉数

位置：`frontend/src/lib/api.ts` 的 `projects()`。

现状：

- 一次性拉取 `projects`、`organizations`、`employees`、`timesheet_entries`、`timesheets`、`project_department_owners`、`project_roles`。
- 前端浏览器完成 join 和聚合。

风险：

- 工时明细增长后，项目列表页面会越来越慢。
- RLS 每行判断放大查询成本。

建议：

1. 新建 `project_list_view`：返回项目基础信息、组织名、负责人名、角色配置摘要。
2. 新建 `project_metrics_view` 或 RPC：按项目聚合工时、人工成本、已审批状态。
3. 前端项目列表只调用 view/RPC，不再拉全量明细。

验收标准：

- 项目列表接口不再直接读取全量 `timesheet_entries`。
- 数据量达到 10 万条工时明细时，项目列表首屏仍可稳定返回。

### 4.2 周报和人工矩阵前端聚合

位置：

- `frontend/src/lib/api.ts` 的 `weeklyReport(...)`
- `frontend/src/lib/api.ts` 的 `laborMatrix(...)`

现状：

- 前端拉取多张表后按日期、项目、员工聚合。

建议：

1. 新建 `weekly_report_rpc(start_date, end_date)`。
2. 新建 `labor_matrix_rpc(start_date, end_date)`。
3. SQL 端完成过滤、join、group by、权限范围过滤。

验收标准：

- 前端不再自行扫描全量工时明细。
- RPC 对日期范围有必填参数和合理限制。

### 4.3 手动生成主键风险

位置：

- `frontend/src/lib/api.ts` 的 `nextId(table)`
- `serve_spa.py` 的 `_next_employee_id`

现状：

- 通过 `order=id.desc&limit=1` 获取最大 ID 后加 1。

风险：

- 并发创建时容易主键冲突。
- 多客户端同时操作时不可控。

建议：

1. 所有主键改为 `GENERATED BY DEFAULT AS IDENTITY` 或使用已有 sequence default。
2. 前端和 Python 服务端不再计算 ID。
3. 创建组织、项目、员工统一通过 RPC 或服务端事务完成。

验收标准：

- 新增记录请求体不再包含手工生成的 `id`。
- 并发创建 20 条员工/项目不会出现主键冲突。

### 4.4 建议补充索引

建议评估并补充：

```sql
CREATE INDEX IF NOT EXISTS idx_timesheets_week_status
  ON public.timesheets(week_start_date, status);

CREATE INDEX IF NOT EXISTS idx_timesheets_status_user
  ON public.timesheets(status, user_id);

CREATE INDEX IF NOT EXISTS idx_timesheet_entries_work_date_project
  ON public.timesheet_entries(work_date, project_id);

CREATE INDEX IF NOT EXISTS idx_timesheet_entries_project_timesheet
  ON public.timesheet_entries(project_id, timesheet_id);

CREATE INDEX IF NOT EXISTS idx_approval_nodes_instance_status
  ON public.approval_nodes(instance_id, status);

CREATE INDEX IF NOT EXISTS idx_approval_node_assignees_node_status
  ON public.approval_node_assignees(node_id, status);
```

注意：新增索引前应先用生产数据跑 `EXPLAIN ANALYZE`，避免盲目增加写入成本。

## 5. RLS 与权限模型建议

现状：

- UI 侧读取 `role_permissions` 控制菜单和按钮。
- 数据库 RLS 通过 `current_user_can_access_resource(...)` 判断权限。
- `permission_resource_effects` 只描述权限影响范围，不驱动实际权限。

建议：

1. 保留 `permission_roles`、`permission_resources`、`role_permissions` 作为权限事实源。
2. 明确 `permission_resource_effects` 是文档/审计表，或者删除。
3. 为 `current_user_can_access_resource(...)` 涉及字段确认索引：
   - `user_roles(employee_id, role)`
   - `role_permissions(role_key, resource_key)`
   - `employees(auth_user_id)`
4. 高频接口可考虑将用户权限缓存到服务端 session/JWT claims，降低 RLS 重复查表成本。

验收标准：

- 菜单可见性和数据库 RLS 权限一致。
- 权限配置变更后无需改 SQL policy 即可控制常规资源访问。
- 若 `permission_resource_effects` 保留，UI 或文档中明确它不是执行引擎。

## 6. 推荐整改顺序

### P0：盘点与保护

1. 统计候选退役表行数、最近更新时间、是否有外键依赖。
2. 列出生产库中每张表的实际读写来源。
3. 给所有候选删除动作准备回滚 SQL。

### P1：停止继续发散

1. 新增代码只使用 `approval_*` 审批图，不再新增 `workflow_*` 逻辑。
2. 新增项目负责人只写 `project_roles`。
3. 新增权限配置只写 `role_permissions`。
4. 禁止新增 `user_id` 字段表达员工 ID，统一使用 `employee_id`。

### P2：性能先行

1. 将项目列表改为 view/RPC。
2. 将周报改为 RPC。
3. 将人工矩阵改为 RPC。
4. 移除前端对全量 `timesheet_entries` 的扫描式读取。

### P3：模型收敛

1. 迁移 `project_department_owners` 到 `project_roles`。
2. 迁移/归档 `approval_logs` 到 `approval_events`。
3. 退役 `workflow_templates`、`workflow_steps`。
4. 处理 `project_roles.employee_id/user_id` 双字段。

### P4：清理历史表

1. 清理 `migration_id_map`。
2. 清理或归档 `approval_graph_cutover_audit`。
3. 清理或归档 `approval_graph_history_repair_audit`。
4. 判断 `project_labor_costs` 是删除还是重建为物化视图。

## 7. 建议验收清单

整改完成后，至少验证：

1. 员工创建、编辑、禁用、登录、改密流程正常。
2. 周表保存、提交、驳回、重提、审批通过流程正常。
3. 项目负责人变更后，待审批路由正确刷新。
4. 权限配置修改后，菜单、接口、RLS 行为一致。
5. 项目列表、周报、人工矩阵不再依赖前端全量扫描明细。
6. 删除或归档旧表前，有完整备份和回滚方案。
7. 所有新增 SQL migration 可重复执行，且 `NOTIFY pgrst, 'reload schema'` 覆盖 PostgREST schema 刷新。

## 8. 审查依据文件

重点审查文件：

- `supabase-psa/migrations/001_v0.11_schema.sql`
- `supabase-psa/migrations/027_project_department_owners.sql`
- `supabase-psa/migrations/028_timesheet_project_reviews.sql`
- `supabase-psa/migrations/033_approval_graph_b_core.sql`
- `supabase-psa/migrations/042_v015_approval_graph_cutover.sql`
- `supabase-psa/migrations/053_platform_rbac_permissions.sql`
- `supabase-psa/migrations/058_canonical_employee_profiles.sql`
- `supabase-psa/migrations/067_permission_effects_and_rls_alignment.sql`
- `supabase-psa/migrations/069_multi_pm_department_owners.sql`
- `frontend/src/lib/api.ts`
- `serve_spa.py`
