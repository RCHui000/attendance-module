# PSA Approval Graph B 路线落地方案

版本：VNext  
路线：B - PSA 专用图形审批模块  
状态：执行方案  
适用范围：Timesheet / Contract / Overtime / Payroll Confirmation / Future PSA Documents

## 1. 架构定位

本方案不建设通用 BPM / Workflow Engine。

Approval Graph 仅作为 PSA 审批执行模型，用于解决 PSA 业务中的复杂审批问题：

- Timesheet 周表项目块并行审批
- Contract 的 PM / CC / PMCC 差异化审批路径
- Overtime 及未来 PSA 单据审批
- Payroll Confirmation 工资单确认
- 合同报批、合同变更、成本相关报批
- 动态项目角色解析
- 多轮重审
- 审批图追溯

本方案暂不支持：

- 可视化流程设计器
- 任意脚本节点
- 子流程
- 循环流程
- 外部事件等待节点
- 跨系统通用流程编排
- 局部修订复用
- BPMN 级别流程能力

核心原则：

```text
单据是业务状态
审批是执行图
待办是节点投影
个人动作是 assignee 决策
历史是不可变事件
模板快照保证追溯
```

## 2. 总体目标

废弃以 `workflow_tasks` 为核心的审批模型，将审批事实源迁移到：

- `business_documents`
- `approval_templates`
- `approval_template_nodes`
- `approval_template_edges`
- `approval_instances`
- `approval_rounds`
- `approval_nodes`
- `approval_node_assignees`
- `approval_edges`
- `approval_events`
- `project_roles`

`workflow_tasks` 最终仅作为：

- 待办箱缓存
- 通知分发缓存
- UI 快速查询投影

不得再作为审批事实源。

## 3. 状态模型

### 3.1 单据生命周期

`business_documents.lifecycle_status`：

```text
draft
in_approval
revision_required
approved
cancelled
archived
```

说明：

- 只表达单据整体生命周期。
- 不表达当前审批节点。
- 不表达审批人动作。

### 3.2 审批实例状态

`approval_instances.status`：

```text
running
waiting_revision
approved
rejected
cancelled
```

### 3.3 审批轮次状态

`approval_rounds.status`：

```text
running
waiting_revision
approved
rejected
cancelled
```

### 3.4 审批节点状态

`approval_nodes.status`：

```text
pending
active
approved
rejected
skipped
cancelled
waiting_revision
```

### 3.5 审批人动作状态

`approval_node_assignees.status`：

```text
pending
approved
rejected
delegated
skipped
cancelled
```

## 4. 数据库结构

### 4.1 business_documents

统一审批入口。

```sql
create table business_documents (
  id uuid primary key,
  document_type text not null,
  business_id uuid not null,
  business_version int not null default 1,
  creator_user_id uuid not null,
  creator_employee_id uuid,
  creator_org_id uuid,
  project_id uuid,
  business_type text,
  lifecycle_status text not null,
  submitted_at timestamptz,
  approved_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (document_type, business_id, business_version)
);
```

约定：

- `document_type` 示例：`timesheet` / `contract` / `overtime` / `payroll_confirmation` / `contract_approval`。
- `business_type` 示例：`PM` / `CC` / `PMCC` / `standard`。
- 业务版本由业务模块维护，审批模块只引用。

### 4.2 approval_templates

```sql
create table approval_templates (
  id uuid primary key,
  template_key text unique not null,
  document_type text not null,
  business_type text,
  name text not null,
  version int not null,
  status text not null,
  created_at timestamptz default now()
);
```

约定：

- 模板可编辑。
- 审批实例创建时必须冻结模板快照。
- 历史审批不得依赖当前模板定义。

### 4.3 approval_template_nodes

```sql
create table approval_template_nodes (
  id uuid primary key,
  template_id uuid references approval_templates(id),
  node_key text not null,
  node_name text not null,
  node_type text not null,
  resolver_type text not null,
  resolver_role text,
  approval_policy text not null,
  reject_policy text not null,
  allow_delegate boolean default false,
  allow_skip boolean default false,
  sort_order int not null,
  unique (template_id, node_key)
);
```

约束：

- `node_type` 只允许：`approval` / `condition` / `merge` / `notify` / `auto`。
- `resolver_type` 只允许：`project_role` / `org_manager` / `fixed_user` / `document_creator` / `expression_limited`。
- `approval_policy` 只允许：`all` / `any` / `single` / `auto_pass`。
- `reject_policy` 只允许：`back_to_creator` / `back_to_previous` / `back_to_node`。
- 不支持 `partial_revision`。
- 不支持任意脚本节点。

