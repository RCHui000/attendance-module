DO $$
DECLARE
  v_duplicate_count integer;
BEGIN
  SELECT count(*) INTO v_duplicate_count
  FROM (
    SELECT timesheet_id, project_id
    FROM public.approval_project_review_records_view
    GROUP BY timesheet_id, project_id
    HAVING count(*) > 1
  ) duplicates;

  IF v_duplicate_count <> 0 THEN
    RAISE EXCEPTION 'approval_project_review_records_view has % duplicate timesheet/project groups', v_duplicate_count;
  END IF;
END $$;
