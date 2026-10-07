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
- Avoid template/host event bindings (`(event)`, `host: { '(event)' }`) for high-frequency DOM events (`mousemove`, `pointermove`, `touchmove`, `scroll`, `resize`, `dragover`) — Angular marks the view dirty on every emission, even with OnPush. Use programmatic `addEventListener` inside `runOutsideAngular` instead. Low-frequency initiation events (`mousedown`, `keydown`, `click`) are fine as template/host bindings.
- Never bind `touchstart` (or `wheel`) as a template/host event: Angular adds it non-passive, so a scroll gesture starting on the element waits for the main thread. Add it programmatically, `{ passive: true }` whenever the listener won't call `preventDefault()` (see `DraggableDirective`'s touchstart listener).
- Signal updates do NOT need `ngZone.run()` - signals work across zone boundaries
- Outputs emitted from listeners outside the zone (drag start/end, drop) DO need `ngZone.run()`: with zone.js, a template listener marks its view dirty but schedules no render
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

Keep a bound handler in a field so the same reference can be removed, attach programmatic listeners inside `runOutsideAngular`, and remove each one on the teardown path (`ngOnDestroy`, or a handler's `cleanup()`), as `PointerDragHandler` does. Helpers that attach listeners return a cleanup function to call there (see `lib/utils/dom-signal-bindings.ts`).

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

6. **Overlay container for drag preview**: `DragPreviewComponent` teleports its host element into a body-level `<div class="vdnd-overlay-container">` via `afterNextRender`. This escapes ancestor CSS `transform`/`perspective`/`filter` that create new containing blocks for `position: fixed` (e.g. Ionic's `ion-page`). Angular change detection works on the logical component tree, so signals/effects/bindings keep working after the DOM move. Unit tests must use `document.querySelector()` instead of `fixture.debugElement.query()` to find the teleported preview. The preview's transform is written imperatively, never bound: pointer moves in `DragSchedulerService`'s frame-writer phase (the same animation frame as the hit-test), everything else (drag start, keyboard, settle) from an `afterRenderEffect` that reads the cursor untracked. Its template must not read `cursorPosition`, or every pointer frame schedules an app-wide render that paints one frame late.

7. **Shift animation is FLIP on top of layout**: Items move by layout (placeholder in flow), so CSS transitions can't animate them. When `VDND_ANIMATION_CONFIG` is provided, `ShiftAnimator` (`lib/utils/shift-animator.ts`) snapshots rendered item positions (relative to scroll content) before a placeholder change and plays a `translate` WAAPI animation after render (the individual property with a replace effect, so it composites in Chromium and composes with the row's own `transform`; `composite: 'add'` only when the row sets its own `translate`). Views recycled by `VirtualForDirective` or `vdnd-virtual-scroll` must cancel their animation, and animation entries are keyed by track key, not element (a recycled element renders another item). Drag end is one more FLIP pass (rows slide into the committed order instead of snapping). Hit-testing is pure math, so in-flight transforms never affect the drop index.

8. **Drop animation is visual-only, after the drop**: The drag state still ends synchronously and `drop`/`dragEnd` are never delayed. `DragPreviewComponent` keeps the preview rendered from `endedDragState()` while settling, and after the next render `DropAnimator` (`lib/utils/drop-animator.ts`) glides it onto the item's rendered element (found by `data-*` attributes in the target list, then the source list) while hiding that element with an `opacity` animation. A new drag cancels it, and a virtual list that pools the row shows it again (`revealDropTargetIn`: the element renders another item next). The settling preview uses `data-testid="vdnd-drag-preview-dropping"`, so E2E `dragPreview` locators see the drag as over immediately.

9. **Droppables are found through a registry, never a document query**: `DroppableDirective` registers its element (by ID and group) with `DroppableRegistryService` from an effect (in the change detection that creates it, so `afterNextRender` hooks of that render find it) and unregisters on destroy. Hit-testing, keyboard list switching, drop animation and focus restore read the group's droppables from it. It also delivers the drop: `DragStateService.endDrag()` hands the ended state to the target's registered handler, so `drop` fires synchronously right after `dragEnd` (no effect, nothing for a later render to replay or lose). A (un)registration during a drag makes the next hit-test re-read the candidates. Test fixtures that build droppables from raw DOM must register them.

10. **Virtual lists render only rows whose context changed**: `*vdndVirtualFor` (`#updateViews`) and `vdnd-virtual-scroll` (`#renderRows`) compare each row's context and call `detectChanges()` (untracked) on the new, pooled (recycled) or changed rows only. Never `markForCheck()` a row: it marks every ancestor up to the root, so each scroll step and placeholder move would re-render the consumer component, its ancestors and every row. A placeholder move touches no row. `vdnd-virtual-scroll`'s template has no bindings: Angular checks every row view in a component's view whenever it checks that view (for example when a signal its template reads changes), so an effect renders the rows (into a `ViewContainerRef`, not with `@for`), the spacer height, the content offset and the placeholder (a standalone `DragPlaceholderComponent` moved among the rows). An input change still checks its view (OnPush) and every row with it; `ngOnChanges` flags that pass, so `#renderRows` leaves the rows to that check instead of checking them twice. As with `@for`, a row keeps its view while its track key stays rendered, and only the rows out of order move (a longest increasing subsequence stays in place). A row that leaves is destroyed, or with `recycleRows` detached into a pool for the rows that come in (never the dragged item's, found by its item ID or because it holds the dragged element: destroying it cancels the drag; nor one whose nodes are still in the DOM after the detach: a leave animation keeps them there, and Angular removes them when it ends). `*vdndVirtualFor` always pools, with the same two checks. Rows move with `ViewContainerRef.move()`, so the container's order (and query order) always matches the page. Angular plays the leave and enter animations of a moved view (before 21.2.1 it also removes its element when the leave animation ends; from 21.2.1 only if it moves again first); only `@for` avoids that. This is documented as an Angular limitation (Known limitations page, `docs/pages/guide/more/limitations.mdx`): don't work around it by moving DOM nodes outside the `ViewContainerRef`, which puts its order out of step with the page. A pooled view is always checked when reused: nothing checked it while detached. `PointerDragHandler` drops a press whose draggable renders another item or leaves the page before the drag starts, and `DraggableDirective.isPending` belongs to the pressed item.