### 4.4 approval_template_edges

```sql
create table approval_template_edges (
  id uuid primary key,
  template_id uuid references approval_templates(id),
  from_node_key text not null,
  to_node_key text not null,
  condition_expr jsonb,
  edge_type text default 'normal'
);
```

约定：

- `condition_expr` 只允许受限 JSON 条件表达式。
- 不允许执行数据库动态 SQL。
- 不允许执行用户输入脚本。

### 4.5 approval_instances

```sql
create table approval_instances (
  id uuid primary key,
  document_id uuid references business_documents(id),
  template_id uuid references approval_templates(id),
  template_version int not null,
  template_snapshot jsonb not null default '{}'::jsonb,
  status text not null,
  current_round int default 1,
  started_at timestamptz default now(),
  completed_at timestamptz,
  created_by uuid not null
);
```

关键规则：

- `template_snapshot` 是审批实例创建时的完整模板冻结结果。
- 历史详情、审计、图渲染优先使用实例快照。
- 当前模板修改不得影响已创建实例。

### 4.6 approval_rounds

```sql
create table approval_rounds (
  id uuid primary key,
  instance_id uuid references approval_instances(id),
  round_no int not null,
  reason text,
  status text not null,
  created_by uuid,
  created_at timestamptz default now(),
  completed_at timestamptz,
  unique (instance_id, round_no)
);
```

约定：

- 每次重审创建新 round。
- 新 round 重新生成完整节点和边。
- 不复用旧 round 的节点。
- 旧 round 只作为历史保留。

### 4.7 approval_nodes

```sql
create table approval_nodes (
  id uuid primary key,
  instance_id uuid references approval_instances(id),
  round_id uuid references approval_rounds(id),
  template_node_key text not null,
  node_name text not null,
  node_type text not null,
  scope_type text,
  scope_id uuid,
  resolver_type text not null,
  resolver_role text,
  status text not null,
  activated_at timestamptz,
  completed_at timestamptz,
  result_action text,
  comment text,
  snapshot jsonb not null default '{}'::jsonb
);
```

说明：

- 节点表达审批步骤，不直接表达多个审批人的个人动作。
- 多人会签、或签、单人审批统一落到 `approval_node_assignees`。
- `snapshot` 保存节点生成时的 resolver 输入、解析结果、业务上下文摘要。

### 4.8 approval_node_assignees

```sql
create table approval_node_assignees (
  id uuid primary key,
  node_id uuid references approval_nodes(id),
  assignee_user_id uuid not null,
  assignee_employee_id uuid,
  assignee_org_id uuid,
  status text not null,
  action text,
  comment text,
  acted_at timestamptz,
  created_at timestamptz default now(),
  unique (node_id, assignee_user_id)
);
```

用途：

- 支持 `all` 会签。
- 支持 `any` 或签。
- 支持 `single` 单人审批。
- 支持转交、跳过、取消。

### 4.9 approval_edges

```sql
create table approval_edges (
  id uuid primary key,
  instance_id uuid references approval_instances(id),
  round_id uuid references approval_rounds(id),
  from_node_id uuid references approval_nodes(id),
  to_node_id uuid references approval_nodes(id),
  edge_type text default 'normal',
  condition_result boolean default true,
  created_at timestamptz default now(),
  unique (round_id, from_node_id, to_node_id)
);
```

### 4.10 approval_events

```sql
create table approval_events (
  id uuid primary key,
  instance_id uuid references approval_instances(id),
  round_id uuid references approval_rounds(id),
  node_id uuid references approval_nodes(id),
  assignee_id uuid references approval_node_assignees(id),
  actor_user_id uuid,
  actor_employee_id uuid,
  event_type text not null,
  from_status text,
  to_status text,
  request_id text,
  comment text,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
```

规则：

- `approval_events` append-only。
- 不允许业务代码更新或删除历史事件。
- 所有审批状态变更必须写事件。
- `request_id` 用于接口幂等。

### 4.11 project_roles

