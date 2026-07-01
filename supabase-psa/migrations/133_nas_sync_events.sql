BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.nas_sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  employee_name text NOT NULL,
  event_type text NOT NULL DEFAULT 'employee.created',
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  claim_token_hash text,
  claim_expires_at timestamptz,
  nas_username text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT nas_sync_events_type_check CHECK (event_type = 'employee.created'),
  CONSTRAINT nas_sync_events_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT nas_sync_events_attempts_check CHECK (attempts >= 0 AND attempts <= 5),
  CONSTRAINT nas_sync_events_claim_hash_check CHECK (claim_token_hash IS NULL OR claim_token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT nas_sync_events_employee_event_key UNIQUE (employee_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_nas_sync_events_pending
  ON public.nas_sync_events(created_at, id)
  WHERE status = 'pending' AND attempts < 5;

CREATE OR REPLACE FUNCTION public.psa_touch_nas_sync_events_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_nas_sync_events ON public.nas_sync_events;
CREATE TRIGGER trg_touch_nas_sync_events
BEFORE UPDATE ON public.nas_sync_events
FOR EACH ROW
EXECUTE FUNCTION public.psa_touch_nas_sync_events_updated_at();

CREATE OR REPLACE FUNCTION public.psa_enqueue_nas_sync_employee_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active IS TRUE AND btrim(coalesce(NEW.name, '')) <> '' THEN
    INSERT INTO public.nas_sync_events(employee_id, employee_name, event_type, status)
    VALUES (NEW.id, btrim(NEW.name), 'employee.created', 'pending')
    ON CONFLICT ON CONSTRAINT nas_sync_events_employee_event_key DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_nas_sync_employee_created ON public.employees;
CREATE TRIGGER trg_enqueue_nas_sync_employee_created
AFTER INSERT ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.psa_enqueue_nas_sync_employee_created();

CREATE OR REPLACE FUNCTION public.psa_nas_sync_event_json(p_event public.nas_sync_events)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', p_event.id::text,
    'employee_id', p_event.employee_id,
    'employee_name', p_event.employee_name,
    'event_type', p_event.event_type,
    'status', p_event.status,
    'attempts', p_event.attempts,
    'created_at', p_event.created_at
  );
$$;

CREATE OR REPLACE FUNCTION public.psa_nas_sync_claim_event(
  p_event_id uuid,
  p_claim_token_hash text,
  p_claim_ttl_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.nas_sync_events;
  v_ttl_seconds integer := greatest(60, least(coalesce(p_claim_ttl_seconds, 300), 3600));
BEGIN
  IF p_claim_token_hash IS NULL OR p_claim_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'conflict', 'message', 'Invalid claim token');
  END IF;

  UPDATE public.nas_sync_events
  SET
    status = 'processing',
    attempts = attempts + 1,
    claim_token_hash = p_claim_token_hash,
    claim_expires_at = now() + make_interval(secs => v_ttl_seconds),
    last_error = NULL,
    completed_at = NULL
  WHERE id = p_event_id
    AND status = 'pending'
    AND attempts < 5
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'conflict', 'message', 'Event is not claimable');
  END IF;

  RETURN jsonb_build_object('ok', true, 'event', public.psa_nas_sync_event_json(v_event));
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_nas_sync_complete_event(
  p_event_id uuid,
  p_claim_token_hash text,
  p_nas_username text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.nas_sync_events;
BEGIN
  UPDATE public.nas_sync_events
  SET
    status = 'completed',
    nas_username = nullif(btrim(coalesce(p_nas_username, '')), ''),
    completed_at = now(),
    claim_token_hash = NULL,
    claim_expires_at = NULL,
    last_error = NULL
  WHERE id = p_event_id
    AND status = 'processing'
    AND claim_token_hash = p_claim_token_hash
    AND claim_expires_at > now()
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'conflict', 'message', 'Claim is invalid or expired');
  END IF;

  RETURN jsonb_build_object('ok', true, 'event', public.psa_nas_sync_event_json(v_event));
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_nas_sync_fail_event(
  p_event_id uuid,
  p_claim_token_hash text,
  p_error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.nas_sync_events;
BEGIN
  UPDATE public.nas_sync_events
  SET
    status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
    last_error = left(nullif(btrim(coalesce(p_error, '')), ''), 1000),
    claim_token_hash = NULL,
    claim_expires_at = NULL
  WHERE id = p_event_id
    AND status = 'processing'
    AND claim_token_hash = p_claim_token_hash
    AND claim_expires_at > now()
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'conflict', 'message', 'Claim is invalid or expired');
  END IF;

  RETURN jsonb_build_object('ok', true, 'event', public.psa_nas_sync_event_json(v_event));
END;
$$;

ALTER TABLE public.nas_sync_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "NAS sync realtime select" ON public.nas_sync_events;
CREATE POLICY "NAS sync realtime select" ON public.nas_sync_events
FOR SELECT TO authenticated
USING (
  coalesce(
    ((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'nas_sync')::boolean),
    false
  ) IS TRUE
);

DROP POLICY IF EXISTS "Service role manages NAS sync events" ON public.nas_sync_events;
CREATE POLICY "Service role manages NAS sync events" ON public.nas_sync_events
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

REVOKE ALL ON public.nas_sync_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nas_sync_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nas_sync_events TO service_role;

REVOKE ALL ON FUNCTION public.psa_touch_nas_sync_events_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_enqueue_nas_sync_employee_created() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_nas_sync_event_json(public.nas_sync_events) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_nas_sync_claim_event(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_nas_sync_complete_event(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_nas_sync_fail_event(uuid, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.psa_nas_sync_claim_event(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.psa_nas_sync_complete_event(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.psa_nas_sync_fail_event(uuid, text, text) TO service_role;

ALTER TABLE public.nas_sync_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'nas_sync_events'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.nas_sync_events;
    END IF;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
