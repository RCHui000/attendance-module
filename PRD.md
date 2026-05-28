# 工时统计系统 PRD

## 1. 背景

公司当前通过个人 Excel 表统计考勤、项目工时和薪酬核算数据。现有方式存在以下问题：

- 员工手工填写，汇总依赖人工整理。
- 项目工日归集不稳定，难以追溯。
- 考勤、加班、薪酬、组织信息分散。
- 审批和归档缺少系统状态与审计记录。
- 工资核算依赖手工统计后的二次计算。

本项目目标是建设一个内部工时统计系统，将员工周表、项目工日、组织架构、薪酬基础、审批与统计导出统一管理。

## 2. 产品目标

建立一个较成熟的内部工时统计系统，支持：

- 员工按周填写项目工日比例。
- 每日项目比例合计不得超过 100%。
- 周表满勤按 6 工日进行提示。
- 加班 OT 独立记录并支持审批。
- 主管审批员工周表。
- 管理员维护员工、组织、合同与薪酬基础。
- 项目工日自动汇总，用于审批复核、成本核算和导出。
- 后续可扩展到薪酬核算、调休、请假、补卡、月度锁定和归档。

## 3. 角色与权限

### 3.1 员工

- 查看和填写自己的周表。
- 保存草稿。
- 提交周表。
- 查看自己的审批状态。
- 填写每日加班时长。

员工不得：

- 切换查看其他员工周表。
- 访问员工组织管理。
- 访问全局项目汇总。
- 审批周表或加班。

### 3.2 主管

- 查看审批中心。
- 审批或退回已提交的周表。
- 查看项目工日统计。
- 审批加班 OT。

后续正式系统中，主管应仅能查看和审批自己管辖范围内的员工。

### 3.3 管理员

- 拥有主管权限。
- 访问员工与组织管理。
- 新增雇佣。
- 编辑员工档案、合同、薪酬基础。
- 维护所属部门。
- 锁定或解锁员工行，避免误触。
- 查看和导出项目工日统计。

特殊账号约定：

- `admin` 为开发测试系统账号，拥有全部权限，但不纳入员工与组织架构，不占部门人数，不参与薪酬、合同和直属领导配置。
- 鞠松松为业务管理人员账号，拥有全部权限，同时纳入员工与组织架构中的管理人员列表，可作为部门负责人、直属领导和审批人。
- Demo 中不保留“赵人事”等模拟人事人员。

### 3.4 后续扩展角色

- 人事管理员：维护员工组织、合同、聘用状态。
- 薪酬管理员：维护薪酬字段，生成工资核算数据。
- 财务/成本岗：只读查看已审批或已锁定后的项目工日和人工成本。
- 审计员：只读查看审批、锁定、修改和导出日志。

## 4. 核心业务规则

## 4.1 周表规则

- 周表以员工为主体。
- 每名员工每周只能有一张周表。
- 一周按 7 个自然日展示。
- 满勤提示按 6 工日。
- 每天是 1 工日。
- 员工按项目填写百分比，例如填写 `40` 表示 `40%`。
- 每日所有项目比例合计不得超过 `100%`。
- 每日合计超过 `100%` 时不允许提交。
- 未满 100% 可以提示未满 1 工日，但是否允许提交可配置。
- 项目行可以新增和删除。
- 项目工日汇总时，系统内部按 `0.4` 表示 `40%` 工日。

## 4.2 加班 OT 规则

- 周表下方增加每日加班时长行。
- 加班单位为小时。
- 加班可与周表一起提交。
- 加班 OT 需要独立审批。
- 周表审批通过不代表 OT 自动通过。
- OT 通过后可用于后续倒休、薪酬或工时安排。
- OT 退回必须填写原因。

后续 OT 状态建议：

```text
draft -> submitted -> approved / rejected -> settled
```

## 4.3 审批规则

周表状态建议采用轻量状态机：

```text
draft 草稿
submitted 已提交
approved 已通过
rejected 已退回
locked 已锁定
voided 已作废
```

允许流转：

