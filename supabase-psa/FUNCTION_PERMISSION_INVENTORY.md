# Public Function Permission Inventory

Updated: 2026-06-20
Baseline: production after `V0.16.46` / migration `089_function_execute_grants_hardening.sql`

This inventory tracks the 44 functions in the PostgreSQL `public` schema. They
are not all public-facing RPC APIs. Most are internal database helpers used by
RLS policies, triggers, or SECURITY DEFINER domain RPCs.

## Tier Definitions

| Tier | Meaning | Direct app-role access |
| --- | --- | --- |
| `PUBLIC` | Anonymous/login-time PostgREST surface. This is not the PostgreSQL `PUBLIC` role grant. | `anon` and usually `authenticated` |
| `AUTH` | Authenticated user RPC endpoint or RLS helper required by normal app flows. | `authenticated` |
| `INTERNAL` | Called by triggers, RLS policies, or SECURITY DEFINER wrappers. Not an external RPC contract. | none for `anon` / `authenticated` |
| `SYSTEM` | Maintenance, backfill, or legacy candidate. Run only by DB owner/service operations after review. | none for `anon` / `authenticated` |

PostgreSQL role `PUBLIC` execute grants must remain `0`.

## Current Summary

| Metric | Expected after V0.16.46 |
| --- | ---: |
| `public` schema functions | 44 |
| PostgreSQL `PUBLIC` execute grants | 0 |
| `anon` executable functions | 3 |
| `authenticated` executable functions | 16 |

## Inventory

