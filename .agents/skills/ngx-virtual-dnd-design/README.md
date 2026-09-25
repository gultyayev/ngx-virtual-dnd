# ngx-virtual-dnd Design System

A minimal, professional design system for the `ngx-virtual-dnd` Angular library, its demo pages and its documentation site.

## In this repository

| What | Where |
|---|---|
| Design tokens (source of truth) | `src/styles/tokens.css` — imported by the demo (`src/styles.scss`) and the docs theme (`docs/theme/index.css`) |
| Demo app styles | `src/styles.scss`, component SCSS under `src/app/` |
| Docs site theme | `docs/theme/index.css` maps tokens onto Rspress `--rp-*` variables; `docs/theme/index.tsx` holds Layout slot overrides |
| Logo assets | `assets/` in this skill; shipped copies in `public/` (demo) and `docs/pages/public/` (docs) |

`colors_and_type.css` in this folder is the design-system export. Use it for throwaway prototypes; production code imports `src/styles/tokens.css`. When a token changes, update `src/styles/tokens.css` first, then mirror it here.

## Product Context

**ngx-virtual-dnd** is an Angular drag-and-drop library optimized for virtual scrolling. It handles thousands of list items efficiently by only rendering visible elements, using geometric hit-testing rather than DOM sibling queries — which is what makes it compatible with virtualized lists.

**Key surfaces:**
- **Docs site** (`/ngx-virtual-dnd/`) — Rspress site: guides, API reference, live examples
- **Main Demo** (`/ngx-virtual-dnd/demo/`) — Two-column drag-and-drop list demo with settings panel
- **Page Scroll Demo** (`/demo/page-scroll`) — Ionic-based mobile-style task manager with page-level scroll
- **Dynamic Height Demo** (`/demo/dynamic-height`) — Variable-height task cards with category chips
- **Examples** (`/demo/examples/*`) — Minimal single-purpose pages embedded in the docs via iframe

**Sources:**
- GitHub repo: https://github.com/gultyayev/ngx-virtual-dnd (branch: master) — tokens from `src/styles/tokens.css`, top bar from `src/app/top-bar/*`
- No Figma source provided

---

## CONTENT FUNDAMENTALS

**Tone:** Technical, precise, developer-focused. No marketing fluff. Descriptions explain what things *do*, not how *great* they are.

**Casing:** Sentence case for UI labels. `camelCase` / `PascalCase` for API names. Uppercase for settings group headers (`DRAG BEHAVIOR`, `DATA`).

**Copy style:**
- Short, imperative labels: "Regenerate", "Enable dragging", "Use drag handle"
- Code names are always in monospace: `VirtualSortableListComponent`, `moveItem()`
- Hint text is lowercase, parenthetical: "Using `VirtualSortableList` + `moveItem()`"
- Navigation links use arrow: "View Page-Level Scroll Demo →"

**Voice:** First-person avoided. Technical documentation style. No emoji.

**Numbers & units:** px values used directly in code. API docs use markdown tables.

---

## VISUAL FOUNDATIONS

### Colors
Teal accent `#0e9488` (hover `#0b7a70`). Soft tint `--accent-soft` = `color-mix(accent 11%, #fff)`, with `--accent-soft-bd` (30%) for rings and `--accent-ring` for focus. No gradients anywhere. Active drop zone: `--accent-soft` fill + inset `--accent-soft-bd` ring. Green `#22c55e` (`--live`) is reserved for the debug panel's live dot. Legacy `--color-*` names remain as aliases.

