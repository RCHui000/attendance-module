# Stores Module

Zustand stores hold local UI/session state that should not live in React Query.

## Stores

| File | State | Notes |
| --- | --- | --- |
| `authStore.ts` | Current user, auth loading state, resource permissions, login/logout/session check actions. | Uses `/api/login`, `/api/logout`, `/api/bootstrap`. |
| `appStore.ts` | Current week and UI-wide app state. | Shared by timesheet and approval views. |
| `timesheetStore.ts` | Editable timesheet rows, OT placeholder rows, remark, dirty flag. | Initialized from server data; save payload is built in `TimesheetPage`. |

## Timesheet Store Shape

- `rows`: project rows with `percents` by date and row descriptions.
- `overtime`: retained placeholder record by date; UI currently disables editing.
- `remark`: weekly remark.
- `isDirty`: local unsaved state.

The store intentionally keeps percent integers for UI editing, while save payload converts percent to workday decimals.
