-- Durable cloud-to-NAS employee sync event queue.
-- NAS consumes this through the app-layer /api/nas-sync/* contract; no NAS
-- inbound port or Supabase service_role credential is exposed to the NAS side.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nas_sync') THEN
    CREATE ROLE nas_sync NOLOGIN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    GRANT nas_sync TO authenticator;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.nas_sync_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  employee_name TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'employee.created',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  locked_at TIMESTAMPTZ,
  claim_token TEXT,
  nas_username TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS nas_sync_events_employee_created_once
  ON public.nas_sync_events (employee_id, event_type);

CREATE INDEX IF NOT EXISTS nas_sync_events_pending_idx
  ON public.nas_sync_events (created_at, id)
  WHERE status = 'pending' AND attempts < 5;

CREATE OR REPLACE FUNCTION public.psa_touch_nas_sync_events_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_nas_sync_events_updated_at ON public.nas_sync_events;
CREATE TRIGGER trg_touch_nas_sync_events_updated_at
  BEFORE UPDATE ON public.nas_sync_events
  FOR EACH ROW
  EXECUTE FUNCTION public.psa_touch_nas_sync_events_updated_at();

CREATE OR REPLACE FUNCTION public.psa_enqueue_nas_sync_employee_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(NEW.is_active, false) AND NULLIF(btrim(NEW.name), '') IS NOT NULL THEN
    INSERT INTO public.nas_sync_events (employee_id, employee_name, event_type)
    VALUES (NEW.id, btrim(NEW.name), 'employee.created')
    ON CONFLICT (employee_id, event_type) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_nas_sync_employee_created ON public.employees;
CREATE TRIGGER trg_enqueue_nas_sync_employee_created
  AFTER INSERT ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.psa_enqueue_nas_sync_employee_created();

CREATE OR REPLACE FUNCTION public.psa_nas_sync_claim_event(
  p_event_id UUID,
  p_claim_token TEXT
)
RETURNS TABLE (
  id UUID,
  employee_id BIGINT,
  employee_name TEXT,
  event_type TEXT,
  status TEXT,
  attempts INTEGER,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH claimed AS (
    UPDATE public.nas_sync_events e
    SET
      status = 'processing',
      attempts = e.attempts + 1,
      last_error = NULL,
      locked_at = now(),
      claim_token = p_claim_token
    WHERE e.id = p_event_id
      AND e.status = 'pending'
      AND e.attempts < 5
    RETURNING e.id, e.employee_id, e.employee_name, e.event_type, e.status, e.attempts, e.created_at
  )
  SELECT claimed.id, claimed.employee_id, claimed.employee_name, claimed.event_type,
    claimed.status, claimed.attempts, claimed.created_at
  FROM claimed;
$$;

CREATE OR REPLACE FUNCTION public.psa_nas_sync_complete_event(
  p_event_id UUID,
  p_claim_token TEXT,
  p_nas_username TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH completed AS (
    UPDATE public.nas_sync_events e
    SET
      status = 'completed',
      nas_username = NULLIF(btrim(p_nas_username), ''),
      processed_at = now(),
      locked_at = NULL,
      claim_token = NULL,
      last_error = NULL
    WHERE e.id = p_event_id
      AND e.status = 'processing'
      AND e.claim_token = p_claim_token
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM completed);
$$;

CREATE OR REPLACE FUNCTION public.psa_nas_sync_fail_event(
  p_event_id UUID,
  p_claim_token TEXT,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH failed AS (
    UPDATE public.nas_sync_events e
    SET
      status = CASE WHEN e.attempts >= 5 THEN 'failed' ELSE 'pending' END,
      last_error = left(COALESCE(NULLIF(btrim(p_error), ''), 'NAS sync failed'), 1000),
      locked_at = NULL,
      claim_token = NULL
    WHERE e.id = p_event_id
      AND e.status = 'processing'
      AND e.claim_token = p_claim_token
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM failed);
$$;

ALTER TABLE public.nas_sync_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nas_sync_read_events ON public.nas_sync_events;
CREATE POLICY nas_sync_read_events
  ON public.nas_sync_events
  FOR SELECT
  TO nas_sync
  USING (true);

REVOKE ALL ON public.nas_sync_events FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO nas_sync;
GRANT SELECT (id, employee_id, employee_name, event_type, status, attempts, created_at, updated_at)
  ON public.nas_sync_events TO nas_sync;
GRANT SELECT ON public.nas_sync_events TO service_role;

REVOKE ALL ON FUNCTION public.psa_touch_nas_sync_events_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.psa_enqueue_nas_sync_employee_created() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.psa_nas_sync_claim_event(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_nas_sync_complete_event(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_nas_sync_fail_event(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_nas_sync_claim_event(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.psa_nas_sync_complete_event(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.psa_nas_sync_fail_event(UUID, TEXT, TEXT) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_publication_rel pr
      JOIN pg_publication p ON p.oid = pr.prpubid
      WHERE p.pubname = 'supabase_realtime'
        AND pr.prrelid = 'public.nas_sync_events'::regclass
    )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.nas_sync_events;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
