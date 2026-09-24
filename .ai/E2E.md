# E2E (Playwright) Best Practices — ngx-virtual-dnd

This repo’s E2E suite exists to catch regressions in hard-to-test behavior:

- Virtual scrolling (DOM is _not_ the source of truth for list contents)
- Drag-and-drop (precise hit-testing + placeholder math)
- Autoscroll (RAF loops, edge thresholds, Safari/WebKit quirks)
- Keyboard drag (document-level key handling + focus restoration)
- Mobile/touch (drag-delay vs native scroll; touch listeners must not block scroll)

The goal is **high-signal, low-flake** tests that run reliably across browsers.

---

## Golden Rules (Repo-Specific)

### 1) Assert on _state_, not _time_

Avoid `page.waitForTimeout()` as a synchronization mechanism. Prefer:

- `await expect(locator).toBeVisible()` / `toBeHidden()` / `toHaveText()` for UI state
- `await poll(() => demoPage.getScrollTop('list1')).toBeGreaterThan(...)` (`e2e/fixtures/polling.ts`)
- `await expect(async () => { ... }).toPass()` for multi-assert waits

Polling is frame-paced: `playwright.config.ts` gives every `toPass()` `POLL_INTERVALS`
(16/32/50 ms, then every 100 ms) instead of Playwright's 100/250/500/1000 ms back-off, which
overshoots frame-driven waits by up to a second. `expect.poll()` has no config default, so use
the `poll()` wrapper instead of calling it directly.

To prove that something does **not** happen, wait a number of frames rather than a duration:
`waitForFrames(page, 10)` (`e2e/fixtures/drag-sync.ts`). Autoscroll and rendering run once per
frame, so this gives them a fixed number of chances whatever the machine load. A fixed wait is
acceptable only when the behavior is itself time-based (for example "hold longer than the drag
delay").

### 2) Virtual scroll: DOM counts lie

Only visible items are rendered. For logical list sizes:

- Use the list badge rather than `locator.count()`: `await expect(demoPage.countBadge('list1')).toHaveText('49')` waits for the render after a drop; `getItemCount()` reads it once.
- When verifying insertion at a specific logical index, **scroll to it** and then assert the visible item id (`getRenderedIndexOf(list, id)`), or assert the drop event's `data-last-drop-destination-index` on the demo host.

### 2a) Identify items by id, not text

Both main-demo lists name their items "Item 1…Item 50", so a text check cannot tell an item
that moved from list 1 from list 2's own item at that index (an off-by-one drop still passes).
Compare `data-draggable-id` values: `getItemId(list, index)` / `getItemIds(list)`.

### 3) Always scroll targets into viewport before hit-testing

`elementFromPoint(x, y)` uses viewport coordinates; `boundingBox()` can be valid even when the element is offscreen.

Best practice:

- `await locator.scrollIntoViewIfNeeded()` before `boundingBox()`
- Keep drop coordinates within the viewport bounds
- Keep **every** pointer target inside the viewport, even when testing "far outside the
  container": Firefox drops a `mouse.move()` whose target is outside the viewport (its steps
  included), and a `mouse.up()` there never ends the drag. Chromium and WebKit deliver them, so
  such a test silently checks nothing on Firefox.

### 4) Prefer stable identifiers

Use repo conventions:

- Draggable: `data-draggable-id`
- Droppable: `data-droppable-id`

Avoid coupling to CSS structure (e.g. `.list-card:nth(0)`) unless no test id exists.

### 5) A drag is not “started” until the preview exists

Always synchronize on a **drag-start signal**:

- `await expect(demoPage.dragPreview).toBeVisible()` (mouse/touch/keyboard)
- (Optional) `await expect(demoPage.placeholder).toBeVisible()` when placeholder is expected

`DemoPage.startDrag(locator | box)` presses, crosses the threshold and waits for the preview in
**one attempt**. Don't wrap drag starts in `toPass()` retries: they hide the failure the test
exists to catch and cost a second per failed attempt.

### 5a) Negative assertions need a sync point

