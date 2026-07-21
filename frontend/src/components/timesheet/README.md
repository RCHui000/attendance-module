# Timesheet Module

The timesheet module lets an employee fill weekly project workdays, save drafts, and submit a sheet for approval. Weeks that cross natural-month boundaries are split into separate sheets while preserving the fixed Monday-Sunday grid.

## Entry Points

| File | Role |
| --- | --- |
| `pages/TimesheetPage.tsx` | Page orchestration, data loading, save/submit actions. |
| `TimesheetTable.tsx` | Editable project/day grid, totals, intent recognition, and mobile status-dot presentation. |
| `WeekNavigator.tsx` | Week switching. |
| `SheetWarnings.tsx` | Validation warning/error display. |
| `SheetActions.tsx` | Save and submit buttons. |
| `stores/timesheetStore.ts` | Local draft rows, overtime placeholder state, dirty flag. |
| `utils/validation.ts` | Day/week totals and blocking validation. |

## API Calls

| Hook / Caller | Endpoint | Method | Purpose |
| --- | --- | --- | --- |
| `useTimesheet` | `/api/timesheet?weekStart=YYYY-MM-DD` | GET | Load or lazily create the current user's week/month-split sheet. |
| `useSaveTimesheet` | `/api/timesheet/save` | POST | Save draft entries and remark. |
| `useSubmitTimesheet` | `/api/timesheet/action` | POST | Submit the sheet into approval workflow. |
| `TimesheetPage` project dropdown | `/api/projects?view=brief` | GET | Load only project identity/type fields needed for row assignment. |

## Save Payload

```ts
interface SaveTimesheetPayload {
  weekStart: string;
  remark: string;
  entries: {
    projectId: number;
    workDate: string;
    hours: number;
    description: string;
  }[];
  overtime: {
    workDate: string;
    hours: number;
    reason: string;
  }[];
}
```

`hours` means workdays. A `25%` cell is saved as `0.25`.

## Business Rules

- One employee has one sheet per `weekStart` split period.
- A natural week crossing a month boundary is split by calendar month. The grid still shows Monday through Sunday, and out-of-period cells stay empty/read-only.
- Day total across all projects cannot exceed `1.0` workday.
- Full-attendance validation uses the actual number of weekdays in the split period. If the split period includes Sunday, one default rest day is subtracted; if it does not include Sunday, nothing is subtracted. Statutory holidays are subtracted separately.
- Week regular total cannot exceed `7.0` workdays.
- Sunday is a normal fillable workday when actually worked.
- OT fields are retained for future use but currently disabled in the UI.
- Submitted, approved, locked, and summarized sheets are read-only.
- Approved project rows are preserved if another project row is later revised.
- Project row totals display two decimals to avoid hiding small percent entries.
- The table keeps one default blank project row for entry. Intent recognition runs only after blur, Tab, or Enter, not on every keystroke.
- When a day is below `100%`, the table may append a blank project row; when that day reaches `100%`, no extra blank row is added. Auto-added blank rows must remain deletable.
- Mobile inputs use a non-zooming font size so project search and remark fields do not trigger browser auto-scale or drawer misalignment.
- Mobile project-block approval status is rendered as a compact colored dot; desktop keeps icon + label text.
- Submitting a sheet writes Approval Graph nodes directly. Each project block receives a generated serial approval chain; missing middle approver roles are skipped, and adjacent duplicate approvers collapse to the last role.
- If one project block is rejected after submission, only that project row is editable; other pending or approved rows stay locked.
