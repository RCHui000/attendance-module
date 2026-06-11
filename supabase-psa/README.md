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
- Apply migrations on NAS/cloud before deploying frontend code that depends on them.
- Refresh PostgREST schema cache with `NOTIFY pgrst, 'reload schema'` when schema changes.
- Back up cloud PostgreSQL before production migration.

## Current Important Migration Groups

| Range | Area |
| --- | --- |
| `001`-`009` | Base schema, RLS, Supabase runtime, report dedup. |
| `010`-`022` | Timesheet workflow RPC, project approvals, route refresh. |
| `023`-`032` | Adaptive graph groundwork, employee RLS fixes, realtime updates. |
| `033`-`035` | Approval Graph B, contract templates, project service type roles. |
| `036`-`037` | Timesheet regular workday precision and 7-day weekly cap guards. |
