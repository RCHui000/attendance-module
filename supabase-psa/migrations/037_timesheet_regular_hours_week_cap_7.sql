-- V0.14.4: Allow Sunday as a regular workday; weekly regular cap is 7.0.

BEGIN;

CREATE OR REPLACE FUNCTION public.psa_validate_timesheet_regular_hours()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_day_total numeric;
  v_week_total numeric;
BEGIN
  IF NEW.hours < 0 THEN
    RAISE EXCEPTION 'Regular timesheet hours cannot be negative';
  END IF;

  IF NEW.hours > 1.0001 THEN
    RAISE EXCEPTION 'Regular timesheet hours per project day cannot exceed 1.0';
  END IF;

  SELECT COALESCE(SUM(hours), 0)
    INTO v_day_total
  FROM public.timesheet_entries
  WHERE timesheet_id = NEW.timesheet_id
    AND work_date = NEW.work_date;

  IF v_day_total > 1.0001 THEN
    RAISE EXCEPTION 'Regular timesheet hours per day cannot exceed 1.0';
  END IF;

  SELECT COALESCE(SUM(hours), 0)
    INTO v_week_total
  FROM public.timesheet_entries
  WHERE timesheet_id = NEW.timesheet_id;

  IF v_week_total > 7.0001 THEN
    RAISE EXCEPTION 'Regular timesheet hours per week cannot exceed 7.0';
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