```text
draft/rejected -> submitted
submitted -> approved
submitted -> rejected
approved -> locked
approved/rejected -> draft（管理员重开）
```

规则：

- 所有状态变化必须通过事件触发。
- 不允许直接任意更新状态。
- 员工只能提交自己的周表。
- 审批任务必须路由到具体审核人，不只按 `manager` 角色泛化展示。
- 审核人解析优先级：员工档案 `manager_user_id`（直属领导） -> 所属部门 `organizations.manager_user_id`（部门负责人） -> 管理员兜底。
- 主管只能查看和处理分配给自己的审批任务；管理员可查看和处理全部任务。
- 锁定后原则上不允许修改原始周表。
- 锁定后如需调整，应通过调整单进入后续周期。

## 5. 功能模块

## 5.1 登录模块

### MVP

- 支持账号密码登录。
- 使用 Cookie Session。
- 管理员创建账号。
- 不开放公众注册。
- 当前 Demo 默认账号：

```text
admin / 123456
jss / 123456
zhangchen / 123456
```

新增员工和管理人员时，系统应自动创建登录账号；如未填写账号，默认登录名为员工姓名，初始密码为 `123456`。当前 Demo 暂未暴露独立账号字段，因此人员账号默认随姓名同步，`admin` 等系统账号除外；正式系统增加账号字段后，应通过 `login_auto_synced` 或类似标记区分自动账号和手动账号。编辑员工信息不得重置已有账号密码。登录页必须提供修改密码入口，不展示演示账号提醒。

### 正式版建议

- 优先接入企业 SSO/OIDC。
- 可对接企业微信、钉钉、飞书、Azure AD、Keycloak 等。
- 后端从 session/token 获取当前用户。
- 所有业务接口不得信任前端传入的 `userId`。
- 迁移 Supabase 时，可使用 Supabase Auth + RLS。

## 5.2 我的周表

用途：员工填写本人每周项目工日和加班时长。

主要元素：

- 当前员工信息。
- 周选择组件。
- 周表状态。
- 项目工日比例表。
- 每日合计。
- 加班时长。
- 周备注。
- 保存草稿。
- 提交审核。

交互要求：

- 周切换组件应放在周表标题右侧，减少鼠标移动距离。
- 项目表头右侧提供添加项目行按钮。
- 输入项目比例时使用整数百分比。
- 每日合计超过 100% 时高亮提示。
- 已提交、已通过、已锁定状态下不可编辑。

## 5.3 审批中心

用途：主管或管理员处理已提交的周表和加班 OT。

页面分区：

### 顶部：待审批周表

展示 `submitted` 状态的周表任务。

字段：

- 员工
- 部门
- 周期
- 提交时间
- 本周工日
- 状态
- 操作

操作：

- 通过
- 退回

退回必须填写原因。

### 下方左侧：加班 OT 审批

展示待审批 OT。

字段：

- 员工
- 日期
- 加班小时
- 原因
- 关联周表状态
- OT 状态
- 操作

操作：

- 通过 OT
- 退回 OT

### 下方右侧：扩展预留

预留给：

- 请假审批
- 补卡审批
- 调休审批
- 月度锁定
- 异常考勤处理

## 5.4 员工与组织管理

仅管理员可见。

目标：维护员工档案、组织归属、雇佣状态、合同类型、聘用期和薪酬基础。

### 页面结构

- 部门/组织列表。
- 员工列表。
- 管理人员列表。
- 新增员工 / 新增管理人员按钮。
- 顶部删除按钮：先选中列表人员，再执行删除，避免列表内误触。
- 行级编辑与保存。

### 员工列表字段

- 操作
- 员工编号
- 姓名
- 所属部门
- 岗位
- 雇佣状态
- 合同类型
- 聘用期
- 工龄
- 薪酬类型
- 月薪/日薪
- 入职日期
- 直属领导
- 操作

### 新增雇佣

字段：

- 员工编号
- 姓名
- 登录账号
- 初始密码
- 所属部门
- 岗位
- 雇佣状态
- 入职日期
- 合同类型
- 合同时长（月）
- 月薪或日薪
- 直属主管

