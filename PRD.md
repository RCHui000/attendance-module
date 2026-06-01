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
- **V0.10 审批流**：提交周表 → 按周表中的项目分别路由：
  - Stage 1: `projects.project_owner_id`（项目负责人，可为任意员工）
  - Stage 2: 员工所在部门的 `organizations.manager_user_id`（部门负责人）
  - 若项目负责人与部门负责人为同一人，自动合并为 1 道审批，不重复。
- 审核人解析优先级：`project_owner_id` → `organizations.manager_user_id` → 管理员兜底。
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

## 5.5 项目汇总

导航命名为：`项目汇总`。

页面目的：

> 双标签页面——工时统计标签用于查看本周项目工日投入，项目基础标签用于维护项目编号、名称、合同额和回款数据。

可见角色：

- 主管
- 管理员
- 后续财务/成本岗

### 工时统计标签

关键指标：

- 已填报员工
- 本周项目工日
- 有投入项目

表格字段：

- 项目编号
- 项目名称
- 投入人数
- 汇总工日
- 工日占比

后续扩展：

- 按部门/员工筛选。
- 按周表状态筛选。
- 只统计已通过/已锁定数据。

### 项目基础标签

维护项目基础信息（编号、名称、合同额、已回款）。支持行内编辑和新增项目。

表格字段：

- 项目编号
- 项目名称
- 合同额
- 已回款
- 待回款（系统计算）
- 操作（编辑/保存/取消）

说明：

- 项目基础不是项目管理后台，不负责项目进度和资料维护。
- 合同额和回款数据用于后续数据看板的毛利计算。

## 5.6 数据看板

导航命名为：`数据看板`。

页面目的：

> 按项目维度汇总经营与人力投入——合同额、回款、人力成本和毛利，为主管和管理员提供经营视角。

可见角色：

- 主管
- 管理员
- 后续财务/成本岗

页面元素：

- 顶部指标卡：合同额、已回款、待回款、人力成本（均为所有项目汇总）
- 项目明细表

表格字段：

- 项目编号
- 项目名称
- 合同额
- 已回款
- 待回款
- 本周工日
- 人力成本（按员工薪酬基础折算）
- 毛利（合同额 - 人力成本）
- KPI（毛利率百分比）

计算规则（Demo 阶段实时聚合）：

```text
人力成本 = SUM(员工日薪 × 项目工日)
月薪员工日薪 = monthly_salary / 26
日薪员工日薪 = daily_wage

毛利 = 合同额 - 人力成本
毛利率 = 毛利 / 合同额 × 100%
```

说明：

- Demo 阶段实时查询周表 + 薪酬基础计算；正式系统应落表（`project_labor_costs`）保存周期快照。
- 数据看板不是完整 BI，仅提供关键经营指标一目了然。

## 5.7 审批详情抽屉

审批中心周表行支持点击展开详情抽屉。

抽屉内容：

- 员工 · 部门 + 周期 + 周表状态
- 7 天每日各项目工日明细表
- 每日合计 + 周总工日
- 加班时数行
- 周备注（如有）

交互：

- 点击行任意位置（除按钮外）展开抽屉
- 已审核模式下提供"查看"按钮
- 抽屉内提供关闭按钮
- 点击其他行切换查看内容

## 6. 数据模型建议

目标数据分层：

```text
基础数据层
├── employees
├── departments
├── projects
└── contracts

工时成本层
├── timesheets
├── timesheet_entries
└── project_labor_costs

流程层
├── workflow_templates
├── workflow_steps
├── workflow_tasks
└── approval_logs

汇总层 / 商务看板
└── project_dashboard
    ├── 合同额 / 已回款 / 待回款
    ├── 项目工日投入
    ├── 人力成本开支
    └── 毛利 / KPI
```

当前 Demo 保留 `users + employee_profiles + organizations` 兼容实现；正式系统应逐步拆为 `employees`、`departments` 和独立账号体系。

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

## 6.7 workflow_templates

工作流模板，定义审批流程类型与步骤编排。

字段：

- workflow_key（唯一标识，如 `timesheet`、`overtime`）
- name（模板名称）
- target_type（关联业务实体类型）
- status（`active` / `inactive`）

Demo 已录入模板：

```text
timesheet → 周表审批
overtime  → 加班 OT 审批
```

## 6.8 workflow_steps

工作流步骤，每个模板下可定义多步审批。

字段：