```sql
create table project_roles (
  id uuid primary key,
  project_id uuid not null,
  org_id uuid,
  role_key text not null,
  employee_id uuid not null,
  user_id uuid not null,
  valid_from date,
  valid_to date,
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

必须废弃：

```text
projects.project_owner_id
```

审批节点生成时必须固化项目角色解析结果，不得在审批历史查询时重新动态解析当前负责人。

## 5. 图执行规则

### 5.1 图结构限制

本路线只支持 DAG。

创建审批实例时必须校验：

- 不允许循环。
- 每个模板至少有一个起始节点。
- 除起始节点外，每个节点必须有前置节点。
- 条件边必须能被受限表达式求值。
- `from_node_key` 和 `to_node_key` 必须存在。
- 同一模板版本下 `node_key` 唯一。

### 5.2 节点激活

提交后：

1. 创建 round。
2. 生成本轮完整节点。
3. 生成本轮完整边。
4. 找出入度为 0 的节点。
5. 将这些节点置为 `active`。
6. 为 active 节点生成 assignee 待办。

后继节点激活条件：

- 所有有效前置边的来源节点均达到完成态。
- 完成态包括：`approved` / `skipped`。
- `rejected` / `waiting_revision` / `cancelled` 不满足后继激活。

### 5.3 节点完成

`approval_policy` 决定节点何时完成：

- `single`：唯一 assignee 审批通过后，节点通过。
- `all`：全部 assignee 审批通过后，节点通过。
- `any`：任一 assignee 审批通过后，节点通过，其余 assignee 取消。
- `auto_pass`：系统自动通过。

任一 assignee 驳回时：

- 节点进入 `rejected` 或 `waiting_revision`。
- 当前 round 进入 `waiting_revision` 或 `rejected`。
- 单据进入 `revision_required`。
- 后继节点不得继续激活。

### 5.4 终止条件

一个 round 被批准的条件：

- 所有 terminal nodes 均处于完成态。
- terminal nodes 指没有有效后继边的节点。

round 批准后：

- `approval_rounds.status = approved`
- `approval_instances.status = approved`
- `business_documents.lifecycle_status = approved`
- 写入 approve 相关事件

### 5.5 重审规则

不做局部修订复用。

`reopen_document` / `revise_document` 规则：

1. 业务模块先生成新的业务版本。
2. 当前 round 标记为 `waiting_revision` 或 `rejected`。
3. 创建新的 approval_round。
4. 基于当前业务版本重新解析模板。
5. 重新生成完整 approval_nodes。
6. 重新生成完整 approval_edges。
7. 激活新 round 的起始节点。
8. 旧 round 保留为历史，不参与新 round 执行。

## 6. RPC 接口

最终保留：

- `submit_document`
- `approve_node`
- `reject_node`
- `revise_document`
- `reopen_document`
- `delegate_node`
- `skip_node`

废弃：

- `psa_timesheet_action`
- 以 `workflow_tasks` 驱动审批的 RPC

### 6.1 submit_document

输入：

- `document_type`
- `business_id`
- `business_version`
- `business_type`
- `creator_user_id`
- `context`
- `request_id`

执行：

1. 创建或读取 `business_documents`。
2. 查找匹配模板。
3. 冻结模板到 `template_snapshot`。
4. 创建 `approval_instances`。
5. 创建 `approval_rounds` round 1。
6. 解析节点审批人。
7. 生成 nodes / assignees / edges。
8. 激活起始节点。
9. 写 `approval_events`。
10. 更新单据状态为 `in_approval`。

### 6.2 approve_node

输入：

- `node_id`
- `actor_user_id`
- `comment`
- `request_id`

执行：

1. 校验节点 active。
2. 校验 actor 是当前 pending assignee。
3. 使用条件更新写入 assignee approve 状态。
4. 写事件。
5. 按 approval_policy 判断节点是否完成。
6. 若节点完成，激活满足条件的后继节点。
7. 若 terminal nodes 全部完成，完成 round / instance / document。

### 6.3 reject_node

输入：

- `node_id`
- `actor_user_id`
- `reject_policy`
- `target_node_key`
- `comment`
- `request_id`

执行：

1. 校验节点 active。
2. 校验 actor 是当前 pending assignee。
3. 写 assignee reject。
4. 写节点 reject 或 waiting_revision。
5. 写事件。
6. round 进入 `waiting_revision`。
7. instance 进入 `waiting_revision`。
8. document 进入 `revision_required`。

### 6.4 revise_document / reopen_document

执行：

1. 校验 document 当前为 `revision_required` 或允许重开。
2. 校验业务版本已更新。
3. 创建新 round。
4. 重新生成完整审批图。
5. 激活起始节点。
6. document 回到 `in_approval`。

### 6.5 delegate_node

执行：

1. 校验节点允许转交。
2. 校验 actor 是当前 pending assignee。
3. 当前 assignee 标记 `delegated`。
4. 创建新 assignee。
5. 写 delegate 事件。

### 6.6 skip_node

执行：

1. 校验节点允许跳过。
2. 校验 actor 有管理员或流程管理权限。
3. 节点标记 `skipped`。
4. 当前 pending assignees 标记 `skipped`。
5. 写 skip 事件。
6. 激活满足条件的后继节点。

## 7. 前端改造

### 7.1 待审批

不再直接查询 `workflow_tasks`。

```sql
select n.*, a.*
from approval_nodes n
join approval_node_assignees a on a.node_id = n.id
where n.status = 'active'
  and a.status = 'pending'
  and a.assignee_user_id = :current_user_id;
