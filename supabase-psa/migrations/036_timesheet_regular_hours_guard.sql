-- V0.14.3: Guard regular timesheet hours against precision-hidden over-allocation.

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

  IF v_week_total > 6.0001 THEN
    RAISE EXCEPTION 'Regular timesheet hours per week cannot exceed 6.0';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_timesheet_regular_hours ON public.timesheet_entries;
CREATE TRIGGER trg_validate_timesheet_regular_hours
AFTER INSERT OR UPDATE OF timesheet_id, work_date, hours
ON public.timesheet_entries
FOR EACH ROW
EXECUTE FUNCTION public.psa_validate_timesheet_regular_hours();

NOTIFY pgrst, 'reload schema';

COMMIT;
