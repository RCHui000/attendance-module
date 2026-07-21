# Dashboard Module

The dashboard module shows project operating metrics and a BI workbench over approved labor data.

## Entry Points

| File | Role |
| --- | --- |
| `pages/DashboardPage.tsx` | Page container and top-level period state. |
| `MetricCards.tsx` | Summary cards. |
| `DashboardTable.tsx` | Project/employee rollup table. |
| `DashboardAnalysisWorkbench.tsx` | Project investment analysis workbench with ranking, trend, donut structure, employee load, and source rows. |
| `DashboardMobile.tsx` | Mobile-first dashboard composition and compact BI summaries. |
| `PeriodFilter.tsx` | Period selector. |
| `hooks/useProjects.ts` | Dashboard data loading and BI analysis query hooks. |

## API Calls

| Hook | Endpoint | Method | Purpose |
| --- | --- | --- | --- |
| `useProjects` | `/api/projects?view=dashboard` | GET | Lightweight project finance fields without owner/role or historical-labor expansion. |
| `useProjects` | `/api/reports/weekly` | GET | Labor totals in selected range. |
| `useProjects` | `/api/reports/labor-matrix` | GET | Project x period labor matrix where needed by BI views. |
| `useDashboardAnalysis` | `/api/dashboard/analysis` | GET | Backend BI aggregation for project ranking, trend, load, and source rows. |
| `useProjects` | `/api/employees` | GET | Employee salary/rate data for labor cost estimate. |

## Metrics

- Active project count.
- Total approved labor workdays.
- Estimated labor cost based on employee salary/daily wage.
- Project gross margin and labor cost ratio when financial fields exist.
- Planned labor days and labor budget consumption when project budgets are configured.
- Department and employee contribution views.

Only reportable timesheet statuses are counted: `approved`, `locked`, `summarized`.

The chart-heavy analysis workbench is a nested lazy chunk. Dashboard overview and mobile first content render without waiting for the chart engine; the analysis chunk loads only when its boundary is rendered.

## Mobile UX

- Mobile dashboard views use a single-column information flow with compact selectors and cards.
- BI perspectives prioritize readable lists and summaries before dense charts.
- Desktop visual hierarchy stays closer to the multi-panel KPI and chart layout.