- template_id → workflow_templates.id
- step_order（步骤序号）
- step_key（步骤标识，如 `manager_review`）
- assignee_role（默认审核人角色）
- assignee_strategy（审核人解析策略，如 `direct_manager`）
- action_policy（操作策略，如 `approve_reject`）

Demo 当前仅配置单步 `manager_review`，后续可扩展多级审批。

## 6.9 workflow_tasks / approval_tasks

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

## 6.10 approval_logs

审批日志。

字段：

- target_type
- target_id
- from_status
- to_status
- actor_id
- action
- comment
- created_at

## 6.11 projects / contracts / project_labor_costs

项目基础数据字段：

- code
- name
- contract_amount
- received_amount
- receivable_amount
- owner_org_id
- status

合同表字段：

- project_id
- contract_no
- contract_name
- contract_amount
- received_amount
- status
- signed_at

项目人力成本快照字段：

- project_id
- week_start_date
- labor_days
- labor_cost
- calculated_at

说明：

- 项目基础数据用于维护项目编号、项目名称、合同额和回款状态。
- `project_labor_costs` 可由周表和员工薪酬基础定期计算生成，作为后续商务看板和薪酬核算的稳定快照。
- Demo 阶段允许实时聚合计算；正式系统建议落表保存周期快照。

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

## 8.2 当前 V0.11 架构 (2026-06-01)

### 8.2.1 整体拓扑

```
Browser (192.168.2.100:8767)
  │
  │ React SPA (frontend/dist/ → /)
  │ /api/* → HTTP Bearer JWT
  │ /ws/sync → FastAPI WebSocket
  v
┌──────────────────────────────────────────────────┐
│  Docker: attendance-module (python:3.12-slim)    │
│  ├─ FastAPI + Uvicorn :8767                     │
│  ├─ app.py (legacy, SQLite read/write)          │
│  ├─ db.py  (Postgres pool + PyJWT)              │
│  └─ fastapi_app.py (routes, auth middleware)    │
└──────────────────────────────────────────────────┘
  │                    │                    │
  │ SQLite (legacy)    │ Postgres           │ GoTrue
  │ ./data/attendance  │ 192.168.2.100:5433 │ 192.168.2.100:8777
  │ _demo.sqlite3      │                    │
  v                    v                    v
┌──────────────────────────────────────────────────┐
│  Docker: supabase-psa stack                     │
│  ├─ psa-postgres (PostgreSQL 16) :5433          │
│  ├─ psa-gotrue (Supabase Auth) :8777            │
│  ├─ psa-postgrest (REST) :8779                  │
│  └─ psa-realtime (WebSocket) :8778 (paused)     │
└──────────────────────────────────────────────────┘
```

### 8.2.2 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + shadcn/ui (18 组件) + Recharts |
| 状态 | Zustand (客户端) + TanStack Query (服务端缓存) |
| 路由 | React Router 6, SPA, 6 页面 |
| 后端 | FastAPI (Uvicorn) + 旧版 app.py (Python 标准库 HTTP handler) |
| 认证 | Supabase GoTrue JWT (HS256) → `/api/*` Bearer token; Cookie 兼容回退 |
| 数据库 | SQLite (旧版事务读写) + PostgreSQL 16 (新 schema,部分路由接入) |
| 实时 | FastAPI WebSocket `/ws/sync` (模块广播 + 客户端去重) |
| 图表 | Recharts (BarChart, AreaChart) |
| 部署 | Docker Compose × 2 (attendance-module + supabase-psa), NAS 192.168.2.100 |
| 版本 | Git Tags + GitHub Releases + `.env` IMAGE_TAG 回滚 |

### 8.2.3 前端组件树

