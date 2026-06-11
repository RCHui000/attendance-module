# Review Module

The review module is the approval center for weekly timesheets. It shows pending approvals, reviewed history, and detailed project-block workday rows.

This module describes timesheet approval only. Contract approval for PM, CC, and PMCC service types is driven by project master data and Approval Graph templates; PMCC is a cross-department serial route, not the two-step timesheet project/department flow.

## Entry Points

| File | Role |
| --- | --- |
| `pages/ReviewPage.tsx` | Page container for approval center. |
| `ApprovalTable.tsx` | Pending/reviewed task lists and approve/reject actions. |
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
- The UI reads compatibility views over Approval Graph B and legacy `workflow_tasks`.
