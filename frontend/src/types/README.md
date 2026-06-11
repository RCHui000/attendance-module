# Types Module

Shared TypeScript contracts for app features.

| File | Purpose |
| --- | --- |
| `auth.ts` | Current user and project brief types. |
| `timesheet.ts` | Timesheet, entry, overtime placeholder, row state, save payload. |
| `approval.ts` | Approval task lists, reviewed rows, detail payloads. |
| `employee.ts` | Employee, organization, salary/contract-related fields. |
| `project.ts` | Project list, owner mappings, financial/labor fields. |

These types describe frontend contracts. Database row shapes in `lib/api.ts` remain deliberately open through `AnyRow` because PostgREST embedded joins and compatibility fallbacks return mixed row structures.
