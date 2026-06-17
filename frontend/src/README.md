# Frontend Module Map

This frontend is a React + Vite single page app. It keeps the old `/api/*` call shape, but most calls are handled in `src/lib/api.ts` and then forwarded to GoTrue, PostgREST, RPC, or a controlled `serve_spa.py` endpoint.

## Runtime Flow

- `main.tsx` mounts React and React Query.
- `App.tsx` checks auth state through `authStore`.
- Unauthenticated users see `LoginPage`.
- Authenticated users enter `AppLayout` with these routes:
  - `/timesheet`: weekly/month-split timesheet entry.
  - `/leave`: leave request entry placeholder; available to all authenticated roles.
  - `/dashboard`: BI dashboard.
  - `/review`: approval center.
  - `/report`: project list, mobile popup editor, and project reporting.
  - `/employees`: employee/organization system management and platform permission configuration.
  - `/apps`: application card center with admin maintenance; visible when the `apps` resource is readable.

## Module Directories

| Directory | Purpose |
| --- | --- |
| `components/timesheet` | Weekly/month-split project workday entry table, intent recognition, and validation UI. |
| `components/review` | Approval task lists and desktop/mobile timesheet detail expansion. |
| `components/report` | Project CRUD, mobile project popup editor, project financial/labor summary, project detail drawer. |
| `components/employees` | Employee table, edit rows, organization tree, reminders, permission matrix. |
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
