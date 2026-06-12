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

1. 数据看板
2. 审批中心
3. 我的周表
4. 请假申请
5. 项目列表
6. 员工与组织
7. 应用中心

`请假申请` and `应用中心` are visible to every authenticated role. `应用中心` is the last normal sidebar option, not a sticky footer item.

## API Calls

| Caller | Endpoint | Method | Purpose |
| --- | --- | --- | --- |
| `authStore.login` | `/api/login` | POST | Login and store JWT. |
| `authStore.logout` | `/api/logout` | POST | Clear token. |
| password change UI | `/api/password/change` | POST | Change initial or existing password. |
| `authStore.checkSession` | `/api/me` | GET | Resolve current user and role. |

## Version Display

`Brand` and `Sidebar` display `APP_VERSION` from `src/lib/constants.ts`. The value is injected by `vite.config.ts` from release metadata at build time.
