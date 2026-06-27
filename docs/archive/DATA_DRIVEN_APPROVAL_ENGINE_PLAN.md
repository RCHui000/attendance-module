# Data-Driven Approval Engine Plan

This document records the direction implemented after `TIMESHEET_APPROVAL_DATA_DRIVEN_GAP.md`. The current summary lives in `../architecture/APPROVAL_ARCHITECTURE.md`.

## Goal

Timesheet approval should be generated from approval-template data, not from hidden branches inside `submit_document()`.

The important runtime decisions are now modeled as data:

- business type inference rules;
- timesheet-to-template routing rules;
- template-node expansion strategy;
- role alias candidates;
- missing-assignee policy.

## Implemented Shape

Migration `101_timesheet_data_driven_approval_engine.sql` adds the following configuration tables:

- `approval_business_type_source_rules`
- `approval_business_type_merge_rules`
- `approval_template_routing_rules`
- `approval_role_aliases`
- `approval_engine_settings`

It also extends template/runtime graph tables:

- `approval_template_nodes.scope_strategy`
- `approval_template_nodes.scope_source`
- `approval_template_nodes.runtime_scope_type`
- `approval_template_nodes.runtime_node_key_template`
- `approval_template_nodes.missing_assignee_policy`
- `approval_template_edges.scope_join_policy`
- `approval_nodes.scope_strategy`
- `approval_nodes.missing_assignee_policy`

For the three weekly timesheet templates:

- submitter nodes are `submitter_virtual`;
- approval nodes expand `per_project`;
- runtime scope is `project`;
- runtime node key is `project_{scope_id}_{node_key}`;
- missing project approvers use `skip`, not admin fallback.

## New Internal Helpers

- `psa_resolve_document_business_type(...)`
- `psa_select_approval_template(...)`
- `psa_resolve_role_candidates(...)`
- `psa_expand_approval_template(...)`
- 5-argument internal `psa_resolve_graph_assignees(...)` with explicit admin fallback control

These helpers are internal. They are `SECURITY DEFINER` but not granted to `authenticated`.

## Verification

Use these scripts after deployment:

- `scripts/assert-timesheet-data-driven-approval.sql`
- `scripts/assert-timesheet-template-routing.sql`
- `scripts/smoke-timesheet-submit-contract-routing.sql`
- `scripts/smoke-timesheet-special-day-create-no-pkey.sql`
- `scripts/assert-function-grants.sql`

Before applying the migration permanently, a rollback canary was run against production: migration DDL plus a transaction-only timesheet submit. It verified template selection, runtime node count, node-template mappings, per-project expansion policy, missing-assignee policy, and runtime edges.

## Remaining Follow-Up

The engine is data-driven for runtime behavior. The remaining work is mainly admin UX:

- expose the new template-node strategy fields in the approval-template editor;
- add validation in the template editor so admins cannot create inconsistent scope/edge combinations;
- decide whether business type and role alias rules need UI management or should stay database-seeded configuration.
