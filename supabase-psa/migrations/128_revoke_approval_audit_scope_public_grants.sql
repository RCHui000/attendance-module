-- V0.18.28: harden approval audit scope helper function grants.
--
-- Migration 127 creates new helper functions. PostgreSQL grants EXECUTE on new
-- functions to PUBLIC by default, so production needs an explicit revoke to
-- satisfy the function grant assertions.

BEGIN;

REVOKE ALL ON FUNCTION public.current_user_approval_audit_org_ids() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_can_audit_employee(BIGINT) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_can_audit_reviewed_timesheet(BIGINT) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_touch_approval_audit_scopes() FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.current_user_approval_audit_org_ids() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_audit_employee(BIGINT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_audit_reviewed_timesheet(BIGINT) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