### 雇佣状态

建议状态：

```text
pending 待入职
active 在职
terminated 已解聘
suspended 停用
```

Demo 未正式上线前：

- 员工/管理人员删除采用硬删除。
- 删除人员时同步删除账号、员工档案、会话、测试周表、测试 OT、审批任务和相关审批日志。
- 删除后员工编号和登录账号应立即释放，可重新添加同名人员或同编号人员。

正式上线后：

- 解聘不删除历史业务数据，只更新雇佣状态并停用账号。
- 正式系统应保留历史周表、审批、薪酬和审计记录。

组织归属口径：

- 在职人员必须归属于一个有效部门。
- 正式上线后，解聘人员应解除当前 `org_id` 和 `manager_user_id`，历史周表、审计、薪酬记录通过快照字段保留当时的部门名称和人员信息。
- 部门列表人数只统计当前有效人员。
- 删除部门时，只允许删除没有子部门、且没有当前有效人员挂靠的部门。
- Demo 硬删除人员不得阻止空部门删除；正式上线后的已解聘人员历史档案也不得阻止空部门删除。
- 若部门负责人被删除或解聘，应自动清空该部门负责人。
- 正式上线后，如员工编号或登录账号命中已解聘/已停用人员，应视为“重新启用历史人员”，复用原 `user_id` 并更新角色、部门、合同与薪酬；Demo 阶段因采用硬删除，不需要复用历史人员。

解聘应记录：

- 解聘日期
- 解聘原因
- 是否停止后续排班
- 是否停止薪酬计算
- 备注

### 合同类型

建议类型：

```text
labor 劳动合同
service 劳务合同
intern 实习
part_time 兼职
outsourced 外包
```

### 薪酬字段

劳动合同月薪：

- `contract_type = labor`
- `salary_mode = monthly_salary`
- `monthly_salary` 必填
- `standard_monthly_workdays` 默认 21.75

折算：

```text
折算日薪 = monthly_salary / standard_monthly_workdays
```

劳务合同日薪：

- `contract_type = service`
- `salary_mode = daily_wage`
- `daily_wage` 必填
- 不依赖 21.75 计薪天数

工资核算：

```text
劳务工资 = 已审批实际工日 * daily_wage
```

### 行锁定

员工行默认可锁定，防止误触。

锁定后：

- 禁止编辑姓名、部门、岗位、合同、薪酬、聘用期、状态。
- 允许查看。
- 允许管理员解锁。

解锁建议要求填写原因，并写入审计日志。

## 5.5 项目工日统计

导航建议命名为：`项目工日统计`。

页面目的：

> 汇总员工周表沉淀出的项目工日，用于主管复核、管理员导出和后续人工成本核算。

它不是项目管理后台，不负责项目进度和项目资料维护。

可见角色：

- 主管
- 管理员
- 后续财务/成本岗

关键指标：

- 已填报员工
- 本周项目工日
- 有投入项目
- 待审核周表
- 已通过周表

表格字段：

- 项目编号
- 项目名称
- 投入人数
- 汇总工日
- 工日占比

后续扩展：

- 按部门筛选。
- 按员工筛选。
- 按周表状态筛选。
- 点击项目查看员工、日期、工日、备注明细。
- 只统计已通过/已锁定数据。
- 生成项目人工成本。

## 6. 数据模型建议

## 6.1 users

登录与基础身份。

字段：

- id
- name
- role
- department
- is_active

正式版建议拆分为：

- `auth_users`
- `employees`
- `user_roles`

## 6.2 organizations

组织架构。

字段：

- id
- org_code
- org_name
- parent_id
- org_type
- manager_user_id
- status

## 6.3 employee_profiles

员工档案与薪酬基础。

字段：

- user_id
- employee_no
- org_id
- position_name
- employment_type
- contract_type
- monthly_salary
- daily_wage
- standard_monthly_workdays
- hire_date
- contract_start
- contract_end
- status
- manager_user_id
- row_locked

## 6.4 timesheets

周表主表。

