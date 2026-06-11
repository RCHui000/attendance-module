# Report And Project Module

The report module is the project list, project editor, and project labor/finance reporting surface.

## Entry Points

| File | Role |
| --- | --- |
| `pages/ReportPage.tsx` | Page container. |
| `ProjectList.tsx` | Project table, edit controls, financial/labor columns. |
| `ProjectDrawer.tsx` | Per-project labor detail. |
| `LaborOverview.tsx` | Period summary. |
| `PeriodSelector.tsx` | Date range selection. |
| `hooks/useReport.ts` | Report and project mutations. |
| `hooks/useProjects.ts` | Dashboard/report project aggregation. |
| `types/project.ts` | Project contracts. |

## API Calls

| Hook / Caller | Endpoint | Method | Purpose |
| --- | --- | --- | --- |
| `useProjects` / `useProjectBases` | `/api/projects` | GET | Load active projects with service type, roles, finance, labor totals. |
| `useSaveProject` | `/api/projects/save` | POST | Create/update project and refresh pending approval routes. |
| `useDeleteProject` | `/api/projects/delete` | POST | Soft delete project. |
| project department owner save | `/api/project-department-owners/save` | POST | Save project participating department owner rows. |
| `useWeeklyReport` | `/api/reports/weekly` | GET | Aggregate labor by project/user/date range. |
| `useLaborMatrix` | `/api/reports/labor-matrix` | GET | Build project × period labor matrix. |
| `useProjectDetail` | `/api/project-detail` | GET | Employee-level labor detail for one project. |

## Project Fields

Key fields used by the UI:

- `code`: contract/project code, for example `PM26001`.
- `business_type`: `PM`, `CC`, or `PMCC`; inferred from code when empty and editable manually.
- `name`: project name.
- `contract_amount`, `received_amount`, `receivable_amount`: financial status.
- `total_labor_hours`: approved/locked/summarized regular workdays.
- `department_owners`: project participating departments and department owner records.
- `project_roles`: role-specific project owners such as PM/CC owner.

## Notes

- Deleted projects are marked with `status = deleted`; they are not hard-deleted.
- Labor totals only count reportable timesheet statuses.
- Saving a project can refresh pending approval routes so unresolved reviews follow the latest owner configuration.
