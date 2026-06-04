# V0.12.8 Adaptive Approval Graph Migration Plan

## Goal

Migrate the current weekly timesheet approval architecture toward an Adaptive Approval Graph without breaking the existing production workflow.

The current `workflow_tasks` table remains the active task queue. V0.12.8 adds graph tables and a synchronization layer so every timesheet approval can be inspected as:

- `approval_instances`: one business document's full approval lifecycle.
- `approval_rounds`: one submit / revision submit / reopened revision round.
- `approval_nodes`: approval graph nodes in a round.
- `approval_edges`: dependencies between nodes.
- `approval_events`: append-only lifecycle events.

## Scope

1. Add graph tables, indexes, grants, and RLS policies.
2. Add synchronization functions that derive graph state from the current `timesheets`, `timesheet_entries`, and `workflow_tasks`.
3. Add non-blocking triggers so existing `psa_timesheet_action` mutations keep the graph current.
4. Keep existing frontend approval UI and RPC calls compatible.
5. Backfill graph records for existing submitted / approved / rejected timesheets that have workflow history.
6. Update PRD and release manifest for V0.12.8.
7. Deploy to NAS, validate with a temporary timesheet, then clean test data.

## Non-Goals

1. Do not replace `workflow_tasks` in V0.12.8.
2. Do not redesign the approval center UI in V0.12.8.
3. Do not implement project-manager recall, department selective return, or post-approval reopen UI in this version.
4. Do not invalidate completed project approvals when project owners change.

## Data Model

### approval_instances

One row per business document lifecycle.

Key fields:

- `target_type`
- `target_id`
- `status`
- `current_round_id`
- `created_by`
- `completed_at`

### approval_rounds

One row per submission/revision/reopen round.

Key fields:

- `instance_id`
- `round_no`
- `round_type`
- `status`
- `based_on_round_id`
- `started_by`
- `completed_at`

### approval_nodes

One row per approval unit inside a round.

Key fields:

- `round_id`
- `node_key`
- `node_type`
- `scope_type`
- `scope_id`
- `status`
- `assignee_user_id`
- `source_task_id`

### approval_edges

Directed dependency edges inside a round.

Initial V0.12.8 shape:

- project review nodes point to the department summary node.
- edges use `condition_type = 'all_approved'`.

### approval_events

Append-only audit events across the full instance lifecycle.

Key fields:

- `instance_id`
- `round_id`
- `node_id`
- `actor_id`
- `event_type`
- `comment`
- `payload`

## Migration Steps

1. Create graph tables and constraints.
2. Create `psa_sync_timesheet_approval_graph(p_timesheet_id, p_event_type, p_comment)`.
3. Create triggers on `workflow_tasks` and `timesheets` to sync graph state after legacy workflow changes. Trigger errors must not block the legacy approval RPC path.
4. Backfill existing timesheets with workflow history.
5. Deploy migration to NAS and restart PostgREST.
6. Build frontend with `V0.12.8` and deploy to NAS.
7. Verify:
   - submitting a temporary timesheet creates an instance, round, project nodes, summary node, and edges.
   - approving project nodes updates node statuses.
   - same-person collapse still creates approved project nodes and a pending summary node.
   - project owner changes do not invalidate completed project nodes.
8. Clean temporary test data.
9. Commit, tag, and push V0.12.8.

## Rollback Strategy

The migration is additive. If issues appear:

1. Disable graph triggers.
2. Keep `workflow_tasks` and `psa_timesheet_action` running unchanged.
3. Drop graph tables only after confirming no downstream tooling depends on them.

## Acceptance Criteria

1. Existing approval actions continue to work.
2. Graph tables are populated automatically without frontend changes.
3. `approval_instances` has one lifecycle instance per `target_type + target_id`; resubmits create new `approval_rounds`.
4. Node and edge sync is idempotent; repeated trigger execution does not duplicate active graph nodes or graph edges.
5. Existing V0.12.7 route-refresh behavior remains valid.
6. NAS deployment is healthy at the reverse proxy entrypoint.
7. GitHub main and tag `V0.12.8` point to the release commit.