字段：

- id
- user_id
- week_start_date
- status
- remark
- review_comment
- submitted_at
- approved_by
- approved_at
- updated_at

唯一约束：

```text
user_id + week_start_date
```

## 6.5 timesheet_entries

项目工日明细。

字段：

- timesheet_id
- project_id
- work_date
- hours
- description

说明：

- `hours` 实际代表工日比例。
- `1` 表示 1 工日。
- `0.4` 表示 40% 工日。

## 6.6 overtime_entries

加班明细。

字段：

- timesheet_id
- work_date
- overtime_hours
- reason
- status
- approved_by
- approved_at
- reject_comment

## 6.7 approval_logs

审批日志。

建议扩展字段：

- target_type
- target_id
- from_status
- to_status
- actor_id
- action
- comment
- created_at

## 6.8 workflow_tasks / approval_tasks

审批任务表。周表和 OT 提交后必须生成审批任务，状态流转由工作流配置控制。

字段：

- workflow_key
- target_type
- target_id
- status
- assignee_role
- assignee_user_id
- created_by
- created_at
- completed_by
- completed_at
- result_action
- comment

说明：

- `assignee_user_id` 为当前任务的具体审核人。
- 生成任务时根据员工直属领导或部门负责人写入 `assignee_user_id`。
- 审批中心必须按当前登录人的 `assignee_user_id` 过滤待审核任务。
- 管理员账号保留全局兜底查看和处理能力。

## 7. 审计与安全

必须审计的动作：

- 新增雇佣
- 修改部门
- 修改雇佣状态
- 修改薪酬
- 修改合同类型
- 修改聘用期
- 解聘
- 锁定/解锁员工行
- 提交周表
- 审批/退回周表
- 审批/退回 OT
- 导出员工或工日数据

审计内容：

- 操作人
- 操作时间
- 操作类型
- 修改前数据
- 修改后数据
- 操作原因
- IP
- User Agent

## 8. 技术架构设计

## 8.1 架构目标

技术架构需要同时满足两个阶段：

- Demo/MVP 阶段：快速验证业务流程，低依赖、易启动、易修改。
- 正式系统阶段：支持多人并发、权限隔离、审计追溯、薪酬核算和长期数据归档。

架构设计原则：

- 业务规则后端兜底，前端只做体验增强。
- 所有数据访问基于当前登录用户和角色权限。
- 周表、OT、员工薪酬等关键数据必须可追溯。
- 审批状态通过状态机控制，不允许任意改状态。
- 数据库模型尽量按 Postgres 兼容方式设计，避免后续迁移大改。

## 8.2 当前 Demo 架构

当前 Demo 已从 Python 标准库 HTTP Server 迁移为 FastAPI + WebSocket 单体服务：

```text
Browser
  |
  | HTML / CSS / JS / WebSocket
  v
FastAPI / Uvicorn
  |
  | sqlite3
  v
SQLite Database
```

技术组成：

- 前端：原生 HTML / CSS / JavaScript
- 后端：FastAPI + Uvicorn
- 实时同步：FastAPI WebSocket，写操作广播模块更新
- 数据库：SQLite
- 登录：账号密码 + Cookie Session
- 数据文件：`attendance_demo.sqlite3`

优点：

- 启动快。
- 适合内部讨论和流程验证。
- 便于快速调整 PRD 中的业务细节。
- 已具备多客户端变更通知能力。

限制：

- 不适合正式多人并发。
- 权限模型较简化。
- 缺少正式迁移脚本。
- 缺少生产级日志、审计、备份和监控。
- SQLite 不适合承担正式实时协作、长期审计和复杂权限。

## 8.3 正式系统推荐架构

正式系统推荐优先采用 Supabase 作为 Postgres、Auth、RLS 和 Realtime 底座，业务复杂度较高的审批状态机保留服务端函数或后端服务控制：

```text
Web Frontend
  |
  | Supabase Auth / PostgREST / Realtime
  v
Supabase
  |
  | Postgres + RLS + Realtime
  v
Postgres
  |
  | Edge Functions / 后端服务
  v
Workflow / Payroll / Export / Audit Jobs
  |
  | Storage / BI / Payroll Export
  v
Object Storage / BI / Payroll Export
```

