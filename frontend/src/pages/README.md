# Pages Module

Pages are route-level containers. They should orchestrate hooks, stores, and feature components, while business-specific UI composition lives under `components/*`.

## Routes

| Page | Route | Main module | Purpose |
| --- | --- | --- | --- |
| `LoginPage.tsx` | unauthenticated default | `components/layout` | Login, password-change surface, animated background. |
| `TimesheetPage.tsx` | `/timesheet` | `components/timesheet` | Weekly/month-split workday entry, save, submit. |
| `LeavePage.tsx` | `/leave` | page placeholder | Leave request entry placeholder. No backend API yet. |
| `DashboardPage.tsx` | `/dashboard` | `components/dashboard` | KPI and BI dashboard. |
| `ReviewPage.tsx` | `/review` | `components/review` | Approval center. |
| `ReportPage.tsx` | `/report` | `components/report` | Project list, project popup editor on mobile, and reports. |
| `EmployeesPage.tsx` | `/employees` | `components/employees` | System management and permission configuration. |
| `AppsPage.tsx` | `/apps` | route page + app-center API | Application card catalog; admin can maintain app entries. |

## Page Responsibilities

- Own page-level loading/error/empty state.
- Bind hooks to feature components.
- Keep route-specific state near the page when it is not globally shared.
- Avoid direct PostgREST/fetch usage; call hooks or `api()` through `lib/api.ts`.
