-- V0.13: Project + department specific project owner mapping.

BEGIN;

CREATE TABLE IF NOT EXISTS public.project_department_owners (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES public.projects(id),
  org_id BIGINT NOT NULL REFERENCES public.organizations(id),
  project_owner_id BIGINT NOT NULL REFERENCES public.employees(id),
  role_key TEXT NOT NULL DEFAULT 'project_owner',
  is_active BOOLEAN NOT NULL DEFAULT true,
  effective_from DATE DEFAULT current_date,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by BIGINT REFERENCES public.employees(id),
  updated_by BIGINT REFERENCES public.employees(id)
);

ALTER TABLE public.project_department_owners
  DROP CONSTRAINT IF EXISTS chk_project_department_owners_effective_dates;
ALTER TABLE public.project_department_owners
  ADD CONSTRAINT chk_project_department_owners_effective_dates
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_department_owner_active
  ON public.project_department_owners(project_id, org_id, role_key)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_project_department_owners_project
  ON public.project_department_owners(project_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_project_department_owners_org
  ON public.project_department_owners(org_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_project_department_owners_owner
  ON public.project_department_owners(project_owner_id)
  WHERE is_active = true;

CREATE OR REPLACE FUNCTION public.psa_touch_project_department_owners()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(NEW.updated_by, public.current_employee_id());
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, NEW.updated_by);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_project_department_owners ON public.project_department_owners;
CREATE TRIGGER trg_touch_project_department_owners
BEFORE INSERT OR UPDATE ON public.project_department_owners
FOR EACH ROW
EXECUTE FUNCTION public.psa_touch_project_department_owners();

ALTER TABLE public.project_department_owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read project department owners" ON public.project_department_owners;
CREATE POLICY "Authenticated read project department owners"
  ON public.project_department_owners FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin manage project department owners" ON public.project_department_owners;
CREATE POLICY "Admin manage project department owners"
  ON public.project_department_owners FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

DROP POLICY IF EXISTS "Department managers manage own project department owners" ON public.project_department_owners;
CREATE POLICY "Department managers manage own project department owners"
  ON public.project_department_owners FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.id = project_department_owners.org_id
        AND o.manager_user_id = public.current_employee_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.id = project_department_owners.org_id
        AND o.manager_user_id = public.current_employee_id()
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.project_department_owners TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.project_department_owners_id_seq TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