推荐技术选型：

- 前端：Vue 3 或 React
- BaaS/数据库：Supabase Postgres
- 登录：Supabase Auth，可后续接企业 SSO/OIDC
- 权限兜底：Supabase RLS
- 实时同步：Supabase Realtime 的 Postgres Changes 或 Broadcast
- 复杂业务：Supabase Edge Functions 或自建 FastAPI 服务
- 文件导出：Edge Function / 后端任务生成 Excel/CSV，文件入 Supabase Storage
- 部署：前端静态托管 + Supabase 云服务；内网部署时可采用自建 Postgres + FastAPI

优先推荐组合：

```text
React/Vue + Supabase Auth + Supabase Postgres + RLS + Realtime
```

如果审批、薪酬、导出任务复杂，增加后端服务：

```text
React/Vue + Supabase + FastAPI Worker/API
```

FastAPI 在正式架构中的定位：

- 不再作为主数据库和认证入口。
- 用于复杂审批状态机、批量导出、薪酬核算、第三方系统集成。
- 使用 Supabase Service Role 仅在服务端执行高权限操作，前端不得持有 Service Role Key。

## 8.4 前端架构

前端应按业务模块组织：

```text
src/
  modules/
    auth/
    timesheet/
    approval/
    overtime/
    employees/
    organizations/
    project-report/
  shared/
    api/
    components/
    permissions/
    utils/
```

核心页面：

- 登录页
- 我的周表
- 审批中心
- 员工与组织
- 项目工日统计
- 后续：薪酬核算、月度锁定、审计日志

前端职责：

- 表单交互。
- 输入校验提示。
- 表格展示。
- 根据后端返回的权限显示菜单和按钮。
- 不负责最终权限判断。

前端不应：

- 自行决定是否有权审批。
- 信任 URL 参数切换员工身份。
- 绕过后端状态机直接改状态。

## 8.5 后端架构

后端建议按领域模块拆分：

```text
backend/
  auth/
  users/
  organizations/
  employees/
  timesheets/
  overtime/
  approvals/
  project_reports/
  payroll/
  audit/
```

后端职责：

- 登录与 session/token 校验。
- 当前用户识别。
- RBAC 和数据范围校验。
- 周表保存、提交和审批。
- OT 审批。
- 员工组织维护。
- 项目工日统计。
- 薪酬核算数据准备。
- 审计日志写入。

所有写操作应放在数据库事务中。

关键接口应遵循：

```text
POST /api/login
POST /api/logout
GET  /api/me

GET  /api/timesheets/current
POST /api/timesheets/save
POST /api/timesheets/submit

GET  /api/approvals/tasks
POST /api/approvals/timesheets/{id}/approve
POST /api/approvals/timesheets/{id}/reject

GET  /api/overtime/tasks
POST /api/overtime/{id}/approve
POST /api/overtime/{id}/reject

GET  /api/employees
POST /api/employees
PATCH /api/employees/{id}
POST /api/employees/{id}/terminate
POST /api/employees/{id}/lock
POST /api/employees/{id}/unlock

GET  /api/project-workdays
GET  /api/audit-logs
```

## 8.6 数据库架构

正式库建议使用 Supabase Postgres。

核心表分组：

### 身份与权限

- `users`
- `auth_accounts` 或外部 IdP 映射表
- `roles`
- `user_roles`
- `sessions`

### 组织与员工

- `organizations`
- `employees`
- `employee_profiles`
- `employee_contracts`
- `employee_salary_profiles`
- `employee_org_assignments` 或在 `employee_profiles` 中维护当前 `org_id`

### 周表与工日

- `timesheets`
- `timesheet_entries`
- `overtime_entries`

### 审批与锁定

- `approval_logs`
- `approval_tasks`
- `workflow_tasks`
- `payroll_periods`
- `payroll_locks`

### 报表与审计

