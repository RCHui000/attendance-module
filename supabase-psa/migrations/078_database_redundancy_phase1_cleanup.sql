-- V0.16 database review phase 1:
-- remove confirmed-retired scaffolding and mark compatibility tables so new
-- work does not treat them as active facts.

BEGIN;

DROP TABLE IF EXISTS public.workflow_steps CASCADE;
DROP TABLE IF EXISTS public.workflow_templates CASCADE;

DROP TABLE IF EXISTS public.approval_graph_cutover_audit;
DROP TABLE IF EXISTS public.approval_graph_history_repair_audit;

UPDATE public.permission_resource_effects
SET object_name = 'approval_events',
    description = 'Record approval graph decisions.'
WHERE resource_key = 'review'
  AND access_level = 'write'
  AND object_type = 'table'
  AND object_name = 'approval_logs'
  AND operation = 'insert';

COMMENT ON TABLE public.permission_resource_effects IS
  'Documentation-only permission effect map. Runtime access is enforced by role_permissions, RLS policies, and RPC guards.';

COMMENT ON TABLE public.approval_logs IS
  'Deprecated legacy approval log table. V0.15+ approval actions write approval_events as the canonical audit trail.';

COMMENT ON TABLE public.timesheet_project_reviews IS
  'Deprecated compatibility read model for legacy project-block reviews. V0.15+ project-block state is derived from Approval Graph views.';

NOTIFY pgrst, 'reload schema';

COMMIT;