11. **Library templates never forward high-frequency outputs with template listeners**: Angular marks the listening view and every ancestor dirty before running a template listener, so `(placeholderMove)="placeholderMove.emit($event)"` would re-render the consumer's whole component chain on every placeholder move. `VirtualSortableListComponent` forwards its inner droppable's `drop` and `placeholderMove` by subscribing (`SortableListOutputsDirective`, in its constructor).

12. **Scroll insets are plain numbers the consumer passes**: `scrollInsetTop`/`scrollInsetBottom` (on `vdndScrollable`, `vdnd-virtual-scroll`, `vdnd-virtual-viewport`, `vdnd-sortable-list`) give the space sticky content covers. They are reflected as `data-scroll-inset-*` attributes, and drag code reads them live through `lib/utils/scroll-insets.ts`. The visible part of a list is its own uncovered rect clipped by the uncovered rect of every scroll container around it (`visibleRect`); hit-testing, the constrained clamp, autoscroll edges, the drop animation and the keyboard reveal use it. Rect helpers return `null` when no area is left: a `DOMRect` with a negative height normalizes into the gap between the two rects. An inset change mid-drag goes through `refreshDragOnScrollInsetChange` (re-measure, re-clamp, re-collect autoscroll containers, keyboard reveal after the render). Don't add registries or callbacks for sticky elements: the consumer measures.

### Safari Autoscroll

Use direct `element.scrollTop += delta` (not `scrollBy()`) with synchronous callback — no RAF delay. See `.claude/history/safari-autoscroll.md` for details.

### Keyboard Drag

**Constraints:**

- Hidden elements (`display: none`) can't receive keyboard events or focus
- Solution: Document-level keyboard listeners during drag
- Gotcha: Call `stopPropagation()` when starting to prevent immediate drop
- Focus: Restore with `afterNextRender()` using `EnvironmentInjector`
- Scroll into view: every arrow key scrolls the target slot into the visible part of the list, synchronously (a drop can follow before the next render). `vdnd-virtual-scroll` registers its own revealer with `KeyboardDragService`; every other list goes through `DragIndexCalculatorService.revealSlot`, now and once more after the next render: strategy offsets for virtual lists, the rendered rows (or a `vdnd-placeholder`) for plain `@for` lists, scrolling each container around them nearest first (`revealRange`).

**Screen Reader Announcements:** Not built-in (i18n complexity). Consumers implement using position data in drag events. See the Accessibility guide (`docs/pages/guide/features/accessibility.mdx`) for an example.

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

# Type-check specs, E2E tests and perf tooling (no build covers them; CI runs it).
# Needs the built library: the demo's specs import ngx-virtual-dnd from dist.
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
