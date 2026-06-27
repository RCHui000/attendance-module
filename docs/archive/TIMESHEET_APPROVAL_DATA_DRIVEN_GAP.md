# Timesheet Approval Data-Driven Gap

## Current State

Timesheet approvals now use the three configured `contract_approval` templates:

- `contract_approval_pm_v1`
- `contract_approval_cc_v1`
- `contract_approval_pmcc_v1`

Migration `099_timesheet_contract_approval_template_routing.sql` fixed the first bug: submitted/running weekly timesheets are routed to these templates and the approval-chain UI groups runtime project nodes under template nodes.

Migration `101_timesheet_data_driven_approval_engine.sql` moves the remaining runtime decisions into database configuration:

- business type inference: `approval_business_type_source_rules` and `approval_business_type_merge_rules`;
- template routing: `approval_template_routing_rules`;
- node expansion: `approval_template_nodes.scope_strategy` and related runtime fields;
- role aliases: `approval_role_aliases`;
- optional behavior: `approval_template_nodes.missing_assignee_policy`, copied to `approval_nodes.missing_assignee_policy`.

`submit_document()` now selects templates via `psa_select_approval_template()` and creates runtime nodes via `psa_expand_approval_template()`.

## Closed Gaps

1. Business type inference is no longer hardcoded only inside `psa_timesheet_business_type()`.
   The old behavior remains as fallback, but the primary path reads source and merge rules.

2. Runtime node expansion is no longer hand-coded inside `submit_document()`.
   Template nodes declare whether they are virtual submitter nodes, once-per-document nodes, or per-project nodes.

3. Role alias handling is data-backed.
   `cc_project_owner` and related aliases are seeded in `approval_role_aliases`.

4. Optional project approver behavior is data-backed.
   Missing project approvers use `missing_assignee_policy = 'skip'`, and skip mode disables admin fallback.

5. Template edges are de-duplicated and protected by a unique index on template path.

## Remaining Gap

The runtime engine is now data-driven, but the admin editor is not yet fully data-driven:

- the approval-template page does not expose `scope_strategy`, `scope_source`, `runtime_scope_type`, `runtime_node_key_template`, or `missing_assignee_policy`;
- routing rules, business type rules, and role aliases are seeded by migration, not managed in UI;
- historical completed approval graphs are preserved as audit records and are not rebuilt.

This is acceptable for the current release because new submissions follow the data-driven engine, while historical graphs remain stable.
