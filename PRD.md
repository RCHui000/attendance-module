# 考勤统计模块 PRD

## 1. 目标

建设内部工时统计系统，统一管理员工周表、项目工日、组织架构、审批、加班和项目统计。当前版本要求运行态完整基于 Supabase 技术栈：

- 认证：Supabase GoTrue
- 数据：Supabase Postgres
- 数据访问：PostgREST
- 前端：React + Vite 静态应用
- 部署：Nginx 静态容器 + `supabase-psa` 服务栈

## 2. 核心角色

- 员工：填写本人周表、保存草稿、提交审批、填写加班。
- 主管：查看分配给自己的审批任务，审批或退回周表与加班，查看项目工日统计。
- 管理员：维护员工、组织、项目基础资料，并可查看全部审批任务和统计。

## 3. 周表规则

- 每名员工每周只能有一张周表。
- 每天所有项目工日比例合计不得超过 1 工日。
- 周表状态：`draft -> submitted -> approved/rejected`，管理员可重开至 `draft`。
- 已提交、已通过、已锁定状态下不可继续编辑周表明细。
- 加班记录独立审批，周表通过不代表加班自动通过。

## 4. 审批规则

- 周表提交后按周表项目路由审批人。
- Stage 1：项目负责人 `projects.project_owner_id`。
- Stage 2：员工所在部门负责人或直属负责人。
- 当项目负责人与部门负责人是同一人时，只生成一道审批任务。
- 审批通过后，任务必须从待审核移出并进入已审核记录。
- 历史异常任务应被整理为已完成或去重，保持审批中心整洁。

## 5. Supabase 数据表

核心表：

- `profiles`
- `employees`
- `employee_profiles_v2`
- `employee_contracts`
- `employee_salary_profiles`
- `user_roles`
- `organizations`
- `projects`
- `timesheets`
- `timesheet_entries`
- `overtime_entries`
- `workflow_tasks`
- `approval_logs`
- `audit_logs`

## 6. 前端接口策略

前端保留 `api("/api/...")` 调用形态作为内部兼容层，但该兼容层不访问自建业务服务，而是在浏览器内直接转换为 GoTrue/PostgREST 请求。

必需环境变量：

```text
VITE_SUPABASE_AUTH_URL=http://192.168.2.100:8777
VITE_SUPABASE_REST_URL=http://192.168.2.100:8779
VITE_SUPABASE_ANON_KEY=<anon key>
```

## 7. 部署

应用容器只负责托管 `frontend/dist` 静态文件：

```text
Browser -> Nginx static app -> GoTrue/PostgREST -> Supabase Postgres
```

数据库迁移按顺序执行：

1. `001_v0.11_schema.sql`
2. `002_v0.11_rls.sql`
3. `003_v0.11_policies_fk_fixes.sql`
4. `004_full_supabase_runtime.sql`

## 8. 已知边界

- 浏览器端不能安全持有 Supabase service role key。
- 新建 GoTrue 登录账号、强制重置其他用户密码等高权限动作，应后续通过 Supabase Edge Function、受控运维脚本或 Supabase 管理后台完成。
- `timesheets.user_id` 缺少到 `employees.id` 的外键约束（历史数据包含已删除的 timesheet 引用）。前端代码统一使用平铺查询 + JS 端关联，避免 PostgREST 嵌入式资源语法。
- Realtime 容器 `psa-realtime` 当前不可用（启动脚本 `RLIMIT_NOFILE` 问题），实时同步通过前端 `BroadcastChannel` 同源广播实现。

---

## 附A：API 兼容层 (前端 `api.ts`)

前端保留 `api("/api/xxx")` 调用形态，`handleApi()` 函数内部将路径分发为 GoTrue/PostgREST 请求。**没有 FastAPI 后端**。

| 前端调用 | 实际请求 | 说明 |
|---------|---------|------|
| `POST /api/login` | `POST GoTrue /token?grant_type=password` | `login_name` → `auth_email` 映射（中文→拼音） |
| `GET /api/bootstrap` | `currentUser()` + `projects()` | 并行 PostgREST 查询 |
| `GET /api/timesheet?weekStart=` | PostgREST `/timesheets` + `/timesheet_entries` + `/overtime_entries` | 平铺查询 + JS 关联 |
| `POST /api/timesheet/save` | PostgREST PATCH `/timesheets` + DELETE `/timesheet_entries` + POST entries | 先删后插 |
| `POST /api/timesheet/action` | PostgREST PATCH `/timesheets` + PATCH `/workflow_tasks` | 状态机 |
| `GET /api/approvals/tasks` | PostgREST 多表平铺查询 | 全量拉取，不按周过滤 |
| `GET /api/timesheet-detail` | PostgREST 4 路平铺查询 + JS 关联 | 绕过 FK 缺失 |
| `GET /api/employees` | PostgREST `/hr_employee_current_view` | |
| `GET /api/projects` | PostgREST 4 路并行查询 | projects + orgs + employees + entries |
| `GET /api/reports/weekly` | PostgREST entries + sheets + projects + employees | 平铺 + JS 聚合 |
| `GET /api/project-detail` | PostgREST 4 路平铺查询 | 绕过 FK 缺失 |
| `POST /api/employees/save` | PostgREST 串行写入 5 表 | employees + profiles_v2 + contracts + salary + roles |

