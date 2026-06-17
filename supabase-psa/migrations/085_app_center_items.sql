-- V0.16.10: configurable application center.

CREATE TABLE IF NOT EXISTS public.app_center_items (
  id BIGSERIAL PRIMARY KEY,
  app_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  icon_key TEXT NOT NULL DEFAULT 'app',
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_center_items_active_order
  ON public.app_center_items(is_active, sort_order, name);

CREATE OR REPLACE FUNCTION public.touch_app_center_items_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_app_center_items_updated_at ON public.app_center_items;
CREATE TRIGGER trg_touch_app_center_items_updated_at
BEFORE UPDATE ON public.app_center_items
FOR EACH ROW
EXECUTE FUNCTION public.touch_app_center_items_updated_at();

ALTER TABLE public.app_center_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "RBAC read app center items" ON public.app_center_items;
CREATE POLICY "RBAC read app center items" ON public.app_center_items
  FOR SELECT TO authenticated
  USING (
    is_active
    AND public.current_user_can_access_resource('apps', 'read')
  );

DROP POLICY IF EXISTS "RBAC write app center items" ON public.app_center_items;
CREATE POLICY "RBAC write app center items" ON public.app_center_items
  FOR ALL TO authenticated
  USING (public.current_user_can_access_resource('apps', 'write'))
  WITH CHECK (public.current_user_can_access_resource('apps', 'write'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_center_items TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.app_center_items_id_seq TO authenticated;
GRANT ALL ON public.app_center_items TO service_role, postgres;
GRANT ALL ON SEQUENCE public.app_center_items_id_seq TO service_role, postgres;

INSERT INTO public.app_center_items (
  app_key,
  name,
  description,
  url,
  icon_key,
  tags,
  is_internal,
  is_active,
  sort_order
)
VALUES (
  'tender-aggregator',
  '招标信息聚合',
  '汇总招标信息与项目机会的内部入口。',
  'http://192.168.2.100:9978',
  'radio',
  ARRAY['内网']::TEXT[],
  TRUE,
  TRUE,
  10
)
ON CONFLICT (app_key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    url = EXCLUDED.url,
    icon_key = EXCLUDED.icon_key,
    tags = EXCLUDED.tags,
    is_internal = EXCLUDED.is_internal,
    is_active = TRUE,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'app_center_items'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.app_center_items;
    END IF;
  END IF;
END $$;

ALTER TABLE public.app_center_items REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
