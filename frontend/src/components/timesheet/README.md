# Timesheet Module

The timesheet module lets an employee fill weekly project workdays, save drafts, and submit a sheet for approval.

## Entry Points

| File | Role |
| --- | --- |
| `pages/TimesheetPage.tsx` | Page orchestration, data loading, save/submit actions. |
| `TimesheetTable.tsx` | Editable project/day grid and totals. |
| `WeekNavigator.tsx` | Week switching. |
| `SheetWarnings.tsx` | Validation warning/error display. |
| `SheetActions.tsx` | Save and submit buttons. |
| `stores/timesheetStore.ts` | Local draft rows, overtime placeholder state, dirty flag. |
| `utils/validation.ts` | Day/week totals and blocking validation. |

## API Calls

| Hook / Caller | Endpoint | Method | Purpose |
| --- | --- | --- | --- |
| `useTimesheet` | `/api/timesheet?weekStart=YYYY-MM-DD` | GET | Load or lazily create the current user's weekly sheet. |
| `useSaveTimesheet` | `/api/timesheet/save` | POST | Save draft entries and remark. |
| `useSubmitTimesheet` | `/api/timesheet/action` | POST | Submit the sheet into approval workflow. |
| `TimesheetPage` project dropdown | `/api/projects` | GET | Load active projects for row assignment. |

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

- One employee has one sheet per `weekStart`.
- Day total across all projects cannot exceed `1.0` workday.
- `6.0` regular workdays is considered full attendance for the week.
- Week regular total cannot exceed `7.0` workdays.
- Sunday is a normal fillable workday when actually worked.
- OT fields are retained for future use but currently disabled in the UI.
- Submitted, approved, locked, and summarized sheets are read-only.
- Approved project rows are preserved if another project row is later revised.
- Project row totals display two decimals to avoid hiding small percent entries.
- Submitting a sheet writes Approval Graph nodes directly. Each project block receives a generated serial approval chain; missing middle approver roles are skipped, and adjacent duplicate approvers collapse to the last role.
