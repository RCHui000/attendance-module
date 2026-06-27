# 审批与数据库架构整理

本文档是审批图、数据驱动审批和数据库整改建议的权威整理入口。原始长文已归档：

- `docs/archive/APPROVAL_GRAPH_B_PLAN.md`
- `docs/archive/DATA_DRIVEN_APPROVAL_ENGINE_PLAN.md`
- `docs/archive/TIMESHEET_APPROVAL_DATA_DRIVEN_GAP.md`
- `docs/archive/DATABASE_REVIEW_REMEDIATION.md`

## 当前审批方向

审批事实源从旧 `workflow_tasks` 模型收敛到 `approval_*` 图模型：

- `business_documents` 作为业务单据入口；
- `approval_instances`、`approval_rounds` 表达审批实例和轮次；
- `approval_nodes`、`approval_edges` 表达运行时审批图；
- `approval_node_assignees` 表达节点上的审批人；
- `approval_events` 作为审批状态变化的不可变事件日志；
- `approval_templates`、`approval_template_nodes`、`approval_template_edges` 表达模板。

新增代码不应让 `workflow_tasks` 重新成为审批事实源。旧表或旧读模型只能作为兼容投影或历史查询来源。

## 数据驱动审批引擎

周表审批已从隐藏分支逻辑转向配置驱动。运行时决策由以下配置表达：

- 业务类型推导规则；
- 周表到审批模板的路由规则；
- 模板节点展开策略；
- 角色 alias 候选；
- 缺失审批人的处理策略。

`101_timesheet_data_driven_approval_engine.sql` 引入或扩展的关键配置包括：

- `approval_business_type_source_rules`
- `approval_business_type_merge_rules`
- `approval_template_routing_rules`
- `approval_role_aliases`
- `approval_engine_settings`
- `approval_template_nodes.scope_strategy`
- `approval_template_nodes.scope_source`
- `approval_template_nodes.runtime_scope_type`
- `approval_template_nodes.runtime_node_key_template`
- `approval_template_nodes.missing_assignee_policy`
- `approval_template_edges.scope_join_policy`

周表模板当前规则：

- submitter 节点使用 `submitter_virtual`；
- 审批节点按 `per_project` 展开；
- runtime scope 为 `project`；
- 缺失项目审批人使用 `skip`，不回退到 admin。

## 内部 helper 与验证

数据驱动审批相关 helper：

- `psa_resolve_document_business_type(...)`
- `psa_select_approval_template(...)`
- `psa_resolve_role_candidates(...)`
- `psa_expand_approval_template(...)`
- 5 参数内部 `psa_resolve_graph_assignees(...)`

这些 helper 是内部函数，即使使用 `SECURITY DEFINER`，也不应直接 grant 给 `authenticated`。

部署后验证脚本：

- `scripts/assert-timesheet-data-driven-approval.sql`
- `scripts/assert-timesheet-template-routing.sql`
- `scripts/smoke-timesheet-submit-contract-routing.sql`
- `scripts/smoke-timesheet-special-day-create-no-pkey.sql`
- `scripts/assert-function-grants.sql`

## 仍需收敛的差距

审批运行时已经数据驱动，但管理界面还未完全数据驱动：

- 审批模板页面暂未暴露 `scope_strategy`、`scope_source`、`runtime_scope_type`、`runtime_node_key_template`、`missing_assignee_policy`；
- routing rules、business type rules、role aliases 仍由 migration seed，不由 UI 管理；
- 历史已完成审批图作为审计记录保留，不重建。

当前发布可接受，因为新提交单据走数据驱动引擎，历史图保持稳定。

## 数据库整改方向

当前数据库能支撑业务，但历史模型、兼容层和补丁层叠加明显。整改顺序：

1. 盘点生产数据、表引用和候选退役表行数，准备回滚 SQL。
2. 新增代码只使用 `approval_*`、`project_roles`、`role_permissions` 等当前事实源。
3. 优先把项目列表、周报、人工矩阵的前端全量聚合迁移到 view/RPC。
4. 迁移 `project_department_owners`、`approval_logs`、`workflow_templates`、`workflow_steps` 等旧模型。
5. 清理迁移辅助表、历史审计表和不再消费的缓存表。

核心原则：

- 引用 `employees(id)` 的字段应逐步统一为 `*_employee_id`。
- `project_roles` 应成为项目角色/负责人唯一配置源。
- `approval_events` 应成为审批事件唯一事实源。
- `permission_roles`、`permission_resources`、`role_permissions` 是平台权限配置事实源。
- 新增索引前先用生产数据跑 `EXPLAIN ANALYZE`。

## 架构验收清单

- 员工创建、编辑、禁用、登录、改密流程正常。
- 周表保存、提交、驳回、重提、审批通过流程正常。
- 项目负责人变更后，待审批路由正确刷新。
- 权限配置变更后，菜单、接口、RLS 行为一致。
- 项目列表、周报、人工矩阵不依赖前端全量扫描明细。
- 删除或归档旧表前，有完整备份和回滚方案。
- 新增 SQL migration 可重复执行，并覆盖 PostgREST schema 刷新。
