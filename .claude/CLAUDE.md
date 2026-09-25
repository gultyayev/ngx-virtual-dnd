# ngx-virtual-dnd

Angular monorepo containing a drag-and-drop library optimized for virtual scrolling.

## Critical Rules

These rules prevent common mistakes that cause hard-to-debug issues:

1. **Rebuild library after edits:** After editing any file in `/projects/ngx-virtual-dnd/`, run `ng build ngx-virtual-dnd`. Without this, changes won't appear in the demo app.

2. **Never use `allowSignalWrites: true`:** This option is DEPRECATED as of Angular 19. Signal writes are allowed by default in effects.

3. **Run E2E tests before marking work done:** Use `npx playwright test --reporter=dot --max-failures=1` (all browsers, not just Chromium). Without this, broken interactions ship undetected. Exception: Skip for documentation-only or CLAUDE.md-only changes.

4. **Use data attributes for element identification:** Use `data-*` attributes (`data-draggable-id`, `data-droppable-id`) in both library code and E2E tests — not CSS class selectors, tag names, or component queries.

5. **Never throw errors in drag/drop operations:** Use early returns and graceful degradation instead.

6. **TDD for every bug fix — no exceptions:** Write a failing test first, run it to confirm it fails (this proves the bug exists), implement the fix, confirm it passes. Never write the fix first.

7. **Run ESLint on changed files:** Before considering a task done, run `npm run lint` or `npx eslint --flag v10_config_lookup_from_file <changed-files>` to catch formatting and style issues. Lefthook pre-commit checks the same rules; running manually catches issues earlier.

8. **Test fails = you broke it:** If a test fails after your changes, fix it before declaring done.

9. **Keep instructions in sync:** Any change to code documented in this file must include a corresponding update in the same commit. This includes: code examples (if a pattern shown changes, update the example), architecture descriptions (if behavior in Architecture or a lazy doc changes, update it), and lazy docs (`.ai/E2E.md`, `.claude/history/*.md`, `.claude/TROUBLESHOOTING.md`, `.claude/demo/DESIGN_SYSTEM.md`, `.claude/DOCS_SITE.md`).

10. **Never use `expect(true).toBe(true)` or similar no-op assertions:** Every test assertion must verify actual behavior. Tests that always pass regardless of code behavior provide false confidence and zero coverage. If you can't write a meaningful assertion, the test shouldn't exist.

11. **Keep skills and docs in sync with public API:** Any change to the consumer-facing API (new/changed/removed component, directive, input, output, event, utility, token, CSS class, or keyboard shortcut) must update `skills/ngx-virtual-dnd/SKILL.md` and/or `skills/ngx-virtual-dnd/references/api-reference.md` **and** the docs site (`docs/pages/api/*.mdx` plus any guide page that covers it) in the same commit. Internal-only changes (bug fixes, refactoring, performance) do not require skill or docs updates unless they change observable consumer behavior.

## Project Structure

- **Main app** (`/src`) - Demo application showcasing the library, plus the docs live examples (`src/app/examples/`)
- **ngx-virtual-dnd** (`/projects/ngx-virtual-dnd`) - Reusable drag-and-drop library
- **Docs site** (`/docs`) - Rspress 2 documentation site. GitHub Pages serves the docs at `/ngx-virtual-dnd/` and the demo at `/ngx-virtual-dnd/demo/` (see `.claude/DOCS_SITE.md`)

Design tokens for the demo and docs live in `src/styles/tokens.css`.

**Prefixes:** `app-` for main app components, `vdnd-` for library components/directives.

## Code Patterns

### TypeScript

- Avoid `any`; use `unknown` when type is uncertain
- Use native ESM private members (`#` syntax) instead of TypeScript's `private`
  - Exception: Angular signal queries (`viewChild`, `viewChildren`, `contentChild`, `contentChildren`) cannot use ES private fields - use TypeScript `private` for these

### Angular

