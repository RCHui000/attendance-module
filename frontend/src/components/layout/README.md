# Layout Module

The layout module owns the application shell: navigation, branding, topbar context, and login screen.

## Entry Points

| File | Role |
| --- | --- |
| `AppLayout.tsx` | Main authenticated shell. |
| `Sidebar.tsx` | Navigation and version display. |
| `Topbar.tsx` | Current page title/subtitle. |
| `Brand.tsx` | Product name, tagline, version. |
| `LoginScreen.tsx` | Login and password-change form. |

## API Calls

| Caller | Endpoint | Method | Purpose |
| --- | --- | --- | --- |
| `authStore.login` | `/api/login` | POST | Login and store JWT. |
| `authStore.logout` | `/api/logout` | POST | Clear token. |
| password change UI | `/api/password/change` | POST | Change initial or existing password. |
| `authStore.checkSession` | `/api/me` | GET | Resolve current user and role. |

## Version Display

`Brand` and `Sidebar` display `APP_VERSION` from `src/lib/constants.ts`. The value is injected by `vite.config.ts` from release metadata at build time.