- `project_workday_exports`
- `audit_logs`
- `timesheet_snapshots`

关键约束：

```text
timesheets: UNIQUE(employee_id, week_start_date)
timesheet_entries: hours BETWEEN 0 AND 1
overtime_entries: overtime_hours >= 0
employee_profiles: employee_no UNIQUE
```

组织归属约束：

```text
organizations: 支持 parent_id 形成组织树
employee_profiles.org_id: 仅表示当前有效组织归属
terminated / inactive 员工不应继续占用当前组织节点
历史部门名称应在 timesheets、approval_logs、salary_snapshots 或 audit_logs 中保存快照
删除部门前必须校验无子部门、无 active 员工
```

周表提交时，后端必须校验：

```text
同一员工、同一天，SUM(timesheet_entries.hours) <= 1
```

## 8.7 权限架构

权限采用 RBAC + 数据范围控制。

基础角色：

- employee
- manager
- admin
- hr
- finance
- auditor

数据范围：

- self：本人
- department：本部门
- organization：全组织
- project：指定项目

权限判断必须在后端完成。

示例：

```text
员工保存周表：
current_user.id == timesheet.employee_id

主管审批周表：
current_user.role in manager/admin
AND (
  workflow_tasks.assignee_user_id == current_user.id
  OR current_user.role == admin
)

管理员维护员工：
current_user.role == admin 或 hr
```

正式版使用 Supabase 时，必须使用 RLS 做数据库层兜底。

Supabase RLS 基本要求：

- 员工只能读取和写入自己的周表草稿。
- 主管只能读取/审批分配给自己的员工周表和 OT；部门范围权限只能作为批量授权来源，不能绕过任务指派。
- 管理员/HR 才能维护员工、管理人员、组织架构和薪酬基础。
- 审计日志只允许追加，不允许普通客户端更新或删除。
- 前端使用 anon/authenticated key；Service Role Key 只能放在 Edge Functions 或后端服务中。

## 8.8 状态机架构

周表和 OT 不应直接修改状态，而应通过事件流转。

周表状态机：

```text
draft -> submitted -> approved -> locked
draft -> submitted -> rejected -> submitted
approved -> reopened/draft（管理员）
locked -> adjustment（调整单）
```

OT 状态机：

```text
pending -> approved
pending -> rejected
approved -> settled
```

推荐实现方式：

- MVP：代码中维护状态流转配置。
- 正式版：状态流转配置可表驱动，但不必上完整 BPM 引擎。

状态流转配置示例：

```text
event: submit
from: draft/rejected
to: submitted
roles: employee
validators: daily_total_not_exceed_100

event: approve
from: submitted
to: approved
roles: manager/admin
validators: can_review_scope
```

每次状态变化必须写入审批日志。

## 8.9 审计架构

审计日志独立于业务表。

建议表：`audit_logs`

字段：

- id
- actor_id
- entity_type
- entity_id
- action
- before_json
- after_json
- reason
- ip_address
- user_agent
- created_at

必须审计：

- 登录失败
- 新增员工
- 修改员工薪酬
- 修改合同和聘用期
- 解聘
- 锁定/解锁
- 提交周表
- 审批/退回周表
- 审批/退回 OT
- 导出项目工日
- 月度锁定

审计日志不允许物理删除，只允许归档。

## 8.10 报表与导出架构

项目工日统计页是报表模块，不是项目管理模块。

报表数据来源：

```text
timesheets
timesheet_entries
projects
employees
organizations
```

统计口径应可配置：

- 全部
- 已提交
- 已审批
- 已锁定

正式用于薪酬或成本核算时，建议只统计：

```text
approved / locked
```

导出要求：

- 支持 CSV / Excel。
- 导出时记录导出人、时间、筛选条件。
- 导出的数据应包含统计口径说明。

## 8.11 薪酬核算架构

薪酬核算不应直接写死在周表模块。

建议独立模块：

```text
payroll/
  periods
  salary_profiles
  calculation_items
  exports
```

数据来源：

- 已审批或已锁定周表。
- 员工薪酬档案。
- 合同类型。
- OT 审批结果。