- Do NOT set `standalone: true` in decorators (default in Angular v21+)
- Use `inject()` function instead of constructor injection
- Put host bindings in `host` object of decorators (not `@HostBinding`/`@HostListener`)
- Use `runOutsideAngular` for RAF loops, programmatic event listeners, and `ResizeObserver`
- Avoid template/host event bindings (`(event)`, `host: { '(event)' }`) for high-frequency DOM events (`mousemove`, `pointermove`, `touchmove`, `scroll`, `resize`, `dragover`) — Angular marks the view dirty on every emission, even with OnPush. Use programmatic `addEventListener` inside `runOutsideAngular` instead. Low-frequency initiation events (`mousedown`, `touchstart`, `keydown`, `click`) are fine as template/host bindings.
- Signal updates do NOT need `ngZone.run()` - signals work across zone boundaries
- Never use hand made `ngDevMode`. Use `isDevMode()` instead

### Components

- Set `changeDetection: ChangeDetectionStrategy.OnPush`
- Use `input()` and `output()` functions instead of decorators
- Use `computed()` for derived state
- Prefer inline templates for small components
- Use `class` bindings instead of `ngClass`; `style` bindings instead of `ngStyle`

### Styling: CSS for Static, Bindings for Dynamic

Use CSS rules for values that never change at runtime. Use Angular `[style.*]` bindings **only** for values driven by signals, inputs, or other reactive state.

- **Host styles:** Static properties (`display`, `position`, `overflow`, `pointer-events`) go in `:host` CSS. Only truly dynamic values (e.g., `[style.height.px]="containerHeight()"`) remain as host bindings.
- **Template styles:** Static properties on inner elements go in named CSS classes (e.g., `.vdnd-viewport-spacer { position: absolute; ... }`). Only dynamic values remain as `[style.*]` bindings on the template element.
- **No wrapper divs for static styles:** Don't add wrapper `<div>`s just to apply `position: relative` or `width: 100%` — put these on `:host` or an existing element instead.

### Signal Architecture

```typescript
// Private writable signal
readonly #state = signal<DragState>(INITIAL_STATE);

// Public readonly view
readonly state = this.#state.asReadonly();

// Derived state
readonly isDragging = computed(() => this.state().active);
```

Use `update()` or `set()` on signals (not `mutate`). Note: `DragStateService` uses individual `computed()` projections instead of `.asReadonly()` — both patterns are valid.

### Effects

```typescript
// Correct - no options needed for simple cases
effect(() => {
  this.mySignal.set(newValue); // Signal writes allowed by default
});

// With injector (only when outside constructor)
effect(() => { ... }, { injector: this.#injector });

// WRONG - never use this deprecated option
effect(() => { ... }, { allowSignalWrites: true }); // DO NOT USE
```

### Error Handling

- Never throw errors in drag/drop operations - use early returns
- Use `console.warn()` for recoverable issues (missing attrs, invalid state)
- Guard dev-only logging with `isDevMode()`
- Philosophy: graceful degradation over failure

### Event Listener Cleanup

Use `createBoundListener()` from `lib/utils/event-listener-bindings.ts` for programmatic listeners. It takes the target, event type, handler and `NgZone`. Call `.add()` to attach it outside Angular's zone and `.remove()` in `ngOnDestroy`; nothing is removed automatically.

### Templates

- Do not use arrow functions in templates
- Never bind high-frequency DOM events (`scroll`, `mousemove`, `pointermove`, `touchmove`) in templates — use programmatic listeners outside Angular's zone

### Timing and Rendering

- **Prefer `afterNextRender()`** when waiting for Angular to complete a render cycle
- Use `requestAnimationFrame` only for:
  - Performance throttling (coalescing frequent events)
  - Animation loops (autoscroll, smooth transitions)
- Use `setTimeout` only for intentional user-facing delays
- **Avoid double RAF patterns** - use `afterNextRender()` instead
- **Never use `queueMicrotask`** to wait for Angular rendering

## Architecture

### Key Architectural Decisions

1. **Placeholder index probe uses capped center + midpoint refinement** for dynamic heights. See `.claude/history/placeholder-algorithm.md` for the detailed algorithm.

2. **Same-list adjustment applied once**: When dragging within the same list, apply +1 adjustment when `visualIndex >= sourceIndex` to compensate for hidden item.

3. **Virtual scroll integration**: During same-list drag, the strategy excludes the dragged item's index (`setExcludedIndex`): offsets after it close up, but the total height (spacer) keeps all N items so content below the list does not shift. `getTotalItemCount()` returns the logical N.