```text
frontend/src/
├── App.tsx                    # 认证守卫 + 路由
├── main.tsx                   # QueryClient + Router + Toaster
├── index.css                  # Tailwind v4 + shadcn theme
├── lib/
│   ├── api.ts                 # fetch 封装, X-Client-Id + Bearer token
│   ├── supabase.ts            # token 存储 (localStorage)
│   ├── constants.ts           # holidayInfo, statusText, roleText, dayNames
│   └── utils.ts               # cn() helper
├── types/                     # TypeScript 接口
│   ├── auth.ts                # CurrentUser, BootstrapData, ProjectBrief
│   ├── timesheet.ts           # Timesheet, TimesheetRow, SavePayload
│   ├── approval.ts            # ApprovalTasks, TimesheetDetail
│   ├── project.ts             # DashboardData, ProjectBase, ReportData
│   └── employee.ts            # Employee, Organization
├── stores/
│   ├── authStore.ts           # Zustand: user, login, logout, isAdmin, canReview
│   ├── timesheetStore.ts      # Zustand: rows[], overtime{}, isDirty
│   └── appStore.ts            # Zustand: activeView, report/employee/review tab state, currentWeek
├── hooks/
│   ├── useTimesheet.ts        # TanStack: timesheet CRUD
│   ├── useApprovals.ts        # TanStack: approval tasks + review actions
│   ├── useReport.ts           # TanStack: report + project CRUD
│   ├── useEmployees.ts        # TanStack: employee/org CRUD
│   ├── useProjects.ts         # TanStack: dashboard (merged projects + reports)
│   ├── useMonthlyData.ts      # TanStack: 6-month parallel reports queries
│   └── useRealtime.ts         # WebSocket /ws/sync → query invalidation
├── utils/
│   ├── dates.ts               # isoDate, mondayOfWeek, computePeriodDates, formatMoney
│   └── validation.ts          # dayPercent, hasBlockingError, buildWarnings
├── components/
│   ├── ui/                    # 18 shadcn 组件 (Button, Card, Table, Select, etc.)
│   ├── layout/                # AppLayout, Sidebar, Topbar, Brand, LoginScreen
│   ├── dashboard/             # MetricCards, DashboardTable, PeriodFilter, OverviewBarChart, AnalyticsTab, SimpleBarList
│   ├── review/                # ApprovalTable, ExpandedReviewRow, ReviewDrawer (unused)
│   ├── report/                # ProjectList, PeriodSelector, LaborOverview (unused)
│   ├── timesheet/             # TimesheetTable, WeekNavigator, SheetWarnings, SheetActions
│   └── employees/             # EmployeeTable, EmployeeEditRow, OrganizationPanel, ReminderFloat
└── pages/
    ├── LoginPage.tsx
    ├── DashboardPage.tsx       # 2 tabs: 总览(指标卡+汇总+项目表) / 分析(月度面积图)
    ├── ReviewPage.tsx          # 审批中心
    ├── ReportPage.tsx          # 项目列表 (CRUD)
    ├── EmployeesPage.tsx       # 员工与组织
    └── TimesheetPage.tsx       # 我的周表
```

### 8.2.4 认证流程 (V0.11)

```
1. POST /api/login {login, password}
   │
   ├─ FastAPI: login_name → profiles.auth_email (e.g. "惠若超" → "huirouchao@psa.local")
   ├─ FastAPI: POST GoTrue /token?grant_type=password {email, password}
   ├─ GoTrue: 验证 → 返回 access_token (JWT)
   └─ FastAPI: 返回 {ok:true, token} + Set-Cookie attendance_sid=JWT

2. 后续请求
   │
   ├─ Authorization: Bearer <JWT> (前端 lib/api.ts 自动注入)
   ├─ fastapi_app.py request_user():
   │   ├─ 1) JWT Bearer header → decode → employees.auth_user_id lookup
   │   ├─ 2) Cookie attendance_sid 是 JWT → decode → lookup
   │   └─ 3) Cookie session → SQLite auth_sessions lookup (V0.10 兼容)
   └─ 返回 user dict {id, name, role, auth_user_id}

3. 角色: employee → /timesheet | manager/admin → /dashboard
```

## 8.3 V0.11 已知问题

