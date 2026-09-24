# Design System (demo + docs)

The visual language for the demo app and the docs site is the **ngx-virtual-dnd Design System** (teal accent, light/dark, no gradients). Its full guidelines live in the project skill:

- `.claude/skills/ngx-virtual-dnd-design/README.md`: colors, type, spacing, radii, shadows, top bar, docs site, iconography, logo
- `.claude/skills/ngx-virtual-dnd-design/assets/`: 1c "Viewport" logo mark, favicon, lockup

Load that skill before styling demo pages, docs pages, or the docs theme.

## Rules for this repo

1. **Tokens come from `src/styles/tokens.css`**, the single source of truth imported by the demo (`src/styles.scss`, via `@use`) and the docs theme (`docs/theme/index.css`). Never hard-code token hex values in components. Add a token there first, then mirror it in the skill's `colors_and_type.css`.
2. **Themes:** the demo sets `data-theme` / `data-scheme` / `data-density` on `<html>` (`ThemeService`). Rspress toggles `html.dark`. The dark token block matches both selectors.
3. **Shared demo classes** (placeholder, drag preview, list/row styles used across pages) go in `src/styles.scss`, because the preview and placeholder render outside component views. The docs live examples share styles through `src/app/examples/examples-shell.scss` (unencapsulated, scoped to `app-examples-shell`), so the example components stay copy-pasteable.
4. **Docs theme overrides** (`docs/theme/index.css`): prefer mapping tokens onto `--rp-*` variables. BEM overrides must be prefixed with `html` to outrank Rspress's equal-specificity rules. Code blocks are dark in both themes.
5. **No gradients, no emoji, no marketing tone.** Uniform list rows; accent-soft fill plus an inset ring for the active drop zone; 1.5px dashed accent placeholder.
6. **Accessible contrast:** all text meets WCAG AA against its background, in both themes.