4. **No scroll compensation layers**: Uses raw `scrollTop` directly. Virtual scroll handles spacer adjustments internally.

5. **Gap prevention**: Dragged item hidden with `display: none`; the placeholder fills the slot it leaves.

6. **Overlay container for drag preview**: `DragPreviewComponent` teleports its host element into a body-level `<div class="vdnd-overlay-container">` via `afterNextRender`. This escapes ancestor CSS `transform`/`perspective`/`filter` that create new containing blocks for `position: fixed` (e.g. Ionic's `ion-page`). Angular change detection works on the logical component tree, so signals/effects/bindings keep working after the DOM move. Unit tests must use `document.querySelector()` instead of `fixture.debugElement.query()` to find the teleported preview.

7. **Shift animation is FLIP on top of layout**: Items move by layout (placeholder in flow), so CSS transitions can't animate them. When `VDND_ANIMATION_CONFIG` is provided, `ShiftAnimator` (`lib/utils/shift-animator.ts`) snapshots rendered item positions (relative to scroll content) before a placeholder change and plays a `transform` WAAPI animation after render. Views recycled by `VirtualForDirective` must cancel their animation. Drag end is one more FLIP pass (rows slide into the committed order instead of snapping). Hit-testing is pure math, so in-flight transforms never affect the drop index.

8. **Drop animation is visual-only, after the drop**: The drag state still ends synchronously and `drop`/`dragEnd` are never delayed. `DragPreviewComponent` keeps the preview rendered from `endedDragState()` while settling, and after the next render `DropAnimator` (`lib/utils/drop-animator.ts`) glides it onto the item's rendered element (found by `data-*` attributes in the target list, then the source list) while hiding that element with an `opacity` animation. A new drag cancels it. The settling preview uses `data-testid="vdnd-drag-preview-dropping"`, so E2E `dragPreview` locators see the drag as over immediately.

### Safari Autoscroll

Use direct `element.scrollTop += delta` (not `scrollBy()`) with synchronous callback — no RAF delay. See `.claude/history/safari-autoscroll.md` for details.

### Keyboard Drag

**Constraints:**

- Hidden elements (`display: none`) can't receive keyboard events or focus
- Solution: Document-level keyboard listeners during drag
- Gotcha: Call `stopPropagation()` when starting to prevent immediate drop
- Focus: Restore with `afterNextRender()` using `EnvironmentInjector`

**Screen Reader Announcements:** Not built-in (i18n complexity). Consumers implement using position data in drag events. See the Accessibility guide (`docs/pages/guide/more/accessibility.mdx`) for an example.

## Lazy Documentation

Load these ONLY when working on specific areas:

| Doc                                                  | When to Load                                     |
| ---------------------------------------------------- | ------------------------------------------------ |
| `.ai/E2E.md`                                         | Before writing/modifying Playwright tests        |
| `.claude/demo/DESIGN_SYSTEM.md`                      | Before styling demo pages, docs pages, or theme  |
| `.claude/DOCS_SITE.md`                               | Before working on the docs site or live examples |
| `.claude/history/safari-autoscroll.md`               | If debugging Safari scroll drift                 |
| `.claude/history/placeholder-algorithm.md`           | If modifying placeholder index calculation       |
| `.claude/TROUBLESHOOTING.md`                         | If debugging unexpected behavior                 |
| `skills/ngx-virtual-dnd/SKILL.md`                    | When modifying the library's consumer-facing API |
| `skills/ngx-virtual-dnd/references/api-reference.md` | When modifying the library's consumer-facing API |

### When to Create Lazy Documentation

Lazy-load when: specialized (one subsystem), debugging/troubleshooting, or historical context. Inline only when broadly relevant (>20% of conversations), concise (≤3 lines), and actionable. Never duplicate between CLAUDE.md and lazy docs — single source of truth.

## Common Tasks

| Task                           | Load First                                            | Key Tests                                                                                                |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| New E2E test                   | `.ai/E2E.md`                                          | All browsers: `npx playwright test --reporter=dot --max-failures=1`                                      |
| Modify placeholder calc        | `.claude/history/placeholder-algorithm.md`            | `placeholder-behavior.spec.ts`, `placeholder-integrity.spec.ts`, `drag-index-calculator.service.spec.ts` |
| Update skills after API change | `skills/ngx-virtual-dnd/SKILL.md`, `api-reference.md` | -                                                                                                        |
| Docs page or live example      | `.claude/DOCS_SITE.md`                                | `npm run docs:build`, `docs-examples.spec.ts`                                                            |
| Add new subsystem doc          | See lazy doc criteria above                           | -                                                                                                        |

## Testing

- **Unit tests:** Jest with zoneless environment
- **E2E tests:** Playwright - **ALWAYS run after code changes**
- Use Page Object Model pattern for E2E tests

### Commands

```bash
# Unit tests (minimal output)
npm test -- --silent

# Type-check specs, E2E tests and perf tooling (no build covers them; CI runs it)
npm run typecheck

# E2E - Chromium only (fast iteration)
npx playwright test --reporter=dot --max-failures=1 --project=chromium

# E2E - ALL BROWSERS (required before done)
npx playwright test --reporter=dot --max-failures=1

# Docs site
npm run docs:dev    # :3000 (run `npm start` too for live examples)
npm run docs:build  # type-check + build; fails on dead links

# Verbose (only when debugging)
npm test -- --verbose
npx playwright test --reporter=list
```

### Testing Decision Tree

- Testing DOM behavior/user interaction → E2E (Playwright)
- Testing pure logic/services → Unit tests (Jest)
- Debugging visual layout → Chrome MCP (last resort)

### Unit Test Guidelines

- Every assertion must test actual behavior — never use `expect(true).toBe(true)` or equivalent no-op patterns
- Test behavior, not implementation details
- Include negative tests (verify things DON'T happen when they shouldn't)
- Don't assert `element.style.*` for styles applied via CSS rules — jsdom doesn't compute them. Verify the CSS class is present instead (e.g., `expect(el.classList.contains('vdnd-drag-preview')).toBe(true)`). Only use `element.style.*` for dynamically bound inline styles.

### E2E Patterns

See `.ai/E2E.md` for comprehensive E2E testing patterns (timing, browser differences, assertions, gotchas).

### Cleanup

When finished a task always kill servers started during development. Never leave hanging processes, tasks.

## Accessibility

- Follow WCAG AA requirements (focus management, color contrast, ARIA)
- Support keyboard navigation (space to activate, escape to cancel)

## Tooling

- **Git hooks:** Lefthook (lint on pre-commit, test on pre-push, commitlint on commit-msg)
- **npm:** version pinned by `packageManager` in `package.json` (npm 12); CI installs exactly that version. npm 12 blocks dependency install scripts unless `allowScripts` in `package.json` allows them. When a new or updated dependency has install scripts, review them with `npm approve-scripts --allow-scripts-pending`, then `npm approve-scripts <pkg> --no-allow-scripts-pin` or `npm deny-scripts <pkg>`. Never approve with `--all`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
type(scope): description
```

**Types:** `feat`, `fix`, `perf`, `docs`, `refactor`, `test`, `chore`
**Scopes:** `lib`, `demo`, `e2e`, `docs`, `deps`, `release`
**Scope selection:** Match the scope to the files changed, not the feature area the change is "about." E2E-only changes use `e2e`, library-only changes use `lib`, demo-only changes use `demo`. Mixed changes spanning library + tests use `lib` (the primary change).
**Breaking changes:** Add `!` after type (e.g., `feat!:`) or `BREAKING CHANGE:` in footer
**PR titles:** Must follow the same Conventional Commits rules as commit messages (`type(scope): description`).

## Documentation Updates

### Docs site (`/docs/pages`)

The primary human-facing documentation. See `.claude/DOCS_SITE.md`.

### README.md (`/README.md`)

A short landing page (also the npm README): pitch, install, one example, links to the docs. Update it only when the install steps, the example, or the docs structure it links to changes.

### CHANGELOG.md

Auto-generated — do NOT manually edit.

## Releasing

Run `npm run release [patch|minor|major]` to release. Use `npm run release:dry-run` to test.

## Design System

When working on demo pages, docs pages or the docs theme, load the `ngx-virtual-dnd-design` skill and follow `.claude/demo/DESIGN_SYSTEM.md`.