月薪员工：

```text
折算日薪 = monthly_salary / standard_monthly_workdays
缺勤扣款 = 缺勤工日 * 折算日薪
```

日薪员工：

```text
工资 = 审批工日 * daily_wage
```

OT：

- 可转调休。
- 可参与加班工资。
- 可仅做管理记录。

具体规则应配置化。

## 8.12 部署架构

### MVP

```text
单机
FastAPI / Uvicorn 进程
SQLite 文件
本地浏览器访问
```

### 正式部署

```text
Frontend Static Hosting
  |
Supabase Auth
  |
Supabase Postgres + RLS
  |
Supabase Realtime
  |
Supabase Storage / Export Jobs
```

复杂任务可增加：

```text
FastAPI Worker/API
  |
Supabase Service Role
  |
Workflow / Payroll / Export / Integration
```

部署要求：

- HTTPS。
- Supabase 项目备份和迁移脚本。
- 应用日志集中存储。
- 审计日志不可随意删除。
- 定期导出归档。

## 8.13 Supabase 方案

正式系统优先采用 Supabase：

- Supabase Auth 负责登录。
- Supabase Postgres 存业务表。
- RLS 做行级权限兜底。
- Supabase Realtime 监听业务表变化，驱动多端自动刷新。
- Storage 存导出文件。
- Edge Functions 或自建后端处理复杂业务。
- SQL Migration 管理表结构演进。

适用场景：

- 团队希望少维护数据库和认证。
- 快速上线内部管理系统。
- 需要后台表管理和权限基础设施。
- 需要多设备实时同步员工、组织、周表、审批和报表状态。

注意：

- 复杂审批状态机仍建议由后端服务控制。
- 不应只依赖前端调用 Supabase 直接改业务状态。
- Realtime 只负责推送“数据变化”，不替代权限校验和状态机。
- 对 `organizations`、`employee_profiles`、`timesheets`、`overtime_entries`、`workflow_tasks`、`approval_logs` 等关键表开启 Realtime 发布。
- 涉及 DELETE 事件的表，应按需要设置 replica identity 或使用软删除字段。

## 8.14 迁移策略

从当前 Demo 迁移到正式系统时：

1. 固化数据模型。
2. 将 SQLite 表结构映射到 Supabase Postgres。
3. 编写 Supabase SQL migrations。
4. 接入 Supabase Auth。
5. 为核心表开启 RLS 策略。
6. 接入 Supabase Realtime，替代 Demo WebSocket。
7. 将复杂审批状态机迁入 Edge Functions 或 FastAPI 后端服务。
8. 把原生 JS 页面迁移到 Vue/React。
9. 增加审计日志、导出和薪酬核算。

迁移时应避免：

- 继续使用前端传入 `userId` 控制身份。
- 将工资计算规则写死在周表保存逻辑中。
- 允许锁定后的历史数据被直接覆盖。

## 9. 当前 Demo 与目标差距

当前已有：

- 登录
- 当前用户周表
- 项目工日比例填写
- 加班时长记录
- 周表提交/审批
- 员工组织页面雏形
- 项目工日统计

仍需完善：

- 员工新增/编辑/解聘完整交互。
- 员工行锁定原因与审计。
- 部门树编辑。
- OT 独立审批状态完整闭环。
- 审批状态机配置化。
- 项目汇总按审批状态筛选。
- 月度锁定和归档。
- 薪酬核算预览。
- 导出记录与审计。
- 正式权限模型和数据范围控制。

## 10. MVP 迭代优先级

### P0

- 当前用户绑定周表。
- 周表比例填写与提交校验。
- 管理员员工组织页。
- 员工新增/编辑/锁定。
- 待审批周表。
- OT 待审批。

### P1

- 状态机统一封装。
- 员工解聘流程。
- 部门绑定与部门树。
- 项目工日统计按状态筛选。
- 导出项目工日。

### P2

- 调休、请假、补卡审批。
- 月度锁定。
- 薪酬核算预览。
- 项目人工成本。
- 审计日志页面。
