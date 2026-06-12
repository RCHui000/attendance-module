-- V0.15: keep restored production sequences ahead of existing rows.

BEGIN;

SELECT setval('public.timesheets_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.timesheets), false);
SELECT setval('public.timesheet_entries_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.timesheet_entries), false);
SELECT setval('public.approval_instances_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.approval_instances), false);
SELECT setval('public.approval_rounds_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.approval_rounds), false);
SELECT setval('public.approval_nodes_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.approval_nodes), false);
SELECT setval('public.approval_node_assignees_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.approval_node_assignees), false);
SELECT setval('public.approval_events_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.approval_events), false);
SELECT setval('public.business_documents_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.business_documents), false);

COMMIT;
