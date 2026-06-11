-- V0.13: Explicit lifecycle table for each project block in a timesheet.

BEGIN;

CREATE TABLE IF NOT EXISTS public.timesheet_project_reviews (
  id BIGSERIAL PRIMARY KEY,
  timesheet_id BIGINT NOT NULL REFERENCES public.timesheets(id),
  project_id BIGINT NOT NULL REFERENCES public.projects(id),
  submitter_user_id BIGINT NOT NULL REFERENCES public.employees(id),
  submitter_org_id_snapshot BIGINT REFERENCES public.organizations(id),
  project_owner_id_snapshot BIGINT REFERENCES public.employees(id),
  department_manager_id_snapshot BIGINT REFERENCES public.employees(id),
  route_source TEXT NOT NULL DEFAULT 'legacy_workflow_task',
  status TEXT NOT NULL DEFAULT 'pending_project_review',
  round_no INTEGER NOT NULL DEFAULT 1,
  submitted_at TIMESTAMPTZ,
  project_approved_at TIMESTAMPTZ,
  final_confirmed_at TIMESTAMPTZ,
  last_action_by BIGINT REFERENCES public.employees(id),
  last_action_at TIMESTAMPTZ,
  reject_reason TEXT,
  needs_reapproval_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.timesheet_project_reviews
  DROP CONSTRAINT IF EXISTS chk_timesheet_project_reviews_status;
ALTER TABLE public.timesheet_project_reviews
  ADD CONSTRAINT chk_timesheet_project_reviews_status
  CHECK (status IN (
    'pending_project_review',
    'project_approved',
    'needs_revision',
    'needs_reapproval',
    'cancelled',
    'final_confirmed'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS uq_timesheet_project_review_round
  ON public.timesheet_project_reviews(timesheet_id, project_id, round_no);

CREATE INDEX IF NOT EXISTS idx_timesheet_project_reviews_assignee
  ON public.timesheet_project_reviews(project_owner_id_snapshot, status);

CREATE INDEX IF NOT EXISTS idx_timesheet_project_reviews_submitter
  ON public.timesheet_project_reviews(submitter_user_id, timesheet_id);

CREATE INDEX IF NOT EXISTS idx_timesheet_project_reviews_project
  ON public.timesheet_project_reviews(project_id, status);

ALTER TABLE public.workflow_tasks
  ADD COLUMN IF NOT EXISTS route_source TEXT,
  ADD COLUMN IF NOT EXISTS review_id BIGINT REFERENCES public.timesheet_project_reviews(id);

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_review_id
  ON public.workflow_tasks(review_id);

CREATE OR REPLACE FUNCTION public.psa_touch_timesheet_project_reviews()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_timesheet_project_reviews ON public.timesheet_project_reviews;
CREATE TRIGGER trg_touch_timesheet_project_reviews
BEFORE UPDATE ON public.timesheet_project_reviews
FOR EACH ROW
EXECUTE FUNCTION public.psa_touch_timesheet_project_reviews();

ALTER TABLE public.timesheet_project_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own visible timesheet project reviews" ON public.timesheet_project_reviews;
CREATE POLICY "Read own visible timesheet project reviews"
  ON public.timesheet_project_reviews FOR SELECT TO authenticated
  USING (
    submitter_user_id = public.current_employee_id()
    OR project_owner_id_snapshot = public.current_employee_id()
    OR department_manager_id_snapshot = public.current_employee_id()
    OR public.current_user_has_role('admin')
  );

DROP POLICY IF EXISTS "Admin manage timesheet project reviews" ON public.timesheet_project_reviews;
CREATE POLICY "Admin manage timesheet project reviews"
  ON public.timesheet_project_reviews FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

GRANT SELECT, INSERT, UPDATE ON public.timesheet_project_reviews TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.timesheet_project_reviews_id_seq TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
