# Design System (demo + docs)

The docs site follows the **Night** design system (neutral grounds, one accent, orange only for the item in hand; light and dark): https://claude.ai/artifact/178zESCbcsVoQpsAPpKqAf. Read it with the Artifact tool, starting with `project/README.md`; `project/rspress.md` maps it onto Rspress. The demo app still uses the v1 **ngx-virtual-dnd Design System** (teal accent, light/dark, no gradients) until its own Night restyle. The v1 guidelines live in the project skill:

- `.claude/skills/ngx-virtual-dnd-design/README.md`: colors, type, spacing, radii, shadows, top bar, docs site, iconography, logo
- `.claude/skills/ngx-virtual-dnd-design/assets/`: 1c "Viewport" logo mark, favicon, lockup

Load that skill before styling demo pages; read Night before styling docs pages or the docs theme.

## Rules for this repo

1. **Tokens:** the demo's come from `src/styles/tokens.css` (imported by `src/styles.scss`, via `@use`); add a token there first, then mirror it in the skill's `colors_and_type.css`. The docs theme carries Night's `tokens.css` blocks at the top of `docs/theme/index.css`, copied from the design system (never retyped). Never hard-code token hex values in components.
2. **Themes:** the demo sets `data-theme` / `data-scheme` / `data-density` on `<html>` (`ThemeService`). Rspress toggles `html.rp-dark` (and `html.dark`); the docs' dark Night block keys on `html.rp-dark`.
3. **Shared demo classes** (placeholder, drag preview, list/row styles used across pages) go in `src/styles.scss`, because the preview and placeholder render outside component views. The docs live examples share styles through `src/app/examples/examples-shell.scss` (unencapsulated, scoped to `app-examples-shell`), so the example components stay copy-pasteable.
4. **Docs theme overrides** (`docs/theme/index.css`): prefer mapping tokens onto `--rp-*` variables. BEM overrides must be prefixed with `html` to outrank Rspress's equal-specificity rules. Code blocks are dark in both themes.
5. **No emoji, no marketing tone.** Demo: no gradients (Night allows three on the docs: the hero headline highlight, the hero glows and the dark list panel). Uniform list rows; accent-soft fill plus an inset ring for the active drop zone; 1.5px dashed accent placeholder.
6. **Accessible contrast:** all text meets WCAG AA against its background, in both themes.
