-- Put the employee/organization entry back into the sidebar resource group.
-- It is still the same permission key: system_management.

UPDATE public.permission_resources
SET resource_name = '员工与组织',
    resource_group = 'sidebar',
    sort_order = 60,
    updated_at = NOW()
WHERE resource_key = 'system_management';

UPDATE public.role_permissions
SET sidebar_order = 60,
    updated_at = NOW()
WHERE resource_key = 'system_management'
  AND (sidebar_order IS NULL OR sidebar_order = 0);

NOTIFY pgrst, 'reload schema';
