-- V0.17: approval audit visibility scopes.
--
-- This keeps read-only audit visibility separate from approval routing. Users in
-- this table can see reviewed timesheets for the configured organization tree,
-- but they are not added to approval nodes and do not receive pending tasks.

BEGIN;

CREATE TABLE IF NOT EXISTS public.approval_audit_scopes (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  org_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL DEFAULT 'reviewed_timesheet',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT approval_audit_scopes_scope_type_chk
    CHECK (scope_type IN ('reviewed_timesheet'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_audit_scopes_active
  ON public.approval_audit_scopes(employee_id, org_id, scope_type)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_approval_audit_scopes_employee
  ON public.approval_audit_scopes(employee_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_approval_audit_scopes_org
  ON public.approval_audit_scopes(org_id)
  WHERE is_active = TRUE;

CREATE OR REPLACE FUNCTION public.psa_touch_approval_audit_scopes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_approval_audit_scopes ON public.approval_audit_scopes;
CREATE TRIGGER trg_touch_approval_audit_scopes
BEFORE UPDATE ON public.approval_audit_scopes
FOR EACH ROW
EXECUTE FUNCTION public.psa_touch_approval_audit_scopes();

ALTER TABLE public.approval_audit_scopes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own or system approval audit scopes" ON public.approval_audit_scopes;
CREATE POLICY "Read own or system approval audit scopes"
  ON public.approval_audit_scopes FOR SELECT TO authenticated
  USING (
    employee_id = public.current_employee_id()
    OR public.current_user_can_access_resource('system_management', 'read')
  );

DROP POLICY IF EXISTS "System write approval audit scopes" ON public.approval_audit_scopes;
CREATE POLICY "System write approval audit scopes"
  ON public.approval_audit_scopes FOR ALL TO authenticated
  USING (public.current_user_can_access_resource('system_management', 'write'))
  WITH CHECK (public.current_user_can_access_resource('system_management', 'write'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_audit_scopes TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.approval_audit_scopes_id_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_approval_audit_org_ids()
RETURNS BIGINT[]
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE roots AS (
    SELECT aas.org_id
    FROM public.approval_audit_scopes aas
    JOIN public.employees e ON e.id = aas.employee_id
    WHERE e.auth_user_id = auth.uid()
      AND aas.scope_type = 'reviewed_timesheet'
      AND aas.is_active = TRUE
  ),
  tree AS (
    SELECT o.id
    FROM public.organizations o
    JOIN roots r ON r.org_id = o.id
    WHERE COALESCE(o.status, 'active') = 'active'
    UNION
    SELECT child.id
    FROM public.organizations child
    JOIN tree parent ON parent.id = child.parent_id
    WHERE COALESCE(child.status, 'active') = 'active'
  )
  SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::BIGINT[])
  FROM tree;
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_audit_employee(p_employee_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_can_access_resource('review', 'read')
    AND EXISTS (
      SELECT 1
      FROM public.employee_profiles ep
      WHERE ep.employee_id = p_employee_id
        AND ep.org_id = ANY(public.current_user_approval_audit_org_ids())
    );
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_audit_reviewed_timesheet(p_timesheet_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
      SELECT 1
      FROM public.timesheets t
      WHERE t.id = p_timesheet_id
        AND public.current_user_can_audit_employee(t.user_id)
    );
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    EXECUTE 'ALTER FUNCTION public.current_user_approval_audit_org_ids() OWNER TO postgres';
    EXECUTE 'ALTER FUNCTION public.current_user_can_audit_employee(BIGINT) OWNER TO postgres';
    EXECUTE 'ALTER FUNCTION public.current_user_can_audit_reviewed_timesheet(BIGINT) OWNER TO postgres';
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'psa_admin') THEN
    EXECUTE 'ALTER FUNCTION public.current_user_approval_audit_org_ids() OWNER TO psa_admin';
    EXECUTE 'ALTER FUNCTION public.current_user_can_audit_employee(BIGINT) OWNER TO psa_admin';
    EXECUTE 'ALTER FUNCTION public.current_user_can_audit_reviewed_timesheet(BIGINT) OWNER TO psa_admin';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.current_user_approval_audit_org_ids() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_can_audit_employee(BIGINT) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_can_audit_reviewed_timesheet(BIGINT) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_touch_approval_audit_scopes() FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.current_user_approval_audit_org_ids() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_audit_employee(BIGINT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_audit_reviewed_timesheet(BIGINT) TO authenticated, anon;

DROP POLICY IF EXISTS "Approval auditor read scoped timesheets" ON public.timesheets;
CREATE POLICY "Approval auditor read scoped timesheets" ON public.timesheets
  FOR SELECT TO authenticated
  USING (public.current_user_can_audit_employee(user_id));

CREATE OR REPLACE VIEW public.approval_reviewed_timesheets_view AS
SELECT
  n.id,
  n.id AS task_id,
  COALESCE(i.target_type, d.document_type) AS target_type,
  COALESCE(i.target_id, d.business_id) AS target_id,
  COALESCE(i.target_id, d.business_id) AS timesheet_id,
  n.scope_type,
  n.scope_id,
  n.assignee_role,
  a.assignee_user_id,
  CASE
    WHEN a.action IN ('approve', 'reject') THEN a.action
    WHEN a.status = 'approved' THEN 'approve'
    WHEN a.status = 'rejected' THEN 'reject'
    ELSE a.action
  END AS result_action,
  a.comment,
  a.acted_at AS completed_at
FROM public.approval_node_assignees a
JOIN public.approval_nodes n ON n.id = a.node_id
JOIN public.approval_instances i ON i.id = n.instance_id
LEFT JOIN public.business_documents d ON d.id = i.document_id
WHERE COALESCE(i.target_type, d.document_type) = 'timesheet'
  AND a.status IN ('approved', 'rejected', 'delegated', 'skipped')
  AND (
    public.current_user_has_role('admin')
    OR a.assignee_user_id = public.current_employee_id()
    OR public.current_user_can_audit_reviewed_timesheet(COALESCE(i.target_id, d.business_id))
  );

GRANT SELECT ON public.approval_reviewed_timesheets_view TO authenticated;

INSERT INTO public.approval_audit_scopes(employee_id, org_id, scope_type, is_active)
SELECT e.id, o.id, 'reviewed_timesheet', TRUE
FROM public.employees e
JOIN public.organizations o ON o.org_code = 'TEO'
WHERE e.name = U&'\5E38\96EA\677E'
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
