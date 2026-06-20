BEGIN;

REVOKE ALL ON FUNCTION public.psa_save_approval_template(bigint, text, text, integer, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_update_employee(jsonb) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.psa_save_approval_template(bigint, text, text, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_update_employee(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
