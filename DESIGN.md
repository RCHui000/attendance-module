# PSA Design System

This document defines the visual and interaction baseline for the PSA project management and attendance system. It borrows the cleanness of Vercel, the structured data-workbench feeling of Airtable, and the restrained scheduling/product UI rhythm of Cal.com, then adapts those ideas for an internal enterprise workflow product.

## Product Character

PSA is a dense operational tool, not a marketing website. The interface should feel calm, fast, legible, and precise. The first priority is scanning work items, editing data, submitting/approving flows, and understanding status without visual noise.

Use a "white workbench on soft gray" direction:

- Mostly white surfaces.
- Soft gray application background.
- Near-black primary actions.
- Thin hairline borders.
- Very low elevation.
- Clear status colors used only where status matters.
- Microsoft YaHei for all UI text.

## Core Principles

1. Data first
   Tables, lists, forms, approval records, and weekly reports must remain compact and scannable. Avoid oversized hero blocks, decorative illustrations, or marketing copy.

2. Quiet hierarchy
   Hierarchy should come from spacing, weight, border, and surface contrast before color. Color accents should be functional.

3. One action language
   Primary action is near-black filled. Secondary actions are white or transparent with hairline borders. Destructive actions are muted red unless the user is in a confirmation step.

4. Touch confirmation
   Clickable app cards, buttons, table rows, and tabs should have short hover/active feedback. Active feedback may use a 1px press, slight scale, or background/ring change.

5. No nested-card look
   Page sections should be full-width layouts or simple panels. Cards are for repeated items, modals, contained tools, and app entries.

## Design Tokens

### Color

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#ffffff` | Cards, dialogs, tables, popovers |
| `app-bg` | `#f6f7f9` | Main application background |
| `surface-soft` | `#f8fafc` | Table headers, subtle grouped areas |
| `foreground` | `#181d26` | Main text, primary UI chrome |
| `body` | `#333840` | Standard body copy when separate from foreground |
| `muted` | `#5f6672` | Secondary labels and helper text |
| `hairline` | `#dddddd` | Primary border line |
| `hairline-soft` | `#e8eaee` | Large containers and low emphasis borders |
| `primary` | `#181d26` | Main action buttons, active nav |
| `primary-hover` | `#0d1117` | Primary hover/pressed state |
| `row-hover` | `#f6f8fb` | Table/list hover |
| `row-selected` | `#eef4ff` | Selected table/list rows |

Status tokens:

| Token | Value | Use |
| --- | --- | --- |
| `success` | `#16a34a` | Approved, completed, healthy |
| `warning` | `#d97706` | Pending attention, partial warning |
| `danger` | `#dc2626` | Rejected, destructive, invalid |
| `info` | `#2f80ed` | Progress, neutral link-like signal |

### Typography

- Font family: `"Microsoft YaHei", "微软雅黑", sans-serif`.
- Body text: `14px`, line-height around `1.5`.
- Dense table text: `12px-14px`.
- Section title: `16px-20px`, medium or semibold.
- Page title: `22px-24px`, semibold.
- Letter spacing: `0`.
- Avoid display-scale type inside dashboards, cards, sidebars, and tables.

### Spacing

Use a 4px-based scale:

| Token | Value |
| --- | --- |
| `space-1` | `4px` |
| `space-2` | `8px` |
| `space-3` | `12px` |
| `space-4` | `16px` |
| `space-6` | `24px` |
| `space-8` | `32px` |
| `space-12` | `48px` |

Dense tools may use `6px` and `10px` where the existing table/form layout needs it, but the overall rhythm should still align to the 4px scale.

### Radius

| Token | Value | Use |
| --- | --- | --- |
| `radius-sm` | `5px` | Small chips and compact controls |
| `radius-md` | `6px` | Buttons, inputs, table controls |
| `radius-lg` | `8px` | Cards, panels, dialogs |
| `radius-pill` | `999px` | Pills and badges only |

Avoid `12px+` card radii unless the component is a large modal or imported design pattern with a clear reason.

### Shadow

Elevation should be subtle:

- Default panels: hairline border plus optional very soft shadow.
- Floating popovers: compact shadow with a visible border/ring.
- Avoid heavy blurred shadows on dense work surfaces.

## Components

### Buttons

- Primary: near-black background, white text, 32px default height.
- Secondary/outline: white or transparent, hairline border, muted hover fill.
- Icon buttons: square dimensions with standard icon sizes.
- Active state: 1px press or small scale is acceptable.
- Do not create text-only rounded rectangles when a standard icon action exists.

### Inputs

- Default height: 32px for dense toolbars, 36px-40px for standalone forms.
- Background: white or transparent on white panels.
- Border: hairline.
- Placeholder: muted and human-readable.
- Focus: near-black ring at low opacity.

### Tables

- Header uses `surface-soft`.
- Rows use white background, hairline separators, and subtle hover.
- Selected rows use `row-selected`.
- Sticky headers/columns should preserve the same surface color behind them.
- Numeric columns should use tabular figures where available.

### Cards

- Use cards for repeated app entries, metric tiles, contained forms, and modal-like tools.
- Keep radius at `8px`.
- Use a border/ring by default and only a light shadow.
- The whole app card should be clickable when it represents an app.

### Dialogs, Sheets, Popovers

- Dialogs and sheets should prioritize content height and scroll behavior.
- Popovers should have a clear border/ring and compact padding.
- Overlays should be light and should not visually disconnect the user from the workflow.

### Navigation

- Sidebar can stay dark because it gives PSA a stable application shell.
- Active navigation should be high contrast and obvious.
- Secondary page tabs should use segmented controls or line tabs, not large decorative cards.

## Motion

Use short, practical transitions:

- Hover: `120ms-180ms`.
- Press: immediate transform/scale feedback.
- Dialog/sheet entry: `150ms-200ms`.
- Avoid looping decorative motion on work pages.

## Accessibility

- All interactive elements need visible focus.
- Text must not overlap or overflow buttons/cards.
- Do not rely on color alone for status.
- Keep contrast high for table labels and action text.

## Agent Guidance

When modifying PSA UI:

- Start from existing tokens in `frontend/src/index.css`.
- Prefer updating shared UI components over one-off page styling.
- Keep dense work pages efficient and calm.
- Use functional color only for status, attention, or confirmation.
- Do not add marketing hero layouts, gradient blobs, decorative orbs, or nested cards.
- Test desktop and narrow viewport layouts when touching shared components.