`await expect(preview).not.toBeVisible()` right after an input passes before the input has
even reached the page, whatever the library does. Send the input through `afterInputHandled`
(`e2e/fixtures/drag-sync.ts`), which resolves once the page has received the event and rendered
two frames since:

```typescript
await page.mouse.down();
await afterInputHandled(page, 'mousemove', () => page.mouse.move(x + 100, y));
await expect(demoPage.dragPreview).not.toBeVisible();
```

Better still, follow the ignored input with one that has a visible effect (for example an
ArrowDown after a rejected ArrowRight) and assert the combined outcome.

For timers (drag delay), use `page.clock.install()` and `page.clock.runFor(ms)` to step past the
delay instead of sleeping through it.

### 6) Autoscroll assertions must be retrying

Autoscroll is time-based; assertions must tolerate variability:

- **Use a consistent edge offset**: A 25px offset from the container edge is the sweet spot for all browsers (deep enough to trigger autoscroll reliably, but safe from the edge). Avoid browser-specific offsets (like 10px vs 20px).
- **Ensure stable mouse position**: Firefox sometimes fails to register the final position after a stepped `page.mouse.move()`. Always follow up a stepped move with a direct move to the same coordinates: `await page.mouse.move(x, y, { steps: 15 }); await page.mouse.move(x, y);`.
- **Prefer `toPass()` with descriptive errors**: Wrap autoscroll assertions in `toPass()` with a generous timeout (e.g., 10-15s for long scrolls) and include a custom error message for better CI debugging.
- Prefer “scroll changed” and “preview + placeholder stayed aligned” over pixel-perfect checks.

### 7) Long autoscroll tests stay in the PR suite

The drift and long-autoscroll tests run on every PR so regressions surface in the PR that
introduces them. Keep them lean instead: frame-paced polling (rule 1), atomic snapshots (see
"Atomic Measurements"), and `test.slow()` rather than a custom multi-minute `test.setTimeout()`.
They measure real autoscroll throughput, so they need spare CPU: CI runs 2 workers on 4 vCPUs.

### 8) Set up demo state through the URL

`DemoPage.goto({ ... })` opens the main demo pre-configured (`itemCount`, `lockAxis`,
`dragEnabled`, `dragDelay`, `dragHandle`, `api: 'simplified'`, `constrainToContainer`,
`list2Disabled`, `shiftAnimation`). Click through the settings panel only when the test is about
changing a setting at runtime, and then wait for a render that proves the change applied (for
example the `vdnd-draggable-disabled` class) before interacting.

### 9) Scrub animations instead of waiting for them

Shift animations are WAAPI animations: start them with a long duration
(`goto({ shiftAnimation: 60_000 })`), then `animation.pause()` and set `currentTime` (or call
`finish()`) to check the start, middle and end positions instantly. To check whether an
animation was started at all, count `Element.animate()` calls rather than polling for a short
running animation.

---

## Recommended Test Structure (v2)

### Split by capability (desktop vs mobile)

- Desktop cross-browser: `*.spec.ts` (runs on Desktop Chrome/Safari/Firefox)
- Mobile suite: `*.mobile.spec.ts` (runs on mobile projects only)

Mobile tests should avoid Chromium-only mechanisms unless explicitly scoped.

### Prefer Page Object + small helpers

Keep raw pointer math in one place (`e2e/fixtures/demo.page.ts`) so fixes apply everywhere.

Helpers should:

- Scroll both source and target into view
- Start drag reliably (small move, then wait for preview)
- Avoid hard-coded sleeps; rely on visible state

---

## Patterns That Catch Real Regressions

### Cross-list drop correctness

Validate both:

1. **Counts** changed correctly (authoritative, not DOM count)
2. The dragged item’s **identity** moved (`data-draggable-id`; texts repeat across lists)

Assert counts with `await expect(demoPage.countBadge(list)).toHaveText(...)`, which waits for
the render after the drop.

### Same-list reorder

Capture the first few item texts/ids, perform reorder, then assert the new order.

### “No gaps / no ghosts” placeholder integrity

During drag, assert:

