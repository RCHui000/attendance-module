# Pages Module

Pages are route-level containers. They should orchestrate hooks, stores, and feature components, while business-specific UI composition lives under `components/*`.

## Routes

| Page | Route | Main module | Purpose |
| --- | --- | --- | --- |
| `LoginPage.tsx` | unauthenticated default | `components/layout` | Login and password-change surface. |
| `TimesheetPage.tsx` | `/timesheet` | `components/timesheet` | Weekly workday entry, save, submit. |
| `LeavePage.tsx` | `/leave` | page placeholder | Leave request entry placeholder. No backend API yet. |
| `DashboardPage.tsx` | `/dashboard` | `components/dashboard` | KPI and BI dashboard. |
| `ReviewPage.tsx` | `/review` | `components/review` | Approval center. |
| `ReportPage.tsx` | `/report` | `components/report` | Project list and reports. |
| `EmployeesPage.tsx` | `/employees` | `components/employees` | Employee and organization admin. |
| `AppsPage.tsx` | `/apps` | page placeholder | Application center placeholder. No backend API yet. |

## Page Responsibilities

- Own page-level loading/error/empty state.
- Bind hooks to feature components.
- Keep route-specific state near the page when it is not globally shared.
- Avoid direct PostgREST/fetch usage; call hooks or `api()` through `lib/api.ts`.
