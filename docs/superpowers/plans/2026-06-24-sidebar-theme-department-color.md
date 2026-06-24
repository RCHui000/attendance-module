# Sidebar Theme Department Color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move settings/logout into the sidebar, add theme selection, support configured department color chips in approval rows, and remove redundant refresh buttons.

**Architecture:** Keep navigation settings local to the frontend and persist theme preference in localStorage. Store department color as an organization field so approval rows can render colors from live organization data. Remove page-level refresh buttons without changing query invalidation or realtime behavior.

**Tech Stack:** React, Tailwind CSS, Supabase/PostgREST migrations, existing local API wrapper.

---

### Task 1: Sidebar Settings And Theme

**Files:**
- Modify: `frontend/src/components/layout/Topbar.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Create: `frontend/src/components/layout/ThemeSettingsDialog.tsx`
- Modify: `frontend/src/index.css`

- [ ] Remove identity and logout controls from `Topbar`.
- [ ] Add icon-only pill settings/logout controls to sidebar bottom.
- [ ] Add theme dialog with light/dark/system choices.
- [ ] Persist theme choice and apply `.dark` to `document.documentElement`.

### Task 2: Organization Department Color

**Files:**
- Create: `supabase-psa/migrations/115_organization_department_color.sql`
- Modify: `frontend/src/types/employee.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/employees/OrganizationPanel.tsx`

- [ ] Add nullable `color_token` to `organizations`.
- [ ] Include `color_token` in organization API objects.
- [ ] Save organization color selection.
- [ ] Render low-saturation color swatches in organization edit form.

### Task 3: Approval Department Chips

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/types/approval.ts`
- Modify: `frontend/src/components/review/ApprovalTable.tsx`
- Modify: mobile review cards if department is displayed there.

- [ ] Add `department_color_token` to approval task mapping.
- [ ] Render department column as a pill only when `department_color_token` is configured.
- [ ] Leave unconfigured departments as plain text.

### Task 4: Remove Redundant Refresh Buttons

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/pages/ReportPage.tsx`
- Modify: `frontend/src/pages/EmployeesPage.tsx`
- Modify: `frontend/src/pages/review/ReviewDesktop.tsx`
- Modify: `frontend/src/pages/review/ReviewMobile.tsx`
- Modify: `frontend/src/pages/dashboard/DashboardMobile.tsx`

- [ ] Remove page-level refresh buttons from data dashboard, project list, employee/org pages, and approval center.
- [ ] Keep error text and realtime/query refresh behavior intact.

### Task 5: Verification

- [ ] Run `git diff --check`.
- [ ] Run `npm --prefix frontend run build`.
- [ ] Run relevant SQL migration dry-run if needed.
