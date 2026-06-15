-- V0.15.3 hotfix: project-block resubmission is scoped by project nodes.
-- A rejected project node cannot be moved back into review unless its
-- timesheet still has entries for that project block.

BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_empty_rejected_project_resubmit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_timesheet_id bigint;
BEGIN
  IF OLD.scope_type = 'project'
     AND OLD.status = 'rejected'
     AND NEW.status IN ('waiting', 'pending', 'active')
     AND OLD.scope_id IS NOT NULL THEN
    SELECT i.target_id INTO v_timesheet_id
    FROM public.approval_instances i
    WHERE i.id = OLD.instance_id
      AND i.target_type = 'timesheet'
    LIMIT 1;

    IF v_timesheet_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.timesheet_entries te
         WHERE te.timesheet_id = v_timesheet_id
           AND te.project_id = OLD.scope_id
           AND COALESCE(te.hours, 0) > 0
       ) THEN
      RAISE EXCEPTION 'Cannot resubmit rejected project block without timesheet entries'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.prevent_empty_rejected_project_resubmit() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_empty_rejected_project_resubmit() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prevent_empty_rejected_project_resubmit ON public.approval_nodes;
CREATE TRIGGER trg_prevent_empty_rejected_project_resubmit
BEFORE UPDATE OF status ON public.approval_nodes
FOR EACH ROW
EXECUTE FUNCTION public.prevent_empty_rejected_project_resubmit();

NOTIFY pgrst, 'reload schema';

COMMIT;
