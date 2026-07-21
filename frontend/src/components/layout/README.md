# Layout Module

The layout module owns the application shell: navigation, branding, topbar context, responsive shell behavior, and login screen.

## Entry Points

| File | Role |
| --- | --- |
| `AppLayout.tsx` | Main authenticated shell. |
| `Sidebar.tsx` | Navigation and version display. |
| `Topbar.tsx` | Current page title. |
| `Brand.tsx` | Product name, tagline, version. |
| `LoginScreen.tsx` | Login and password-change form with animated background. |

## Navigation

`Sidebar.tsx` owns authenticated navigation. Current default order is:

1. 数据看板
2. 审批中心
3. 我的周表
4. 请假申请
5. 项目列表
6. 员工与组织
7. 应用中心

Each item has a stable `id` and explicit numeric default `order`. Rendering uses the current role's `sidebarOrder` from `/api/bootstrap` when configured, then falls back to the default order after permission filtering. Visibility is resolved from the platform RBAC matrix returned by `/api/bootstrap`.

Route modules preload on navigation intent. Route-level Suspense stays inside the authenticated shell so sidebar and topbar remain stable while a page chunk loads.

`Sidebar.tsx` checks these resource keys: `dashboard`, `review`, `timesheet`, `leave`, `report`, `system_management`, and `apps`. `应用中心` remains the last normal sidebar option, not a sticky footer item.

## UI Conventions

- Global typography uses Microsoft YaHei / 微软雅黑.
- Topbar should show the active sidebar function name as the page title. Extra explanatory subtitles should be omitted unless they are actionable.
- Login uses the layered wave background from `Downloads/layered-wave-login-background-interactive.html` and a lightly translucent login card.
- Mobile shell uses compact navigation and avoids squeezing desktop side-by-side panels into narrow widths.

## API Calls

| Caller | Endpoint | Method | Purpose |
| --- | --- | --- | --- |
| `authStore.login` | Supabase Auth SDK | n/a | Resolve login alias, call `signInWithPassword`, and store JWT. |
| `authStore.logout` | `/api/logout` | POST | Clear token. |
| password change UI | `/api/password/change` | POST | Change initial or existing password. |
| `authStore.checkSession` | `/api/bootstrap` | GET | Resolve current user, role, resource permissions, and current week. |

## Version Display

`Brand` and `Sidebar` display `APP_VERSION` from `src/lib/constants.ts`. The value is injected by `vite.config.ts` from release metadata at build time.
