-- V0.17.3: keep timesheet ids database-owned and ahead of production rows.

BEGIN;

ALTER SEQUENCE IF EXISTS public.timesheets_id_seq OWNED BY public.timesheets.id;
ALTER TABLE public.timesheets
  ALTER COLUMN id SET DEFAULT nextval('public.timesheets_id_seq'::regclass);

SELECT setval(
  'public.timesheets_id_seq',
  (SELECT COALESCE(MAX(id), 0) + 1 FROM public.timesheets),
  false
);

COMMIT;
