-- Keep the application-center card on the cloud reverse-proxy endpoint.

UPDATE public.app_center_items
SET url = 'https://xpjs.asia/apps/tender/',
    is_internal = TRUE,
    is_active = TRUE,
    tags = CASE
      WHEN tags @> ARRAY['内网']::TEXT[] THEN tags
      ELSE ARRAY['内网']::TEXT[] || tags
    END,
    updated_at = NOW()
WHERE app_key = 'tender-aggregator';

NOTIFY pgrst, 'reload schema';