- Exactly one `.vdnd-drag-placeholder-visible`
- No empty `.item` “ghosts” (`DemoPage.countGhostElements`)
- Dragged element is `display: none` (gap prevention)

### Drag-delay touch correctness (mobile)

The primary regression is **calling `preventDefault()` too early** (blocks native scroll).

Preferred assertions:

- Before delay: touchmove events should not be `defaultPrevented`, and drag preview should not appear
- After delay: pending class appears; moving starts drag and touchmove becomes `defaultPrevented`

This directly targets `DraggableDirective` touch-delay logic.

---

## Timing & Synchronization Patterns

This library uses `requestAnimationFrame` to throttle drag position updates
(`draggable.directive.ts`). This creates specific synchronization requirements
that differ from typical Playwright tests.

### rAF Wait After Mouse Moves (Loose Assertions Only)

After any `page.mouse.move()` during a drag, the position hasn't been processed
until the next animation frame. For LOOSE assertions ("item moved somewhere",
"preview still visible", cleanup drops), wait one frame before dropping:

```typescript
await page.mouse.move(targetX, targetY, { steps: 10 });
// Position update is rAF-throttled — wait one frame
await waitForFrames(page, 1);
await page.mouse.up();
```

A rAF wait is NOT sufficient when the test asserts an exact drop position or
order — see the next section.

### Exact Drop Outcomes: Settle the Processed Drag State

During the drag, `DragStateService` commits `cursorPosition`, `activeDroppable`
and `placeholderIndex` together once per RAF tick, so mid-drag assertions
(placeholder position/count) still lag the pointer by up to a frame.

At release the picture is different: on a non-cancelled `mouseup`, `#endDrag`
now flushes the last **delivered** pointer position synchronously (through
`#updateDrag`) BEFORE stopping the scheduler, so the drop resolves against the
release coordinates rather than the last RAF-processed frame. The old
"queued position discarded at mouseup" race is gone — a plain
`page.mouse.move(target)` immediately followed by `page.mouse.up()` lands on
`target` with no RAF wait (see the disabled-destination test in
`disabled-elements.spec.ts`).

The remaining gap is pointer-event **delivery**, not processing: under
parallel/WebKit load the final `page.mouse.move()` can still be in flight when
`mouse.up()` fires, so the flush applies a stale position. For tests that
assert an exact cross-list drop position/order, keep settling before release —
it guarantees the move was delivered and lets you assert the target resolved:

```typescript
await page.mouse.move(targetX, targetY, { steps: 10 });
// Polls the processed cursor, re-issuing the move on retry (replaces the rule #6 direct move)
await demoPage.settleDragPosition(targetX, targetY);
// Cross-list drags: additionally assert the release point resolved to the target droppable
await demoPage.waitForActiveDroppable('list2');
await page.mouse.up();
```

Placeholder visibility is NOT proof of the target list — the source list shows
a placeholder from drag start.

Every demo page exposes the processed state via `data-testid="drag-state-debug"`
(visible debug panel on the main demo, hidden `DragStateDebugComponent` on the
task demos). The shared implementation lives in `e2e/fixtures/drag-sync.ts` and
is exposed on both page objects (`DemoPage`, `TaskDemoPage`).

Caveats: the processed cursor is the EFFECTIVE position — do not settle with
axis locking enabled, and with constrain-to-container only when the release
point lies inside the constraint bounds.

### Initial Position Capture

When capturing a baseline `boundingBox()` for position comparison, the
rAF-throttled transform may not have been applied yet. Send the move that starts
the drag through `afterInputHandled` so the capture happens after it was handled
and rendered:

```typescript
await page.mouse.down();
await afterInputHandled(page, 'mousemove', () => page.mouse.move(x + 10, y + 10));
await expect(demoPage.dragPreview).toBeVisible();
const initialBox = await demoPage.dragPreview.boundingBox();
```

### One-Shot vs Retrying Assertions

`locator.count()` is a **one-shot** call — it returns immediately without
retrying. For state that depends on rAF-throttled updates, wrap in `toPass`:

