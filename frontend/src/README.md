# Frontend Module Map

This frontend is a React + Vite single page app. It keeps the old `/api/*` call shape, but most calls are handled in `src/lib/api.ts` and then forwarded to GoTrue, PostgREST, RPC, or a controlled `serve_spa.py` endpoint.

## Runtime Flow

- `main.tsx` mounts React and React Query.
- `App.tsx` checks auth state through `authStore`.
- Unauthenticated users see `LoginPage`.
- Authenticated users enter `AppLayout` with these routes:
  - `/timesheet`: weekly timesheet entry.
  - `/leave`: leave request entry placeholder; available to all authenticated roles.
  - `/dashboard`: BI dashboard.
  - `/review`: approval center.
  - `/report`: project list and project reporting.
  - `/employees`: employee and organization management.
  - `/apps`: application center placeholder; available to all authenticated roles and shown last in sidebar order.

## Module Directories

| Directory | Purpose |
| --- | --- |
| `components/timesheet` | Weekly project workday entry table and validation UI. |
| `components/review` | Approval task lists and timesheet detail expansion/drawer. |
| `components/report` | Project CRUD, project financial/labor summary, project detail drawer. |
| `components/employees` | Employee table, edit rows, organization tree, reminders. |
| `components/dashboard` | Metric cards and BI perspectives. |
| `components/layout` | App shell, sidebar, topbar, brand, login screen. |
| `components/ui` | Local shadcn-style primitives. |
| `hooks` | TanStack Query wrappers around `api()`. |
| `stores` | Zustand state for auth, app navigation, and timesheet drafts. |
| `lib` | API compatibility layer, constants, token helpers, utilities. |
| `types` | Shared TypeScript contracts. |
| `utils` | Date and timesheet validation helpers. |

## Versioning

The displayed app version is generated at Vite build time:

1. `VITE_APP_VERSION`, `APP_IMAGE_TAG`, or `IMAGE_TAG` if explicitly provided.
2. Exact Git release tag, for example `V0.14.7`.
3. Latest tag plus short commit, for untagged development builds.
4. `dev` if Git metadata is unavailable.

Normal releases should not manually edit `constants.ts` for version changes.
