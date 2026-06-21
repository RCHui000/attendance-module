# Timesheet Approval Template Routing And Data-Driven Gap

## Current Fix

Timesheet approvals now route through the configured `contract_approval` templates:

- `contract_approval_pm_v1`
- `contract_approval_cc_v1`
- `contract_approval_pmcc_v1`

`submit_document('timesheet', ...)` still keeps `approval_instances.target_type = 'timesheet'`, but selects the template from `document_type = 'contract_approval'` according to the inferred PM/CC/PMCC business type. Runtime nodes now write `template_node_key` values that match the selected template nodes.

The approval-chain RPC now exposes a template-node view. Project blocks and assignees are aggregated under the corresponding template node instead of becoming top-level chain nodes.

## Verified Production State After Migration 099

- Submitted/running timesheet instances use `contract_approval` templates.
- Current distribution: CC = 2, PMCC = 11, PM = 0.
- Pending timesheet tasks are attached to `contract_approval_cc_v1` or `contract_approval_pmcc_v1`.
- A transaction-only submit smoke for draft timesheet `166` selected `contract_approval_pmcc_v1`, created 15 runtime nodes, and mapped all 15 to template nodes.

## Remaining Data-Driven Gap

The system is now template-selected and template-displayed, but not fully template-generated.

### 1. Business Type Inference Is Still Code

`psa_timesheet_business_type()` infers PM/CC/PMCC from project `business_type` or project-code prefixes. This is better centralized in the database than frontend logic, but still code-driven.

Target direction: make the selection rule explicit data, for example a `timesheet_template_routing_rules` table with priority and match conditions.

### 2. Runtime Node Expansion Still Has Timesheet-Specific Logic

New timesheet submissions expand non-submitter template nodes once per project. That uses template nodes, but the expansion rule itself is still hardcoded in `submit_document`.

Target direction: move expansion mode into template node data, such as `scope_strategy = per_project | once_per_document | submitter_virtual`.

### 3. Role Alias Handling Is Still Code

`cc_project_owner` maps to specialized project roles such as `cc_mep_project_owner` and `cc_civil_project_owner` in resolver code.

Target direction: move role aliases/fallbacks into a table, reusing or extending `project_role_requirements`.

### 4. Optional Node Behavior Is Still Code

Timesheet project nodes are generated as optional so missing project-role assignments skip instead of blocking submission. That policy is currently encoded in `submit_document`.

Target direction: add an explicit template-node flag or policy field for optional/required behavior.

### 5. Existing Historical Nodes Are Backfilled, Not Rebuilt

Migration 099 backfills running submitted instances so their nodes map to selected templates. It does not reconstruct historical completed approval graphs.

Target direction: leave historical graphs as audit records unless a full archival normalization project is needed.

## Practical Assessment

After this fix, the approval center should behave according to the configured three-template model for current and future timesheet approvals. The largest remaining gap is not display; it is the runtime expansion engine. The next meaningful data-driven step is to make template nodes declare how they expand and which role aliases/fallbacks they accept.