```typescript
// WRONG — count() may return 0 if rAF hasn't fired yet
const count = await page.locator('.vdnd-drag-placeholder-visible').count();
expect(count).toBe(1);

// CORRECT — retries until rAF-dependent state settles
await expect(async () => {
  const count = await page.locator('.vdnd-drag-placeholder-visible').count();
  expect(count).toBe(1);
}).toPass({ timeout: 2000 });
```

### Empty List Drops

Generic drag helpers (like `dragItemToList`) must NOT wait for placeholder
visibility — empty list targets don't produce placeholders. Use rAF wait
instead. Only wait for placeholder in inline test code where you know the
target list has items.

### Atomic Measurements During Animations

When measuring multiple element positions during rapid updates (autoscroll, animations), use a single `page.evaluate()` to capture all measurements atomically. Sequential `boundingBox()` calls have round-trip latency, allowing positions to change between calls.

```typescript
// WRONG - sequential calls introduce timing skew during rapid scroll
const previewBox = await preview.boundingBox(); // Round-trip 1
const placeholderBox = await placeholder.boundingBox(); // Round-trip 2 - position may have changed!
const drift = Math.abs(previewBox.y - placeholderBox.y);

// CORRECT - atomic measurement in single browser evaluation
const { previewY, placeholderY } = await page.evaluate(() => {
  const preview = document.querySelector('.preview');
  const placeholder = document.querySelector('.placeholder');
  return {
    previewY: preview?.getBoundingClientRect().top,
    placeholderY: placeholder?.getBoundingClientRect().top,
  };
});
const drift = Math.abs(previewY - placeholderY);
```

### Content Offset and Cross-Browser Precision

Firefox and WebKit round `borderBoxSize.blockSize` (via `ResizeObserver`) and
`translateY` sub-pixel values differently than Chromium. This produces ~6-8px
of additional drift during continuous autoscroll.

For drift tolerance in alignment tests:

- Use `itemHeight * 0.65 + 4` as baseline (not `itemHeight * 0.5 + 2`)
- This still catches real regressions (off by >= 1 full item)
- Attach `driftSamples` array to test artifacts for debugging

### Scrolled Drag Tests (External Scroll Container)

When testing drag-and-drop after programmatic scroll:

1. **Wrap scroll in `toPass()`** — both the scroll write and read, so the scroll
   re-applies if content height wasn't ready yet
2. **Don't use `.task-item:first()` after scrolling** — virtual scroll renders
   overscan items above the viewport. `.first()` matches an overscan item, and
   `hover()` scrolls it into view, potentially placing items behind sticky headers
   where `elementFromPoint()` misses the droppable. Instead, pick items by viewport
   position (e.g., find the item at the scroll container's vertical center via
   `page.evaluate`)
3. **After drag starts, get fresh `boundingBox()`** of target items — positions
   shift when the dragged item hides (`display: none`) and virtual scroll re-renders
