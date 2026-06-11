-- V0.14.2: Project service type and contract approval role assignments.

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS business_type text;

UPDATE public.projects
SET business_type = CASE
  WHEN upper(code) LIKE 'PMCC%' THEN 'PMCC'
  WHEN upper(code) LIKE 'PM%' THEN 'PM'
  WHEN upper(code) LIKE 'CC%' THEN 'CC'
  ELSE business_type
END
WHERE business_type IS NULL;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS chk_projects_business_type;
ALTER TABLE public.projects
  ADD CONSTRAINT chk_projects_business_type
  CHECK (business_type IS NULL OR business_type IN ('PM', 'CC', 'PMCC'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_roles_active_project_role
  ON public.project_roles(project_id, role_key)
  WHERE status = 'active';

NOTIFY pgrst, 'reload schema';

COMMIT;
