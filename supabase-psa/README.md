# Supabase PSA Runtime

This directory contains the self-hosted Supabase-compatible runtime and ordered PostgreSQL migrations.

## Runtime Components

| Component | Purpose |
| --- | --- |
| PostgreSQL 16 | Main database with `public` and `auth` schemas. |
| GoTrue | Authentication and JWT issuing. |
| PostgREST | REST API over PostgreSQL tables/views/RPC. |
| Realtime | Table-change notifications for frontend invalidation. |

## Migration Rules

- Add a new numbered migration for every database change.
- Do not edit already deployed migrations.
- On a fresh self-hosted stack, start `postgres`, `gotrue`, `realtime`, and `postgrest` before applying application migrations. Realtime owns the base `public.tenants`, `public.extensions`, and `public.schema_migrations` tables; application migrations use `public.psa_schema_migrations`.
- Apply migrations on NAS/cloud before deploying frontend code that depends on them.
- Refresh PostgREST schema cache with `NOTIFY pgrst, 'reload schema'` when schema changes.
- Back up cloud PostgreSQL before production migration.
- Keep public function exposure documented in `FUNCTION_PERMISSION_INVENTORY.md` and re-run `scripts/audit-public-function-grants.sql` after function/RPC grant changes.

## Current Important Migration Groups

| Range | Area |
| --- | --- |
| `001`-`009` | Base schema, RLS, Supabase runtime, report dedup. |
| `010`-`022` | Timesheet workflow RPC, project approvals, route refresh. |
| `023`-`032` | Adaptive graph groundwork, employee RLS fixes, realtime updates. |
| `033`-`035` | Approval Graph B, contract templates, project service type roles. PM/CC/PMCC routes must match the PRD contract approval chains. |
| `036`-`037` | Timesheet regular workday precision and 7-day weekly cap guards. |
| `038` | Organization hierarchy seed and cost specialty field for civil/MEP routing. |
| `039` | Normalize the visible department tree to 项目管理 / 成本合约 and 项目管理's 设计 / 管理 / 成本 children. |
| `040` | Limit cost specialty to execution/project-owner employees; clear it from department heads/managers/admins. |
| `041` | Align PM/CC/PMCC contract routes and Approval Graph review views. |
| `042` | V0.15 Approval Graph cutover: migrate `workflow_tasks`, verify counts, and drop the legacy table. |
| `048`-`050` | Timesheet department/specialty routing, summary fallback, and restored sequence alignment. |
| `051` | Serial timesheet project-block Approval Graph chains; optional middle roles are skipped and adjacent duplicate approvers collapse to the last role. |
| `052` | Project-scoped timesheet rejection and resubmission; rejecting one project block no longer cancels other pending blocks in the same sheet. |
