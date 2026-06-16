-- V0.15.3: Normalize General Engineering Office organization tree.
--
-- Keep existing org codes because employee numbering, permissions, and approval
-- routes already reference them. This migration only corrects display names and
-- parent-child relationships:
--   TEO         General Engineering Office
--   PM_DESIGN  Design Management, child of TEO
--   CC         Cost Consulting, child of TEO

BEGIN;

DO $$
DECLARE
  v_teo bigint;
  v_cc bigint;
  v_design bigint;
BEGIN
  SELECT id
  INTO v_teo
  FROM public.organizations
  WHERE org_code = 'TEO'
     OR (org_name = U&'\603B\5DE5\529E' AND org_code <> 'CC')
  ORDER BY CASE WHEN org_code = 'TEO' THEN 0 ELSE 1 END, id
  LIMIT 1;

  IF v_teo IS NULL THEN
    SELECT COALESCE(MAX(id), 0) + 1 INTO v_teo FROM public.organizations;
    INSERT INTO public.organizations(id, org_code, org_name, parent_id, org_type, status)
    VALUES (v_teo, 'TEO', U&'\603B\5DE5\529E', NULL, 'department', 'active');
  ELSE
    UPDATE public.organizations
    SET org_code = 'TEO',
        org_name = U&'\603B\5DE5\529E',
        parent_id = NULL,
        org_type = 'department',
        status = 'active'
    WHERE id = v_teo;
  END IF;

  SELECT id INTO v_cc FROM public.organizations WHERE org_code = 'CC' LIMIT 1;
  IF v_cc IS NULL THEN
    SELECT COALESCE(MAX(id), 0) + 1 INTO v_cc FROM public.organizations;
    INSERT INTO public.organizations(id, org_code, org_name, parent_id, org_type, status)
    VALUES (v_cc, 'CC', U&'\9020\4EF7\54A8\8BE2\90E8', v_teo, 'department', 'active');
  ELSE
    UPDATE public.organizations
    SET org_name = U&'\9020\4EF7\54A8\8BE2\90E8',
        parent_id = v_teo,
        org_type = 'department',
        status = 'active'
    WHERE id = v_cc;
  END IF;

  SELECT id INTO v_design FROM public.organizations WHERE org_code = 'PM_DESIGN' LIMIT 1;
  IF v_design IS NULL THEN
    SELECT COALESCE(MAX(id), 0) + 1 INTO v_design FROM public.organizations;
    INSERT INTO public.organizations(id, org_code, org_name, parent_id, org_type, status)
    VALUES (v_design, 'PM_DESIGN', U&'\8BBE\8BA1\7BA1\7406', v_teo, 'department', 'active');
  ELSE
    UPDATE public.organizations
    SET org_name = U&'\8BBE\8BA1\7BA1\7406',
        parent_id = v_teo,
        org_type = 'department',
        status = 'active'
    WHERE id = v_design;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