| ID | 描述 | 影响 | 状态 |
|----|------|------|------|
| BUG-01 | psa-realtime 容器启动失败 (run.sh RLIMIT_NOFILE bug) | WebSocket 实时同步仍用 V0.10 /ws/sync | 已暂停 |
| BUG-02 | psa-postgrest 需 SECRET_KEY_BASE env | 不影响业务 (未使用 PostgREST) | 低优先级 |
| BUG-03 | 分析页月度回款额不可用 (无月度 received 数据源) | 图表仅显示人力开支，回款额恒 0 | 待后端接口 |
| BUG-04 | 项目 labor_cost 按工时比例分摊(全局平均日薪率) | 各项目成本精度取决于员工薪酬数据完整度 | 可接受 |
| BUG-05 | 旧版 /api/* 路由通过 legacy(app.py) 读写 SQLite | Postgres 与 SQLite 并存，未完成全部路由切换 | 迁移中 |
| BUG-06 | 中文名 GoTrue signup 不支持 (已改用拼音邮箱) | 新增员工需手动映射 login_name → pinyin | 已规避 |
| BUG-07 | goTrue 需 postgres 角色存在于 DB | 已创建 postgres role 使用强密码 | 已修复 |

## 8.4 正式系统推荐架构

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

关键接口（当前 Demo 实际路由）：

```text
# 认证
POST /api/login
POST /api/logout
POST /api/password/change
GET  /api/me
GET  /api/bootstrap

# 周表（当前用户）
GET  /api/timesheet?weekStart=
POST /api/timesheet/save
POST /api/timesheet/submit

# 周表详情（审批人查看他人周表）
GET  /api/timesheet/{timesheet_id}
GET  /api/timesheet-detail?timesheetId=

# 审批
GET  /api/approvals/tasks?weekStart=
POST /api/timesheet/action
POST /api/overtime/action

# 加班
GET  /api/overtime/pending?weekStart=

# 员工与组织
GET  /api/employees
POST /api/employees/save
POST /api/employees/delete
GET  /api/organizations
POST /api/organizations/save
POST /api/organizations/delete

# 项目汇总
GET  /api/reports/weekly?weekStart=

# 项目基础数据
GET  /api/projects
POST /api/projects/save

# 数据看板
GET  /api/project-dashboard?weekStart=

# 实时同步
WS  /ws/sync
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

- 登录（账号密码 + Cookie Session，前端已移除默认账号暴露）
- 登录失败内联错误提示
- 当前用户周表（项目工日比例填写、加班时长、草稿/提交）
- 右上角用户信息（部门 · 姓名 · 职位）
- 审批中心（待审核/已审核周表与 OT，审核人路由到具体 `assignee_user_id`）
- 审批详情抽屉（点击周表行展开完整 7 天工日明细 + 加班 + 备注）
- 员工与组织管理（员工列表、部门列表、新增/编辑/删除）
- 部门列表单行显示（部门名称 + 负责人 | 人数 / 编辑 / 删除）
- 部门编辑下拉抽屉
- 提醒事项浮动卡片（topbar 右上角弹出）
- 项目汇总（工时统计标签 + 项目基础标签，行内编辑合同额/回款）
- 数据看板（合同额、回款、待回款、人力成本、毛利、KPI）
- 项目表扩展（contract_amount、received_amount）
- contracts 表 + project_labor_costs 表（落表结构就绪，Demo 阶段实时计算）
- workflow_templates + workflow_steps（工作流引擎基础就绪，当前单步审批）
- WebSocket 实时同步（多客户端变更通知）
- Docker 部署（NAS 192.168.2.100:8767）

仍需完善：

- 员工解聘完整交互与审计。
- 员工行锁定原因与审计日志。
- OT 独立审批状态完整闭环（已通过/已退回后 settle）。
- 审批状态机配置化（当前 hardcode workflow_key 匹配）。
- 月度锁定和归档。
- 薪酬核算预览。
- 导出记录与审计。
- project_labor_costs 定期快照计算（当前实时聚合）。
- 正式权限模型和数据范围控制（当前 admin/manager 简化判断）。

## 10. MVP 迭代优先级

### P0（已完成）

- 当前用户绑定周表。
- 周表比例填写与提交校验。
- 管理员员工组织页。
- 员工新增/编辑。
- 待审批周表 + OT 审批。
- 审批详情抽屉。
- 部门列表管理。
- 数据看板（合同额/回款/人力成本/毛利/KPI）。

### P1（进行中）

- 员工解聘流程。
- 员工行锁定原因与审计。
- OT 独立审批状态完整闭环。
- 项目汇总按审批状态筛选。
- 导出项目工日。
- project_labor_costs 定期快照落表。

### P2

- 状态机配置化（workflow_templates/steps 驱动多级审批）。
- 调休、请假、补卡审批。
- 月度锁定。
- 薪酬核算预览。
- 项目人工成本自动核算。
- 审计日志页面。
- 正式权限模型和数据范围控制。
- 审计日志页面。

---

## 附A：完整 API 接口文档

### A.1 认证

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| POST | `/api/login` | `{login, password}` | `{ok:true, token:"<JWT>"}` + Set-Cookie `attendance_sid=<JWT>` |
| POST | `/api/logout` | `{}` | `{ok:true}` |
| POST | `/api/password/change` | `{login, oldPassword, newPassword}` | `{ok:true}` |
| GET | `/api/me` | - | `{user:{id,name,role}}` |
| GET | `/api/bootstrap` | - | `{currentUser, users[], projects[], currentWeek}` |

### A.2 周表

| 方法 | 路径 | 参数 | 响应关键字段 |
|------|------|------|-------------|
| GET | `/api/timesheet` | `?weekStart=YYYY-MM-DD` | `{id, user_id, week_start_date, status, remark, days[], entries[{project_id, work_date, hours, description}], overtime[{work_date, overtime_hours, reason, status}]}` |
| POST | `/api/timesheet/save` | `{weekStart, remark, entries[{projectId, workDate, hours, description}], overtime[{workDate, hours, reason}]}` | `{ok:true, timesheet:{...}}` |
| POST | `/api/timesheet/action` | `{timesheetId, action, comment?}` | action: submit/approve/reject/reopen |
| GET | `/api/timesheet-detail` | `?timesheetId=N` | `{id, user_name, department, week_start_date, status, remark, days[], entries[], overtime[]}` |

状态: `draft -> submitted -> approved/rejected -> draft(reopen)`

### A.3 审批

| 方法 | 路径 | 参数 | 响应 |
|------|------|------|------|
| GET | `/api/approvals/tasks` | `?weekStart=YYYY-MM-DD` | `{timesheets[{timesheet_id, name, department, status, total_hours, submitted_at}], reviewed[{...}], overtime[{id, user_name, work_date, overtime_hours, reason, status}], overtimeReviewed[...]}` |
| POST | `/api/overtime/action` | `{id, status, comment}` | `{ok:true}` |

审批链: submit -> Stage1: projects.project_owner_id -> Stage2: org.manager_user_id (同人跳过)

### A.4 员工与组织

| 方法 | 路径 | 请求 | 响应 |
|------|------|------|------|
| GET | `/api/employees` | - | `[{id, name, role, employee_no, org_id, org_name, position_name, contract_type, monthly_salary, daily_wage, hire_date, manager_user_id, status}]` |
| POST | `/api/employees/save` | `{id?, employeeNo, name, role, orgId, positionName, contractType, monthlySalary, dailyWage, hireDate, contractMonths, managerUserId, status}` | `{ok:true, employees:[...]}` |
| POST | `/api/employees/delete` | `{id}` | `{ok:true, employees:[...]}` |
| GET | `/api/organizations` | - | `[{id, org_code, org_name, parent_id, org_type, manager_user_id, status}]` |
| POST | `/api/organizations/save` | `{id?, orgName, orgType, parentId, managerUserId}` | `{ok:true}` |
| POST | `/api/organizations/delete` | `{id}` | `{ok:true}` |

### A.5 项目与报表

| 方法 | 路径 | 参数 | 响应关键字段 |
|------|------|------|-------------|
| GET | `/api/projects` | - | `[{id, code, name, contract_amount, received_amount, receivable_amount, project_owner_id, project_owner_name, total_labor_hours, total_labor_cost, status}]` |
| POST | `/api/projects/save` | `{id?, code, name, contractAmount, receivedAmount, projectOwnerId, ownerOrgId}` | `{ok:true}` |
| POST | `/api/projects/delete` | `{id}` | `{ok:true}` |
| GET | `/api/reports/weekly` | `?startDate=&endDate=` | `{projects:[{code, name, total_hours, people_count}], employees:[{name, total_hours}], startDate, endDate}` |
| GET | `/api/project-dashboard` | `?weekStart=` | `{projects:[{id, code, name, contract_amount, received_amount, labor_days, labor_cost, gross_profit, gross_margin}]}` |
| GET | `/api/project-detail` | `?projectId=&startDate=&endDate=` | `[{name, department, total_hours, work_days}]` |

### A.6 权限矩阵

| 角色 | login | timesheet | approvals | employees | projects | reports |
|------|-------|-----------|-----------|-----------|----------|---------|
| 未登录 | YES | NO | NO | NO | NO | NO |
| employee | YES | 仅本人 | NO | NO | 只读 | NO |
| manager | YES | 仅本人 | 分配任务 | NO | 读写 | YES |
| admin | YES | 全部 | 全部 | 全部 | 读写 | YES |

---

## 附B：数据库 Schema

### B.1 SQLite (app.py 使用, path: data/attendance_demo.sqlite3)

| 表 | 主要字段 |
|----|---------|
| users | id, name, role, department, is_active |
| organizations | id, org_code, org_name, parent_id, org_type, manager_user_id |
| employee_profiles | user_id, employee_no, org_id, position_name, contract_type, monthly_salary, daily_wage, hire_date, manager_user_id, status |
| projects | id, code, name, contract_amount, received_amount, owner_org_id, project_owner_id, status |
| timesheets | id, user_id, week_start_date, status, remark, submitted_at, approved_by |
| timesheet_entries | id, timesheet_id, project_id, work_date, hours, description |
| overtime_entries | id, timesheet_id, work_date, overtime_hours, reason, status |
| workflow_tasks | id, workflow_key, target_type, target_id, status, assignee_role, assignee_user_id |
| approval_logs | id, target_type, target_id, actor_id, action, comment, from_status, to_status |
| auth_accounts | user_id, login, password_hash |
| auth_sessions | token, user_id, expires_at |

### B.2 PostgreSQL (db.py 使用, host: 192.168.2.100:5433/psa)

| 表 | 主要字段 |
|----|---------|
| profiles | id, auth_user_id(UUID), login_name, auth_email, display_name, is_active |
| employees | id, employee_no, auth_user_id, name, is_active |
| employee_profiles_v2 | employee_id, org_id, position_name, employment_status, manager_user_id, hire_date, row_locked |
| employee_contracts | employee_id, contract_type, employment_type, contract_start, contract_end, is_current |
| employee_salary_profiles | employee_id, salary_mode, monthly_salary, daily_wage, standard_monthly_workdays, is_current |
| user_roles | employee_id, role |
| audit_logs | actor_id, entity_type, entity_id, action, before_json, after_json, reason |
| migration_id_map | table_name, old_id, new_id, new_uuid |
| hr_employee_current_view | JOIN employees+profiles+v2+orgs+contracts+salary |

GoTrue auth schema: auth.users, auth.sessions, auth.refresh_tokens, auth.identities (16 tables)

### B.3 登录映射

| login_name | auth_email | 密码 |
|------------|-----------|------|
| admin | admin@psa.local | (随机) |
| 鞠松松 | jss@psa.local | 123456 |
| 惠若超 | huirouchao@psa.local | 123456 |
| 王长志 | wangchangzhi@psa.local | 123456 |
| 陈京京 | chenjingjing@psa.local | 123456 |
| 赵嘉琪 | zhaojiaqi@psa.local | 123456 |
| 储小海 | chuxiaohai@psa.local | 123456 |
| 韩文治 | hanwenzhi@psa.local | 123456 |
| 温利峰 | wenlifeng@psa.local | 123456 |

---

## 附C：部署与运维

### C.1 端口

| 端口 | 服务 | 容器 |
|------|------|------|
| 8767 | Web + API | attendance-module |
| 5433 | PostgreSQL | psa-postgres |
| 8777 | GoTrue Auth | psa-gotrue |
| 8778 | Realtime (暂停) | psa-realtime |
| 8779 | PostgREST | psa-postgrest |

### C.2 部署命令

```bash
# 本地构建前端
cd frontend && npm run build

# 同步到 NAS
tar czf - dist/ | ssh inquiry-nas "cd .../frontend && tar xzf -"
scp app.py fastapi_app.py db.py Dockerfile inquiry-nas:.../

# 重建容器
ssh inquiry-nas "cd .../attendance-module && docker compose up -d --build"
```

### C.3 回滚

```bash
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=v0.10/' .env
docker compose up -d
```

### C.4 备份

```bash
# SQLite
cp data/attendance_demo.sqlite3 backups/

# Postgres
docker exec psa-postgres pg_dump -U psa_admin psa > backups/psa_$(date +%Y%m%d).sql
```

### C.5 V0.11 已知问题

| ID | 描述 | 状态 |
|----|------|------|
| BUG-01 | psa-realtime 启动失败 (run.sh RLIMIT_NOFILE) | 暂停 |
| BUG-02 | 分析页月度回款额不可用 | 待后端接口 |
| BUG-03 | 旧路由仍读写 SQLite, PG 迁移未完成 | 进行中 |
| BUG-04 | 项目 labor_cost 按全局平均日薪率分摊 | 可接受 |
| BUG-05 | 中文名 GoTrue signup 不支持 (已用拼音) | 已规避 |