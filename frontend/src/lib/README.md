# API And Runtime Lib

`src/lib` contains the browser-side compatibility layer that makes the app look like it still calls `/api/*`, while routing most work to Supabase-compatible services.

## Key Files

| File | Responsibility |
| --- | --- |
| `api.ts` | Main API router, PostgREST helper, RPC calls, aggregation logic. |
| `supabase.ts` | Access-token storage helpers. |
| `constants.ts` | App constants, role text, status text, holiday calendar. |
| `utils.ts` | UI utility helpers such as class merging. |

## Public API Wrapper

```ts
api<T>(path: string, options?: RequestInit): Promise<T>
```

All hooks call this function. It dispatches by URL path in `handleApi`.

## Supported `/api/*` Routes

| Route | Method | Body / Params | Returns | Notes |
| --- | --- | --- | --- | --- |
| `/api/login` | POST | `{ login, password }` | `{ ok, token }` | Uses server login endpoint and stores token. |
| `/api/logout` | POST | none | `{ ok }` | Clears local token only. |
| `/api/password/change` | POST | `{ login?, oldPassword, newPassword }` | `{ ok }` | Proxies to controlled server endpoint. |
| `/api/me` | GET | none | `{ user }` | Resolves JWT to employee and role. |
| `/api/bootstrap` | GET | none | Current user, projects, current week | Compatibility bootstrap. |
| `/api/timesheet` | GET | `weekStart` | `Timesheet` | Creates missing weekly sheet lazily. |
| `/api/timesheet-detail` | GET | `timesheetId` | approval detail payload | Used by review drawer/expanded row. |
| `/api/timesheet/save` | POST | `SaveTimesheetPayload` | `{ ok, timesheet }` | Only draft/rejected/revision_required sheets are editable. |
| `/api/timesheet/action` | POST | `{ timesheetId, action, comment?, taskId? }` | RPC result | Calls `psa_timesheet_action`. |
| `/api/approvals/tasks` | GET | `weekStart?` | `ApprovalTasks` | Returns pending/reviewed timesheets and OT placeholder lists. |
| `/api/approval-templates` | GET | none | approval template list | Includes contract templates, nodes, and edges. |
| `/api/approval-templates/save` | POST | approval template payload | `{ ok, templates }` | Admin-only template metadata and node update. |
| `/api/overtime/action` | POST | `{ id, status, comment? }` | RPC result | OT is currently reserved in UI. |
| `/api/overtime/pending` | GET | `weekStart?` | OT pending list | Derived from approval tasks. |
| `/api/projects` | GET | none | project list | Includes service type, owners, roles, financial and labor fields. |
| `/api/projects/save` | POST | project payload | `{ ok, projects }` | Upserts project and refreshes pending routes. |
| `/api/project-department-owners/save` | POST | `{ projectId, departmentOwners }` | `{ ok, projects }` | Maintains project department owner rows. |
| `/api/projects/delete` | POST | `{ id }` | `{ ok, projects }` | Soft deletes by `status = deleted`. |
| `/api/reports/weekly` | GET | `startDate`, `endDate` | weekly/monthly report | JS aggregation over approved/locked/summarized sheets. |
| `/api/reports/labor-matrix` | GET | `startDate`, `endDate` | matrix rows | Project/month labor matrix. |
| `/api/project-detail` | GET | `projectId`, `startDate`, `endDate` | employee labor rows | Project detail drawer. |
| `/api/employees` | GET | none | employee list | Uses `hr_employee_current_view` and `user_roles`; includes organization and cost specialty. |
| `/api/employees/save` | POST | employee payload | `{ ok, employees }` | Creates auth user for new employees. |
| `/api/employees/delete` | POST | `{ id }` | `{ ok, employees }` | Soft-deactivates employee and profile. |
| `/api/organizations` | GET | none | organization list | Includes parent links and manager names. |
| `/api/organizations/save` | POST | organization payload | saved organization | Upsert. |
| `/api/organizations/delete` | POST | `{ id }` | `{ ok, organizations }` | Soft delete. |

## Route-Only Placeholders

These pages are routed in the SPA but intentionally do not call `/api/*` yet:

| Route | Page | Current backend contract |
| --- | --- | --- |
| `/leave` | 请假申请 | No API. Future leave request endpoints should be added only after request fields, balance rules, and approval routing are confirmed. |
| `/apps` | 应用中心 | No API. Future application catalog/config endpoints should be added when app-center scope is defined. |

## Validation In API Layer

`saveTimesheet` validates regular workdays before writing:

- Single project/day cannot exceed `1.0`.
- Total regular workdays per day cannot exceed `1.0`.
- Weekly regular workdays cannot exceed `7.0`.
- Locked approved project rows are preserved and included in the validation candidate set.

These checks mirror database trigger protection in migrations `036` and `037`.