```

### 7.2 已审批

```sql
select n.*, a.*
from approval_nodes n
join approval_node_assignees a on a.node_id = n.id
where a.status in ('approved', 'rejected', 'delegated', 'skipped')
  and a.assignee_user_id = :current_user_id;
```

### 7.3 审批详情

统一查询：

- `business_documents`
- `approval_instances`
- `approval_rounds`
- `approval_nodes`
- `approval_node_assignees`
- `approval_edges`
- `approval_events`

前端应支持：

- 当前 round 审批图
- 历史 round 切换
- 节点状态展示
- 审批人动作展示
- 事件时间线展示

## 8. 业务模板

### 8.1 PM 合同

```text
PM 员工
  -> PM 项目负责人
  -> PM 部门负责人
```

### 8.2 CC 合同

```text
CC 员工
  -> CC 项目负责人
  -> CC 部门负责人
```

### 8.3 PMCC 合同

```text
成本合约员工
  -> 成本合约项目负责人
  -> PM 成本负责人
  -> PM 项目负责人
  -> PM 部门负责人
```

### 8.4 周表

```text
Project A Review ┐
Project B Review ├ -> Department Summary Review
Project C Review ┘
```

要求：

- 每个项目块生成独立 project scope 节点。
- 所有项目负责人审批完成后，才激活部门汇总审批。

### 8.5 工资单确认

```text
Payroll Generate
  -> Employee Confirmation
  -> HR Review
  -> Finance Final Review
```

说明：

- 员工确认可以使用 `single`。
- 如果一个工资批次包含多人，建议每个员工工资单作为独立 business document，工资批次只做聚合视图。

### 8.6 合同报批

```text
Contract Submitter
  -> Project Role Review
  -> Department Review
  -> Finance / Cost Review
  -> Final Approval
```

说明：

- 根据 `business_type` 选择 PM / CC / PMCC 模板。
- 成本、财务、部门负责人通过 resolver 解析。

## 9. 幂等与并发要求

所有 RPC 必须支持 `request_id`。

要求：

- 同一 `request_id` 重复调用不得产生重复事件。
- 节点审批必须使用条件更新，例如 `where status = 'active'`。
- assignee 审批必须使用条件更新，例如 `where status = 'pending'`。
- 后继节点激活必须防重。
- round 完成必须防重。
- document approved 写入必须防重。

建议索引：

```sql
create unique index approval_events_request_uidx
on approval_events(instance_id, request_id)
where request_id is not null;

create index approval_nodes_active_idx
on approval_nodes(status, round_id);

