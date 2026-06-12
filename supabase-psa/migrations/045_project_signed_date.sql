-- V0.15: Project contract signed date for project catalog sorting.

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS signed_date date;

CREATE INDEX IF NOT EXISTS idx_projects_signed_date
  ON public.projects(signed_date DESC NULLS LAST, code ASC)
  WHERE status <> 'deleted';

NOTIFY pgrst, 'reload schema';

COMMIT;
