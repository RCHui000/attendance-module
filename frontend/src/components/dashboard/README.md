# Dashboard Module

The dashboard module shows KPI cards and BI perspectives over approved labor data.

## Entry Points

| File | Role |
| --- | --- |
| `pages/DashboardPage.tsx` | Page container and top-level period state. |
| `MetricCards.tsx` | Summary cards. |
| `DashboardTable.tsx` | Project/employee rollup table. |
| `BiPerspectiveTab.tsx` | Project, department, and employee BI perspectives. |
| `AnalyticsTab.tsx` | Chart-based analytics. |
| `PeriodFilter.tsx` | Period selector. |
| `OverviewBarChart.tsx` | Basic bar chart rendering. |
| `SimpleBarList.tsx` | Compact list chart. |
| `hooks/useProjects.ts` | Dashboard data aggregation. |
| `hooks/useMonthlyData.ts` | Multi-period report fetching. |

## API Calls

| Hook | Endpoint | Method | Purpose |
| --- | --- | --- | --- |
| `useProjects` | `/api/projects` | GET | Project master data, finance fields, configured owners. |
| `useProjects` | `/api/reports/weekly` | GET | Labor totals in selected range. |
| `useProjects` | `/api/employees` | GET | Employee salary/rate data for labor cost estimate. |
| `useMonthlyData` | `/api/reports/weekly` | GET | Periodized labor report used by charts. |

## Metrics

- Active project count.
- Total approved labor workdays.
- Estimated labor cost based on employee salary/daily wage.
- Project gross margin and labor cost ratio when financial fields exist.
- Department and employee contribution views.

Only reportable timesheet statuses are counted: `approved`, `locked`, `summarized`.
