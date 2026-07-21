# API And Runtime Lib

`src/lib` contains the browser-side compatibility layer that keeps the old `/api/*` call shape while routing work to Supabase-compatible services, RPCs, or controlled `serve_spa.py` endpoints.

## Key Files

| File | Responsibility |
| --- | --- |
| `api.ts` | Main API router, PostgREST helper, RPC calls, aggregation logic. |
| `supabase.ts` | Lazily loaded self-hosted Supabase Auth client and login alias resolution. |
| `authToken.ts` | Lightweight local access-token storage used by bootstrap and PostgREST calls. |
| `constants.ts` | App constants, role text, status text, holiday calendar, design/version constants. |
| `utils.ts` | UI utility helpers such as class merging. |

## Public API Wrapper

```ts
api<T>(path: string, options?: RequestInit): Promise<T>
```

All hooks call this function. It dispatches by URL path in `handleApi`.

## Supported `/api/*` Routes

| Route | Method | Body / Params | Returns | Notes |
| --- | --- | --- | --- | --- |
| `/api/logout` | POST | none | `{ ok }` | Clears local token only. |
| `/api/password/change` | POST | `{ login?, oldPassword, newPassword }` | `{ ok }` | Proxies to controlled server endpoint. |
| `/api/change-password` | POST | password payload | `{ ok }` | Legacy-compatible password change endpoint. |
| `/api/me` | GET | none | `{ user }` | Resolves JWT to employee and role. |
| `/api/bootstrap` | GET | none | Current user, permissions, current week | Identity-only compatibility bootstrap; project data loads per page. |
| `/api/timesheet` | GET | `weekStart` | `Timesheet` | Creates missing sheet lazily for the current week/month-split period. |
| `/api/timesheet-detail` | GET | `timesheetId` | approval detail payload | Used by desktop expanded rows and mobile inline detail. |
| `/api/timesheet/save` | POST | `SaveTimesheetPayload` | `{ ok, timesheet }` | Only draft/rejected/revision-required sheets are editable. |
| `/api/timesheet/action` | POST | `{ timesheetId, action, comment?, taskId? }` | RPC result | Calls `psa_timesheet_action`; submit creates serial project-block Approval Graph nodes directly. |
| `/api/approvals/tasks` | GET | `weekStart?` | `ApprovalTasks` | Returns pending/reviewed Approval Graph tasks and OT placeholder lists. |
| `/api/approval-templates` | GET | none | approval template list | Includes contract templates, nodes, and edges. |
| `/api/approval-templates/save` | POST | approval template payload | `{ ok, templates }` | Admin-only template metadata and node update. |
| `/api/overtime/action` | POST | `{ id, status, comment? }` | RPC result | OT is currently reserved in UI. |
| `/api/overtime/pending` | GET | `weekStart?` | OT pending list | Derived from approval tasks. |
| `/api/projects` | GET | `view=full|brief|dashboard` | project list | Full configuration by default; lightweight brief/dashboard views avoid historical labor scans. |
| `/api/projects/save` | POST | project payload | `{ ok, projects }` | Upserts project and refreshes pending routes. |
| `/api/project-department-owners/save` | POST | `{ projectId, departmentOwners }` | `{ ok, projects }` | Maintains project department owner rows. |
| `/api/projects/delete` | POST | `{ id }` | `{ ok, projects }` | Soft deletes by `status = deleted`. |
| `/api/numbering/project` | GET | `businessType?` | `{ code }` | Generates the next project code for a service type. |
| `/api/reports/weekly` | GET | `startDate`, `endDate` | weekly/monthly report | JS aggregation over approved/locked/summarized sheets. |
| `/api/reports/labor-matrix` | GET | `startDate`, `endDate` | matrix rows | Project/month labor matrix. |
| `/api/project-detail` | GET | `projectId`, `startDate`, `endDate` | employee labor rows | Project detail drawer. |
| `/api/employees` | GET | none | employee list | Uses `hr_employee_current_view` and `user_roles`; includes organization and cost specialty. |
| `/api/employees/save` | POST | employee payload | `{ ok, employees }` | Creates auth user for new employees. |
| `/api/employees/delete` | POST | `{ id }` | `{ ok, employees }` | Soft-deactivates employee and profile. |
| `/api/numbering/employee` | GET | none | `{ employeeNo }` | Generates the next employee number. |
| `/api/organizations` | GET | none | organization list | Includes parent links and manager names. |
| `/api/organizations/save` | POST | organization payload | saved organization | Upsert. |
| `/api/organizations/delete` | POST | `{ id }` | `{ ok, organizations }` | Soft delete. |
| `/api/permissions` | GET | none | role/resource/permission matrix | Loads platform RBAC config. |
| `/api/permissions/save` | POST | `{ roleKey, permissions[] }` | updated permission matrix | Admin-only role-resource access updates. |
| `/api/apps` | GET | none | application cards | Loads enabled app-center entries and admin metadata when allowed. |
| `/api/apps/save` | POST | app item payload | `{ ok, apps }` | Admin-only create/update for app-center cards. |
| `/api/apps/delete` | POST | `{ id }` | `{ ok, apps }` | Admin-only soft delete for app-center cards. |

## Route-Only Placeholders

| Route | Page | Current backend contract |
| --- | --- | --- |
| `/leave` | 请假申请 | No API. Future leave request endpoints should be added only after request fields, balance rules, and approval routing are confirmed. |

## Validation In API Layer

`saveTimesheet` validates regular workdays before writing:

- Single project/day cannot exceed `1.0`.
- Total regular workdays per day cannot exceed `1.0`.
- Month-split periods keep Monday-Sunday columns fixed, but only included dates are editable and validated.
- Full-attendance warning uses the number of weekdays included in the current split period; periods containing Sunday subtract one default rest day, periods without Sunday do not.
- Weekly regular workdays cannot exceed `7.0`.
- Locked approved project rows are preserved and included in the validation candidate set.

These checks mirror database trigger protection in migrations `036` and `037`, with month-boundary UX handled in the frontend compatibility layer.
