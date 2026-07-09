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

6. Stable work surfaces
   A page should not jump, blank out, or change control positions during refresh. Prefer skeletons on first load and stale-while-refresh indicators after data has already rendered.

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
| `brand-accent` | `#f44214` | Xinpin logo red; sparse emphasis, brand moments, important non-status calls |
| `brand-accent-soft` | `#fff1ed` | Soft accent background for subtle emphasis |
| `brand-accent-text` | `#9f2a10` | Readable text/icon color on `brand-accent-soft` |
| `row-hover` | `#f6f8fb` | Table/list hover |
| `row-selected` | `#eef4ff` | Selected table/list rows |

Status tokens:

| Token | Value | Use |
| --- | --- | --- |
| `success` | `#16a34a` | Approved, completed, healthy |
| `warning` | `#d97706` | Pending attention, partial warning |
| `danger` | `#dc2626` | Rejected, destructive, invalid |
| `info` | `#2f80ed` | Progress, neutral link-like signal |

Brand accent guidance:

- `brand-accent` is the Xinpin logo red and is not a replacement for `danger`.
- Use it sparingly for brand emphasis, onboarding highlights, or a single high-priority non-destructive callout.
- Do not use `brand-accent` for approval rejection, validation errors, destructive actions, or overdue warnings; those remain status colors.
- On soft accent surfaces, pair `brand-accent-soft` with `brand-accent-text`. Do not put low-contrast gray text on the soft red background.

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

Avoid `12px+` card radii unless the component is a large modal or a configuration shell with a clear reason. Page panels, repeated cards, tables, and form groups default to `8px`.

### Z-index

Use semantic layers instead of arbitrary large values:

| Layer | Token | Use |
| --- | --- | --- |
| Dropdown | `--z-dropdown` | Select lists and compact dropdowns |
| Sticky | `--z-sticky` | Sticky table headers and columns |
| Popover | `--z-popover` | Anchored menus that must float over page content |
| Modal | `--z-modal` | Dialogs, sheets, destructive confirmations |
| Toast | `--z-toast` | Global notifications |
| Tooltip | `--z-tooltip` | Tooltips and temporary hover labels |

Do not introduce `z-[999]`, `z-[1000]`, or similar one-off layers. If a new layer is needed, add it here and in `frontend/src/index.css`.

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
- Full pills are reserved for segmented controls, filter chips, badges, and compact toolbar actions. Standard form and dialog buttons keep `radius-md`/`radius-lg`.

### Pills and Segmented Controls

- `SegmentedPill` is the default for peer navigation with 2-5 choices, such as 总览/分析, 年/月/季/周, and approval tabs.
- The active indicator uses `primary`; inactive items use `muted-foreground` on a tokenized surface.
- Labels must not wrap inside the pill. Shorten the label before allowing a two-line segmented item.
- Use one segmented control per decision point. Do not stack segmented controls with unrelated buttons unless spacing clearly separates them.

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
- Avoid putting UI cards inside larger decorative cards. Configuration pages may use subtle field groups, but those groups should read as sections, not repeated floating cards.

### Department Color

- Department color is an identification aid, not a status color.
- Light mode: pastel background plus near-black text.
- Dark mode: transparent tinted background plus near-white text from the same hue family.
- Never use generic gray text on colored department chips; it washes out and fails scanning.
- If a department has no color token, render plain text without a pill.

### Loading, Empty, and Error States

- First load uses skeletons shaped like the real content.
- Skeleton text, pills, and badges must keep visible contrast between placeholder fill and foreground. Never render temporary pill text in the same color family and lightness as the pill background.
- Loading pills should either omit text entirely and use a shimmer/block placeholder, or use muted text on a clearly lighter/darker neutral surface. Target at least WCAG AA contrast for any readable loading label.
- When a skeleton copies a final colored chip shape, desaturate the placeholder surface and keep the temporary label neutral; do not reuse the final chip foreground/background pair until real data is loaded.
- Refresh after data exists keeps the existing content and adds a low-emphasis `更新中` indicator near the title.
- Empty states should name what is empty and, where useful, the next action.
- Error states must preserve page structure when possible and explain whether cached data is still visible.

### Dialogs, Sheets, Popovers

- Dialogs and sheets should prioritize content height and scroll behavior.
- Popovers should have a clear border/ring and compact padding.
- Overlays should be light and should not visually disconnect the user from the workflow.
- Anchored menus that cross sidebar/table/content boundaries must render through a portal or fixed-position layer.

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
- Respect `prefers-reduced-motion`; loading skeletons and logo animation should degrade to static states.

## Configuration Pages

- Use the same configuration page pattern: left navigation/tree/list, right detail panel, grouped field sections, and a clear bottom/right save area.
- Group names should use Chinese business language. Raw keys may appear only in collapsed `高级信息`.
- Validation status belongs in the same toolbar row as save/restore actions.
- Selected navigation items should use the normal selected-row language, not a dark block that competes with primary actions.

## Charts

- Chart axes, grids, fills, and tooltips must use theme tokens and be checked in both light and dark mode.
- Long labels use fixed label columns and ellipsis; never allow labels to overlap bars or axes.
- Use donut charts only for structure/composition, and bars/lines for comparison or trend.

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