| Function | Tier | Frontend use | App-role grants | Rationale / next action |
| --- | --- | --- | --- | --- |
| `approve_node(bigint,bigint,text,text)` | `INTERNAL` | no | none | Approval primitive used by domain RPCs. Keep blocked from direct RPC. |
| `can_edit_rejected_timesheet_project_entries(bigint,bigint)` | `AUTH` | indirect RLS | `authenticated` | RLS helper for rejected project-block edits. |
| `can_insert_timesheet_project_revision_entries(bigint,bigint)` | `AUTH` | indirect RLS | `authenticated` | RLS helper for adding entries to rejected project blocks. |
| `current_employee_id()` | `AUTH` | indirect RLS/RPC | `authenticated` | Maps `auth.uid()` to `employees.id`; required by policies and guards. |
| `current_user_can_access_resource(text,text)` | `PUBLIC` | indirect RLS/UI | `anon`, `authenticated` | RBAC helper. Anon grant supports public/login policy paths; avoid direct product use. |
| `current_user_can_manage_employee(bigint)` | `AUTH` | indirect RLS | `authenticated` | Department-manager employee edit helper. |
| `current_user_can_review()` | `PUBLIC` | indirect RLS | `anon`, `authenticated` | Review permission helper. Anon grant supports PostgREST policy evaluation paths. |
| `current_user_has_role(text)` | `AUTH` | indirect RLS/RPC | `authenticated` | Legacy/simple role helper used by policies and RPC guards. |
| `current_user_manages_org(bigint)` | `AUTH` | indirect RLS | `authenticated` | Organization-manager scope helper. |
| `delegate_node(bigint,bigint,bigint,text,text)` | `INTERNAL` | no | none | Approval primitive reserved for a future domain wrapper. |
| `prevent_empty_rejected_project_resubmit()` | `INTERNAL` | trigger | none | Trigger guard for rejected project resubmission integrity. |
| `psa_activate_ready_nodes(bigint)` | `INTERNAL` | no | none | Approval graph scheduler helper. |
| `psa_approval_instance_status(text)` | `INTERNAL` | no | none | Status mapping helper. Keep internal. |
| `psa_ensure_timesheet_approval_round(bigint,bigint,text,text)` | `SYSTEM` | no | none | Legacy adaptive-graph helper. Review before reuse or removal. |
| `psa_overtime_action(bigint,text,text)` | `AUTH` | frontend RPC | `authenticated` | Overtime action endpoint; UI is currently mostly reserved/locked. |
| `psa_primary_org_manager(bigint)` | `INTERNAL` | no | none | Route resolver helper. |
| `psa_refresh_pending_project_review_routes(bigint,text)` | `AUTH` | frontend RPC | `authenticated` | Admin route-refresh endpoint for pending project reviews. |
| `psa_refresh_project_timesheet_routes(bigint,text)` | `AUTH` | frontend RPC | `authenticated` | Admin route-refresh endpoint for project timesheets. |
| `psa_refresh_timesheet_routes(bigint,bigint,text)` | `INTERNAL` | no | none | Single-timesheet route refresh helper. |
| `psa_resolve_graph_assignees(bigint,text,text,bigint)` | `INTERNAL` | no | none | Approval graph assignee resolver. |
| `psa_resolve_login_email(text)` | `PUBLIC` | frontend RPC | `anon`, `authenticated` | Login alias resolution before password auth. |
| `psa_resolve_project_review_assignee(bigint,bigint,bigint)` | `INTERNAL` | no | none | Project-review route resolver. |
| `psa_resolve_timesheet_assignees(bigint)` | `SYSTEM` | no | none | Legacy timesheet resolver. Review before reuse or removal. |
| `psa_resolve_timesheet_department_reviewer(bigint)` | `SYSTEM` | no | none | Legacy department reviewer resolver. Review before reuse or removal. |
| `psa_resolve_timesheet_project_assignees(bigint)` | `INTERNAL` | no | none | Project-block assignee resolver used by approval-chain construction. |
| `psa_save_role_permission(text,text,text)` | `AUTH` | frontend RPC | `authenticated` | Permission matrix save endpoint. |
| `psa_save_role_sidebar_order(text,text,integer)` | `AUTH` | frontend RPC | `authenticated` | Permission sidebar order save endpoint. |
| `psa_sync_business_platform_roles(bigint[])` | `SYSTEM` | no | none | Maintenance/backfill sync from department/project owner assignments to platform roles. |
| `psa_sync_timesheet_project_review_task_trigger()` | `SYSTEM` | legacy trigger | none | Legacy `workflow_tasks` sync trigger candidate. Verify before removal. |
| `psa_sync_timesheet_project_revisions(bigint,jsonb)` | `AUTH` | frontend RPC | `authenticated` | Rejected project-block revision save endpoint. |
| `psa_template_snapshot(bigint)` | `INTERNAL` | no | none | Approval template snapshot helper. |
| `psa_timesheet_action(bigint,text,text,bigint)` | `AUTH` | frontend RPC | `authenticated` | Timesheet submit/approve/reject/reopen/withdraw domain endpoint. |
| `psa_timesheet_project_approval_chain(bigint)` | `INTERNAL` | no | none | Project approval chain builder. |
| `psa_touch_organization_managers()` | `INTERNAL` | trigger | none | `updated_at` trigger function. |
| `psa_touch_project_department_owners()` | `INTERNAL` | trigger | none | `updated_at` trigger function. |
| `psa_touch_timesheet_project_reviews()` | `INTERNAL` | trigger | none | `updated_at` trigger function. |
| `psa_validate_timesheet_regular_hours()` | `INTERNAL` | trigger | none | Timesheet regular-hour guard trigger. |
| `psa_write_approval_event(bigint,bigint,bigint,bigint,bigint,text,text,text,text,text,jsonb)` | `INTERNAL` | no | none | Approval event writer. |
| `reject_node(bigint,bigint,text,text,text,text)` | `INTERNAL` | no | none | Approval primitive used by domain RPCs. Keep blocked from direct RPC. |
| `reopen_document(bigint,bigint,jsonb,text)` | `INTERNAL` | no | none | Approval primitive reserved for domain wrapper use. |
| `revise_document(bigint,integer,bigint,jsonb,text)` | `INTERNAL` | no | none | Approval primitive reserved for domain wrapper use. |
| `skip_node(bigint,bigint,text,text)` | `INTERNAL` | no | none | Approval primitive reserved for domain wrapper use. |
| `submit_document(text,bigint,integer,text,bigint,jsonb,text)` | `INTERNAL` | no | none | Approval primitive called by domain RPCs. Keep blocked from direct RPC. |
| `touch_app_center_items_updated_at()` | `INTERNAL` | trigger | none | `updated_at` trigger function. |

## Frontend RPC Allowlist

These are the only public schema functions currently called directly from
frontend code:

- `psa_resolve_login_email`
- `psa_save_role_permission`
- `psa_save_role_sidebar_order`
- `psa_sync_timesheet_project_revisions`
- `psa_timesheet_action`
- `psa_refresh_pending_project_review_routes`
- `psa_refresh_project_timesheet_routes`
- `psa_overtime_action`

## Maintenance Rules

1. New frontend RPCs must be added to this inventory before release.
2. New internal helper functions must not grant execute to `PUBLIC`, `anon`, or `authenticated`.
3. `PUBLIC` tier additions require an explicit reason because they are reachable before login.
4. Run `scripts/audit-public-function-grants.sql` after every migration that creates, replaces, or grants functions.
5. Any function in `SYSTEM` tier should be reviewed before it is reused; prefer a new domain RPC wrapper over exposing it directly.
6. The `44` count is the inventory of PostgreSQL functions in the `public` schema, not an RPC exposure target; only functions listed in the frontend RPC allowlist should be treated as direct app RPC contracts.
7. T6 local Docker development setup is deferred and does not block T1-T5 cloud/pre-production validation scripts or this inventory maintenance.
