BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS color_token text;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS chk_organizations_color_token;

ALTER TABLE public.organizations
  ADD CONSTRAINT chk_organizations_color_token
  CHECK (
    color_token IS NULL
    OR color_token IN ('slate', 'blue', 'cyan', 'teal', 'green', 'amber', 'rose')
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