### Themes & density
Light and dark via `[data-theme="light|dark"]` on a root element (the docs site uses Rspress's `html.dark` class, mapped to the same tokens). Density via `[data-density="comfortable|compact"]` (row height 50 / 38px).

### Typography
- **UI font:** Inter. **Mono:** JetBrains Mono (debug panel, code).
- Pixel scale: 10.5 / 11 / 12 / 13 / 13.5 / 15 / 28 / 30.
- Hero title 30px / 700 / -0.025em. Panel titles 15px / 600 / -0.01em. Wordmark 15px / 700 / -0.02em. Set-labels 11px uppercase, 0.07em.

### Spacing
4px base: 4, 8, 16, 24, 32, 48px. The demo also uses 3/6/9/13/14/18/22px steps locally.

### Backgrounds
- Page `#eef1f6`; sunk `#e5eaf2` (list bodies, segmented track, code); surface `#fff`.
- No images, illustrations, textures, or patterns.

### Top bar
60px (plus the top safe-area inset in the docs), sticky, translucent `--topbar-bg` with `backdrop-filter: blur(16px) saturate(150%)` and a 1px bottom border. Brand tile 32px / 9px radius on `--accent-soft`, 15px/700 wordmark, 13px nav tabs (active = accent-soft), 36px icon button for the theme toggle (auto / light / dark).

### Docs site
Uses the same top bar treatment. Sidebar on `--field-bg` with 11px uppercase group labels and accent-soft active items (7px radius). Content on `--surface`. Code blocks are dark (`#0e131e`) in both themes. Page titles 30px / 700 / -0.025em.

### Animations
- 150ms ease for state changes; `--ease-emph` `cubic-bezier(0.3,0.7,0.4,1)` for collapse and segmented thumb.
- Drag preview: `rotate(1.5deg)`, `--shadow-lg`, 12px radius.
- Placeholder: 1.5px dashed accent border on `--accent-soft`.
- No bounce or entrance animations.

### Borders & Radius
- `1px solid --border` (`#e2e7f0`); hover/strong `--border-2` (`#ccd4e0`).
- 5px inline code · 6px tags · 9px buttons/inputs/tabs · 10px list items · 12px drag preview · 15px panels & list cards · 16px task list · 999px pills.

### Shadows
`--shadow-sm` for cards, `--shadow` for raised controls, `--shadow-lg` for drag previews. Neutral navy-tinted, never colored.

### Cards / panels
White surface, 1px `--border`, `--shadow-sm`, 15px radius. Border and shadow together.

### Iconography
Inline SVG, stroke-based, `stroke-width: 2`, `currentColor`, 16–24px.

### Hover / Press States
- Buttons: background one step darker (`--accent-hover`).
- Nav tabs / chips: active uses `--accent-soft` + `--accent-text`.

### Scrollbars
9px, `--border-2` thumb with 2px transparent inset, transparent track.

### Blur / transparency
Only the top bar.

---

## ICONOGRAPHY

Icons are **inline SVG**, stroke style, `stroke-width: 2`, no fill. Sized 16–32px. Color via `currentColor`. No icon library or CDN dependency.

Key icons in use:
- **Logo:** Viewport mark (concept 1c) — rows inside a frame, faint virtual rows outside, one row dragged across the edge. Drawn on a 24px grid in one color; faint rows use opacity 0.3 on a soft tile and 0.45 on a solid teal tile.
- **Settings:** Sun/gear (circle + spokes)
- **Chevron:** Collapse/expand indicator
- **Drag handle:** 6-dot grid (⠿ pattern as SVG circles)
- **Regenerate:** Circular arrows
- **Debug:** Up arrow (⬆)

No external icon font. No emoji. No PNG icons.

---

## FILES

| File | Description |
|---|---|
| `README.md` | This file — product context and design foundations |
| `SKILL.md` | Agent skill instructions |
| `colors_and_type.css` | Design-system export: CSS custom properties for colors, type, spacing, effects |
| `assets/logo.svg` | Viewport mark (currentColor) |
| `assets/favicon.svg` | Mark on teal tile, 32px |
| `assets/logo-lockup.svg` | Tile + wordmark lockup |

The design system's preview cards and demo UI kit live in the Claude Design project "ngx-virtual-dnd Design System"; they are not mirrored here.
