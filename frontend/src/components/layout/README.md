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

## Navigation

`Sidebar.tsx` owns authenticated navigation. Current order is:

1. 我的周表
2. 请假申请
3. 数据看板
4. 审批中心
5. 项目列表
6. 员工与组织
7. 应用中心

Visibility is resolved from the platform RBAC matrix returned by `/api/bootstrap`. `Sidebar.tsx` checks these resource keys: `timesheet`, `leave`, `dashboard`, `review`, `report`, `system_management`, and `apps`. `应用中心` remains the last normal sidebar option, not a sticky footer item.

## API Calls

| Caller | Endpoint | Method | Purpose |
| --- | --- | --- | --- |
| `authStore.login` | `/api/login` | POST | Login and store JWT. |
| `authStore.logout` | `/api/logout` | POST | Clear token. |
| password change UI | `/api/password/change` | POST | Change initial or existing password. |
| `authStore.checkSession` | `/api/bootstrap` | GET | Resolve current user, role, resource permissions, projects, and current week. |

## Version Display

`Brand` and `Sidebar` display `APP_VERSION` from `src/lib/constants.ts`. The value is injected by `vite.config.ts` from release metadata at build time.
