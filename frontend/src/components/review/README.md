# Review Module

The review module is the approval center for weekly timesheets. It shows pending approvals, reviewed history, and detailed project-block workday rows.

This module describes timesheet approval only. Timesheet project blocks now use generated Approval Graph serial chains based on submitter department, project service type, and project role configuration. Contract approval for PM, CC, and PMCC service types is driven by contract templates and the same project master data.

## Entry Points

| File | Role |
| --- | --- |
| `pages/ReviewPage.tsx` | Page container for approval center. |
| `ApprovalTable.tsx` | Pending/reviewed task lists and approve/reject actions. |
| `ApprovalFlowConfig.tsx` | Admin-only contract approval template editor with live graph preview. |
| `ExpandedReviewRow.tsx` | Inline expanded timesheet detail. |
| `ReviewDrawer.tsx` | Desktop drawer-style full timesheet detail for legacy/detail workflows. |
| `mobile/MobileTimesheetDetail.tsx` | Mobile inline vertical detail for approval task cards. |
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
- `scope_type`: currently `project` for timesheet project-block graph nodes. Historical migrated rows may still be displayed through compatibility views.
- `project_id`, `project_code`, `project_name`: present for project block approvals.
- `total_hours`: workdays for the task scope.
- `status`, `result_action`, `review_comment`: reviewed history fields.

## Approval Behavior

- Project-scope tasks approve or reject one project block step. Multiple project blocks can still run in parallel, but each project block can contain a serial chain.
- Serial timesheet chains are generated when the sheet is submitted: CC submitter + CC/PMCC project starts with the CC specialty project owner, then configured PMCC cross-department PM steps; PM submitter + PMCC project uses the PM-side route only.
- Missing middle roles are optional and omitted from the generated graph.
- Consecutive steps assigned to the same employee are collapsed to the last step.
- Project task totals display two decimals.
- Rejecting a timesheet project task only affects that project block. Other project blocks in the same sheet keep their current pending/approved state.
- The UI reads Approval Graph views only. Legacy `workflow_tasks` rows are migrated into graph nodes during V0.15 deployment and the legacy table is dropped after count checks pass.
- Admin users can open the approval-flow configuration tab to inspect PM / CC / PMCC contract templates and preview the current serial graph.
- Mobile approval cards expand details vertically in place instead of opening a side drawer/sheet, so long timesheet details can scroll with the page.