### 环境变量

```bash
VITE_SUPABASE_AUTH_URL=http://192.168.2.100:8777
VITE_SUPABASE_REST_URL=http://192.168.2.100:8779
VITE_SUPABASE_ANON_KEY=<GoTrue anon JWT>
```

### 登录名映射 (硬编码)

| 输入 | GoTrue 邮箱 |
|------|-----------|
| admin | admin@psa.local |
| 鞠松松 | jss@psa.local |
| 惠若超 | huirouchao@psa.local |
| 王长志 | wangchangzhi@psa.local |
| 陈京京 | chenjingjing@psa.local |
| 赵嘉琪 | zhaojiaqi@psa.local |
| 储小海 | chuxiaohai@psa.local |
| 韩文治 | hanwenzhi@psa.local |
| 温利峰 | wenlifeng@psa.local |

---

## 附B：数据库与迁移

### 核心表 (public schema)

| 表 | 关键 FK | PostgREST 嵌入查询 |
|----|---------|-------------------|
| employees | `auth_user_id` UUID | ✅ 可用嵌入式 |
| employee_profiles_v2 | `employee_id → employees`, `org_id → organizations` | ✅ |
| employee_contracts | `employee_id → employees` | ✅ |
| employee_salary_profiles | `employee_id → employees` | ✅ |
| user_roles | `employee_id → employees` | ✅ |
| organizations | `manager_user_id → employees` | ✅ |
| projects | `project_owner_id → employees`, `owner_org_id → organizations` | ✅ |
| timesheets | `user_id → employees` **缺 FK** | ❌ 需平铺查询 |
| timesheet_entries | `timesheet_id → timesheets`, `project_id → projects` | ✅ |
| overtime_entries | `timesheet_id → timesheets` | ✅ |
| workflow_tasks | `target_id → timesheets` **缺 FK**, `assignee_user_id → employees` **缺 FK** | ❌ 需平铺查询 |

### 迁移文件顺序

1. `001_v0.11_schema.sql` — 全量表结构 + `hr_employee_current_view`
2. `002_v0.11_rls.sql` — RLS 策略
3. `003_v0.11_policies_fk_fixes.sql` — `auth_read_*` 已认证用户读策略
4. `004_full_supabase_runtime.sql` — CodeX 后续运行时迁移

### 数据完整性

- 所有 9 名员工、54 份周表、122 条明细、49 个审批任务均在 Postgres
- SQLite 文件 `data/attendance_demo.sqlite3` 保留作为历史归档
- 迁移验证脚本: `scripts/migrate_sqlite_to_supabase.py --validate`

---

## 附C：部署

### 服务拓扑

```
Browser (:8767) → Nginx/SPA (Docker: attendance-module)
                    ├── GoTrue (:8777) → psa-postgres (:5433)
                    ├── PostgREST (:8779) → psa-postgres
                    └── Realtime (:8778, paused)
```

### Dockerfile

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY frontend/dist /app
COPY serve_spa.py /serve_spa.py
EXPOSE 80
CMD ["python", "/serve_spa.py"]
```

### 部署命令

```bash
# 构建前端
cd frontend && npm run build

# 同步到 NAS
tar czf - dist/ | ssh inquiry-nas "cd .../frontend && tar xzf -"

# 重建
ssh inquiry-nas "cd .../attendance-module && docker compose up -d --build"
```

### 回滚

```bash
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=v0.10/' .env
docker compose up -d
```

---

## 附D：V0.11 已知 Bug

| ID | 描述 | 影响 | 状态 |
|----|------|------|------|
| BUG-01 | `psa-realtime` 启动失败 (`RLIMIT_NOFILE`) | 实时同步用 BroadcastChannel 代替 | 暂停 |
| BUG-02 | `timesheets→employees` FK 缺失 | PostgREST 嵌入式查询不可用，前端已改为平铺查询 | 已规避 |
| BUG-03 | `workflow_tasks→timesheets` FK 缺失（历史孤儿 task target_id=3） | 同上，前端平铺查询已规避 | 已规避 |
| BUG-04 | 分析页月度回款额恒为 0 | 无月度 received 数据源 | 待后端接口 |
| BUG-05 | 项目 `labor_cost` 按全局平均日薪率分摊 | 各项目成本精度取决于薪酬数据完整度 | 可接受 |
| BUG-06 | GoTrue 不支持中文邮箱 | 登录用硬编码拼音映射 | 已规避 |
| BUG-07 | admin 密码可能在 GoTrue 容器重建时丢失 | 需手动重置 | 运维注意 |

---

## 附E：Agent 协作指南

1. **前端改动**: 修改 `frontend/src/` 后必须 `npm run build`，然后 `tar + ssh` 部署 `dist/` 到 NAS
2. **数据库改动**: 所有 schema 变更必须进入 `supabase-psa/migrations/` 目录，按序号命名
3. **新增 PostgREST 查询**: 先检查是否有对应 FK（附表B）。无 FK 则用平铺查询 + JS 关联
4. **权限**: 使用 `current_user_has_role('admin')` / `current_user_can_review()` 函数判断角色
5. **不要改**: `serve_spa.py`、`docker-compose.yml` 的端口映射、`.env` 中的 `IMAGE_TAG`
