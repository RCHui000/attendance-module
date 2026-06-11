# Utils Module

Small pure helpers shared across pages.

## Files

| File | Purpose |
| --- | --- |
| `dates.ts` | Week start, week day list, ISO date arithmetic. |
| `validation.ts` | Timesheet day/week totals, warnings, blocking validation, workday formatting. |

## Timesheet Validation Constants

- `MAX_DAILY_PERCENT = 100`
- `MAX_REGULAR_WEEK_WORKDAYS = 7`

Validation rules:

- Day total across project rows must not exceed `100%`.
- Weekly regular workdays must not exceed `7.0`.
- Workday display uses two decimals only when needed, except project row/block totals which are fixed to two decimals in their components.
