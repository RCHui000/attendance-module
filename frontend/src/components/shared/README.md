# Shared Components

This directory is reserved for reusable composed components that are not generic enough for `components/ui` and not owned by a single feature module.

## Current Rule Of Thumb

- Put primitive controls in `components/ui`.
- Put feature-owned components in `components/timesheet`, `components/review`, `components/report`, `components/employees`, or `components/dashboard`.
- Use `components/shared` only when at least two feature modules need the same composed component.

At the moment this directory is intentionally light; avoid turning it into a catch-all.
