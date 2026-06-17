# Hooks Module

Hooks wrap `src/lib/api.ts` with TanStack Query. Components should prefer these hooks over calling `api()` directly unless a one-off page-level query is simpler.

## Hook Groups

| File | Main hooks | Endpoints |
| --- | --- | --- |
| `useTimesheet.ts` | `useTimesheet`, `useSaveTimesheet`, `useSubmitTimesheet` | `/api/timesheet`, `/api/timesheet/save`, `/api/timesheet/action` |
| `useApprovals.ts` | `useApprovalTasks`, `useTimesheetDetail`, `useTimesheetAction`, `useOvertimeAction` | `/api/approvals/tasks`, `/api/timesheet-detail`, `/api/timesheet/action`, `/api/overtime/action` |
| `useReport.ts` | `useWeeklyReport`, `useProjectBases`, `useProjectDetail`, `useLaborMatrix`, project mutations | `/api/reports/*`, `/api/projects*`, `/api/project-detail` |
| `useProjects.ts` | project/dashboard aggregations | `/api/projects`, `/api/reports/weekly`, `/api/reports/labor-matrix`, `/api/employees` |
| `useEmployees.ts` | employee and organization queries/mutations | `/api/employees*`, `/api/organizations*` |
| `useAppCenter.ts` | application center query/mutations | `/api/apps`, `/api/apps/save`, `/api/apps/delete` |
| `useMonthlyData.ts` | periodized report loader | `/api/reports/weekly` |
| `useRealtime.ts` | realtime invalidation | Realtime channels and BroadcastChannel fallback |

## Query Invalidation

Mutations should invalidate the smallest practical query groups:

- Timesheet changes: `timesheet`, `approvals`, `reports`, `dashboard`.
- Approval changes: `approvals`, `timesheet`, `reports`, `dashboard`.
- Project changes: `projects`, `reports`, `dashboard`, route-related approval queries.
- Employee/org changes: `employees`, `organizations`, `dashboard`.
- App-center changes: `apps`, `bootstrap` when sidebar visibility or resource permissions are affected.