4. **Use rAF wait** instead of fixed `waitForTimeout()` after mouse moves
5. **Firefox: follow up stepped moves with direct moves** (E2E.md Rule #6)
6. **Avoid `locator.nth(...).hover()` as drag source selection after scroll** —
   virtual DOM churn can detach or move that node between selection and hover
   (seen as WebKit `locator.hover` timeout). Prefer atomic source-box selection in
   `page.evaluate()` and drag by coordinates.

#### Deterministic Source Selection Pattern (Virtual Scroll)

```typescript
let sourceBox: { x: number; y: number; width: number; height: number } | null = null;

await expect(async () => {
  sourceBox = await page.evaluate(() => {
    const container = document.querySelector('.scroll-container') as HTMLElement | null;
    if (!container) return null;

    const containerRect = container.getBoundingClientRect();
    const targetY = containerRect.top + containerRect.height * 0.65;
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('[data-draggable-id], .task-item'),
    )
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          centerY: rect.top + rect.height / 2,
          visible:
            rect.bottom > containerRect.top + 12 &&
            rect.top < containerRect.bottom - 12 &&
            rect.height > 0 &&
            rect.width > 0,
          box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      })
      .filter((item) => item.visible)
      .sort((a, b) => Math.abs(a.centerY - targetY) - Math.abs(b.centerY - targetY));

    return candidates[0]?.box ?? null;
  });

  expect(sourceBox).not.toBeNull();
}).toPass({ timeout: 3000 });

if (!sourceBox) throw new Error('Could not get source box');

await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
await page.mouse.down();
```

Why this works:

- Captures geometry atomically in one browser evaluation.
- Uses viewport-visible candidates only (not overscan assumptions).
- Retries until content is ready (`toPass`) instead of relying on timing sleeps.

---

## Component Gotchas

### Two Placeholder Components

The library has **two different** placeholder-related components:

| Component                  | Selector                | Key Class                        |
| -------------------------- | ----------------------- | -------------------------------- |
| `DragPlaceholderComponent` | `vdnd-drag-placeholder` | `.vdnd-drag-placeholder-visible` |
| `PlaceholderComponent`     | `vdnd-placeholder`      | _(none relevant for tests)_      |

Tests should use `.vdnd-drag-placeholder-visible` (documented public API) to
locate the visible placeholder. Never mix selectors between these components.

### Angular `@if` Component Tree Swaps

When `@if` destroys and recreates entire component trees (e.g., toggling
simplified API mode at runtime), items can be **visible** before the virtual scroll
container computes its content height. `toBeVisible()` alone is insufficient.
(`DemoPage.enableSimplifiedApi()` handles this; tests that merely need the simplified
API start in it with `goto({ api: 'simplified' })`.)

First wait for a signal that the swap rendered: the **old** tree satisfies every item and
`scrollHeight` check, so under load those checks can pass before the swap happens. The
demo's API toggle sets `aria-pressed`, which updates in the same render as the `@if`:

```typescript
await expect(simplifiedButton).toHaveAttribute('aria-pressed', 'true');
```

Then verify functional readiness by checking `scrollHeight`:

```typescript
await expect(this.list1Items.first()).toBeVisible();
// Items visible but virtual scroll may not have computed content height yet
await expect(async () => {
  const h1 = await list1VirtualScroll.evaluate((el) => el.scrollHeight);
  const h2 = await list2VirtualScroll.evaluate((el) => el.scrollHeight);
  expect(h1).toBeGreaterThan(400);
  expect(h2).toBeGreaterThan(400);
}).toPass({ timeout: 2000 });
```

### Scroll Commands Before Content Height Is Ready

If `scrollTop` is set when `scrollHeight` is still 0 (content not rendered),
the value clips to 0 permanently — a later retry of the **read** alone won't
help. Put both the scroll **write** and **read** inside `toPass`:

```typescript
// WRONG — scroll clips to 0, then toPass only re-reads the clipped value
await scrollList('list2', 1000);
await expect(async () => {
  expect(await getScrollTop('list2')).toBe(1000);
}).toPass({ timeout: 2000 });

// CORRECT — re-applies the scroll on each retry
await expect(async () => {
  await scrollList('list2', 1000);
  expect(await getScrollTop('list2')).toBe(1000);
}).toPass({ timeout: 2000 });
```

---

## Debugging & Diagnostics

- Task-demo specs fail on any console or uncaught page error: `collectPageErrors(page)`
  (`e2e/fixtures/page-errors.ts`), registered before navigation so load errors count.
- Prefer `testInfo.attach()` for structured debug output over `console.log`.
- When drift/hit-testing fails, capture:
  - viewport size (`window.innerHeight`)
  - pointer coordinates
  - placeholder/preview bounding boxes
  - container scrollTop + content offset attributes (if present)

---

## Commands

```bash
# Fast iteration
npx playwright test --reporter=dot --max-failures=1 --project=chromium

# All browsers (required before done)
npx playwright test --reporter=dot --max-failures=1

# Reproduce CI: production build served by scripts/serve-dist.js, 2 workers, retries
npm run build:lib && npm run build && CI=1 npx playwright test --reporter=dot
```

Local runs use `ng serve` (dev mode keeps Angular's dev-only checks such as
`ExpressionChangedAfterItHasBeenChecked`). CI serves the production build from the
build job's artifact instead, because every test starts with a page load.
