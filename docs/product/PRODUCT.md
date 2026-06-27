# Product

## Register

product

## Users

PSA is used by project managers, department owners, approvers, finance/operations staff, and administrators in an internal enterprise workflow. They work mostly on desktop, often scanning dense tables, checking approval status, editing project and employee configuration, and drilling from summary numbers into source timesheets.

## Product Purpose

PSA combines project cost tracking, weekly timesheet reporting, project-block approval, and organization/permission configuration. Success means users can quickly understand current workload and cost signals, submit or approve timesheets with confidence, and maintain business configuration without needing engineering help.

## Brand Personality

Calm, precise, workmanlike. The UI should feel like a reliable operations workbench: quiet enough for repeated use, sharp enough for audit-sensitive flows, and explicit when approvals or configuration changes carry consequences.

## Anti-references

Avoid marketing-style SaaS dashboards, decorative gradients, oversized hero layouts, glassmorphism, playful illustrations in work pages, and color-heavy cards that compete with business data. Avoid exposing raw database fields as primary user-facing language when a Chinese business term exists.

## Design Principles

1. Data first: tables, approval records, weekly entries, and configuration state must remain compact and scannable.
2. One component language: buttons, tabs, pills, menus, cards, and empty states should behave and look consistent across pages.
3. Configuration explains itself: settings pages should group fields by business meaning and show safe defaults, read-only state, validation, and save scope clearly.
4. Color is functional: color identifies status, department, selection, or chart series; it should never reduce readability.
5. Preserve flow: loading, refresh, and navigation should keep context visible and avoid full-page blank states.

## Accessibility & Inclusion

Target WCAG AA contrast for normal text. Support keyboard focus on all interactive controls, reduced-motion preferences for animations, and non-color text labels for status. Chinese names, department names, project names, and long approval labels must truncate or wrap deliberately without overlapping nearby data.