create index approval_assignees_todo_idx
on approval_node_assignees(assignee_user_id, status);
```

## 10. 实施阶段

### Phase 1 - 数据模型落地

目标：

- 新建 Approval Graph 相关表。
- 增加约束和索引。
- 不改动现有业务功能。

任务：

- 编写数据库 migration。
- 创建状态枚举或 check constraint。
- 创建基础索引。
- 保留 `workflow_tasks`，但不新增其审批核心职责。

验收：

- migration 可重复在空库执行。
- 所有表、约束、索引创建成功。
- 不影响现有 Timesheet / Contract 页面运行。

### Phase 2 - 项目角色模型

目标：

- 引入 `project_roles`。
- 废弃审批逻辑对 `projects.project_owner_id` 的依赖。

任务：

- 创建项目角色维护接口。
- 创建 resolver：`project_role`。
- 在节点 snapshot 中保存角色解析结果。

验收：

- 同一项目可配置 PM、CC、成本、设计等不同负责人。
- 审批实例创建后，后续项目负责人变化不影响历史实例。

### Phase 3 - 模板与图生成

目标：

- 建立模板定义。
- 支持从模板生成审批实例图。

任务：

- 实现模板查询。
- 实现模板快照冻结。
- 实现 DAG 校验。
- 实现 nodes / assignees / edges 生成。
- 实现起始节点激活。

验收：

- PM / CC / PMCC 合同模板可生成审批图。
- 周表可按项目块生成并行审批图。
- 生成结果可被前端查询。

### Phase 4 - 核心 RPC

目标：

- 用新模型完成审批执行。

任务：

- 实现 `submit_document`。
- 实现 `approve_node`。
- 实现 `reject_node`。
- 实现 `revise_document` / `reopen_document`。
- 实现 `delegate_node`。
- 实现 `skip_node`。
- 所有 RPC 写 `approval_events`。
- 所有 RPC 支持 `request_id` 幂等。

验收：

- 单人审批可通过。
- 会签 `all` 可通过。
- 或签 `any` 可通过。
- 并行项目块审批后可汇聚到部门审批。
- 驳回后单据进入 `revision_required`。
- 重审创建新 round，并重新生成完整图。

### Phase 5 - 前端审批中心

目标：

- 前端从 Approval Graph 查询审批数据。

任务：

- 改造待审批列表。
- 改造已审批列表。
- 增加审批详情图视图。
- 增加 round 切换。
- 增加事件时间线。

验收：

- 用户能看到自己的 active assignee 待办。
- 用户能看到已处理审批。
- 单据详情能展示当前审批图。
- 历史 round 可追溯。

### Phase 6 - 业务接入

目标：

- Timesheet / Contract / Overtime / Payroll Confirmation 接入新审批模型。

任务：

- Timesheet 接入项目块并行审批。
- Contract 接入 PM / CC / PMCC 模板。
- Overtime 接入标准模板。
- Payroll Confirmation 接入员工确认模板。
- 合同报批接入合同审批模板。

验收：

- 新提交单据不再通过旧 `workflow_tasks` 驱动审批。
- 旧 RPC 不再作为审批事实源。
- `workflow_tasks` 只作为可选待办投影。

### Phase 7 - 清理旧审批入口

目标：

- 去除旧审批路径的核心地位。

任务：

- 标记 `psa_timesheet_action` 废弃。
- 清理以 `workflow_tasks` 为判断依据的审批逻辑。
- 保留必要兼容查询或只读历史。
- 更新使用说明和运维文档。

验收：

- 新审批路径完全基于 Approval Graph。
- 审批历史来自 `approval_events`。
- 待办可由 `approval_nodes + approval_node_assignees` 重建。

## 11. Agent 执行要求

执行 agent 必须遵守：

1. 不要把本方案扩展成通用 BPM 引擎。
2. 不要引入可视化流程设计器。
3. 不要支持任意脚本执行。
4. 不要实现局部修订复用。
5. 每个阶段完成后必须提供 migration、代码变更、测试说明。
6. 涉及审批状态变更的代码必须写事件。
7. 涉及审批动作的 RPC 必须幂等。
8. 不得让 `workflow_tasks` 重新成为审批事实源。

## 12. 最小测试清单

### 单元测试

- 模板 DAG 校验。
- project role resolver。
- org manager resolver。
- approval_policy：`single` / `all` / `any` / `auto_pass`。
- reject_policy：`back_to_creator` / `back_to_previous` / `back_to_node`。
- terminal node 判断。
- 后继节点激活。
- request_id 幂等。

### 集成测试

- PM 合同完整审批。
- CC 合同完整审批。
- PMCC 合同完整审批。
- 周表多项目并行审批后汇总审批。
- 任一节点驳回进入 revision_required。
- revise 后创建新 round。
- delegate 后原审批人不可再审批。
- skip 后后继节点正确激活。

### 回归测试

- 现有单据创建不受影响。
- 现有用户登录和权限不受影响。
- 现有报表不因新表上线失败。
- 旧审批历史可保留查询。

## 13. 完成定义

本重构完成的标准：

- 新单据审批事实源为 Approval Graph。
- `workflow_tasks` 不再驱动审批状态。
- 审批中心从 `approval_nodes + approval_node_assignees` 查询待办。
- 审批详情可展示 nodes / edges / events。
- PM / CC / PMCC、周表并行审批、工资单确认、合同报批均可通过模板表达。
- 每次审批动作都有不可变事件记录。
- 模板修改不影响历史审批实例。
- 重审通过新 round 完整重建审批图实现。
