# Review Module

The review module is the approval center for weekly timesheets. It shows pending approvals, reviewed history, and detailed project-block workday rows.

This module describes timesheet approval only. Contract approval for PM, CC, and PMCC service types is driven by project master data and Approval Graph templates; PMCC is a cross-department serial route, not the two-step timesheet project/department flow.

## Entry Points

| File | Role |
| --- | --- |
| `pages/ReviewPage.tsx` | Page container for approval center. |
| `ApprovalTable.tsx` | Pending/reviewed task lists and approve/reject actions. |
| `ApprovalFlowConfig.tsx` | Admin-only contract approval template editor with live graph preview. |
| `ExpandedReviewRow.tsx` | Inline expanded timesheet detail. |
| `ReviewDrawer.tsx` | Drawer-style full timesheet detail. |
| `hooks/useApprovals.ts` | Query and mutation wrapper. |
| `types/approval.ts` | Approval task and detail contracts. |

## API Calls

| Hook / Caller | Endpoint | Method | Purpose |
| --- | --- | --- | --- |
| `useApprovalTasks` | `/api/approvals/tasks?weekStart=...` | GET | Load pending, reviewed, OT placeholder lists. |
| `useTimesheetDetail` | `/api/timesheet-detail?timesheetId=...` | GET | Load sheet, entries, overtime rows, project statuses. |
| `useTimesheetAction` | `/api/timesheet/action` | POST | Submit approval action: approve, reject, reopen. |
| `useOvertimeAction` | `/api/overtime/action` | POST | Reserved OT approval action. |
| `useApprovalTemplates` | `/api/approval-templates` | GET | Load PM / CC / PMCC contract approval templates with nodes and edges. |
| `useSaveApprovalTemplate` | `/api/approval-templates/save` | POST | Admin-only update for template metadata and node configuration. |

## Approval Task Shape

Important fields used by the UI:

- `timesheet_id`: target sheet.
- `task_id` or graph node assignment id: action target.
- `scope_type`: `project` or `department_summary`.
- `project_id`, `project_code`, `project_name`: present for project block approvals.
- `total_hours`: workdays for the task scope.
- `status`, `result_action`, `review_comment`: reviewed history fields.

## Approval Behavior

- Project-scope tasks approve or reject one project block.
- Department summary tasks approve or reject the full sheet after all project blocks pass.
- Project task totals display two decimals; department summary totals keep compact one-decimal display.
- Rejecting a task sends the sheet back to editable state and cancels remaining pending work as implemented by RPC.
- The UI reads Approval Graph B compatibility views and legacy `workflow_tasks` together, so restored backups that contain either data surface still show pending/reviewed records.
- Admin users can open the approval-flow configuration tab to inspect PM / CC / PMCC contract templates and preview the current serial graph.
