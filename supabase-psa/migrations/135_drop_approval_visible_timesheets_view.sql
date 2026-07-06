-- V0.18.37: remove non-actionable in-progress timesheet visibility.

BEGIN;

DROP VIEW IF EXISTS public.approval_visible_timesheets_view;

NOTIFY pgrst, 'reload schema';

COMMIT;
