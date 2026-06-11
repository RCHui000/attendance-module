# UI Primitives

This directory contains local shadcn-style UI primitives used by feature modules. They are thin wrappers around Base UI / native elements plus Tailwind classes.

## Components

| File | Purpose |
| --- | --- |
| `button.tsx` | Button variants and sizes. |
| `badge.tsx` | Status and category labels. |
| `input.tsx`, `textarea.tsx`, `label.tsx` | Form primitives. |
| `select.tsx` | Select/dropdown controls. |
| `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx` | Modal and drawer surfaces. |
| `table.tsx` | Table primitives. |
| `tabs.tsx`, `toggle.tsx`, `toggle-group.tsx` | Selection controls. |
| `tooltip.tsx` | Hover descriptions. |
| `progress.tsx`, `separator.tsx`, `card.tsx` | Display/layout primitives. |
| `sonner.tsx` | Toast provider styling. |

## Usage Rules

- Feature modules should import primitives from `@/components/ui/*`.
- Keep business logic out of UI primitives.
- Prefer adding feature-specific composition in the module directory rather than expanding primitive props for one-off cases.
- Keep visual tokens aligned with `src/index.css` and existing variants.
