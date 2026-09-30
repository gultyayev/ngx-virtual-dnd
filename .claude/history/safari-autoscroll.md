# Safari Autoscroll Drift - Debugging History

This file documents the full debugging history for the Safari autoscroll drift issue. The working solution and key insights are in the main CLAUDE.md. This file is for reference when actively debugging Safari-specific scroll issues.

## Issue Description

During autoscroll in Safari, the placeholder position drifts from where it should be. The drift is cumulative - it gets worse with each scroll direction change. Eventually the placeholder reaches the list boundary before the scroll does, causing autoscroll to stop prematurely.

## Root Cause (Final)

The placeholder calculation must happen synchronously within the same animation frame as the scroll. Any delay (RAF, double RAF, etc.) causes the calculation to use a scrollTop value that reflects additional scrolls that happened during the delay.

## Failed Attempts

**Template for documenting new attempts:**
When adding new fix attempts, document: (1) the hypothesis, (2) the implementation, (3) why it failed.

### 1. Double RAF with layout flush (Dec 2025)

**Hypothesis:** Safari caches hit-testing results and only invalidates on user-initiated scroll. Double RAF gives Safari time to process the scroll, layout flush forces reflow.

**Implementation:** After `scrollBy()`, schedule callback via:

```typescript
requestAnimationFrame(() => {
  void element.offsetHeight;
  requestAnimationFrame(() => callback());
});
```

**Why it failed:** During the 2-frame delay, the autoscroll loop continues scrolling. By the time the callback runs, scrollTop reflects 2+ additional scrolls. This creates cumulative drift that compounds with each frame.

### 2. Cumulative scroll delta tracking (Dec 2025 - not implemented, rejected during planning)

**Hypothesis:** Track total scroll delta since drag start and apply as correction to grabOffset.

**Why rejected:** Risk of accumulation errors over time. Also, cumulative tracking would need to handle scroll direction changes correctly, adding complexity.

### 3. Initial scroll position comparison (Dec 2025 - implemented then reverted)

**Hypothesis:** Store initial scrollTop when entering a container, compute delta as `currentScrollTop - initialScrollTop`, adjust grabOffset by this delta.

**Implementation:** Added `#initialScrollPositions` Map to DragStateService, recorded initial scroll on container entry, applied correction in `#calculatePlaceholderIndex`.

**Why it failed:** The placeholder calculation formula `relativeY = previewCenterY - rect.top + currentScrollTop` already correctly accounts for scroll position. Adding scroll delta correction was double-counting, causing the placeholder to be completely wrong (e.g., showing index 50 when preview was at index 5).

## Working Solution

**Synchronous callback in AutoScrollService** (Dec 2025)

- Use direct property assignment (`element.scrollTop += delta`) instead of `scrollBy()` for guaranteed synchronous behavior
- Call the placeholder recalculation callback immediately in the same frame (no RAF delay)
- No `ngZone.run()` wrapper needed - the callback only writes signals (it enters the zone itself only to emit `dragEnd` when it ends the drag)

```typescript
// In AutoScrollService: #performScroll() scrolls, then #participantTick() calls back in the same tick
element.scrollTop += scrollY;
this.#onScrollCallback?.(); // Immediate, no RAF
```

**Update (Jan 2026):** The forced layout flush was removed after the placeholder/index math was stabilized and E2E
passed across browsers. If a Safari/WebKit regression reappears (e.g. stale hit-testing or drift), consider
re-introducing the flush behind a targeted condition rather than unconditionally on every scroll frame.

**Update (Sep 2026):** The callback moved from `#performScroll()` to `#participantTick()`, after the tick records
the scroll state: the callback may end the drag (a drag whose group disappears is cancelled), and the tick
must not write "scrolling" over the reset of `stopMonitoring()`. Same frame, same order relative to the scroll.

## Key Insights

1. **The placeholder formula is correct as-is.** `relativeY = previewCenterY - rect.top + currentScrollTop` properly converts viewport coordinates to logical list position. Don't add "corrections" to it.

2. **Timing is everything.** The callback must run in the same frame as the scroll, before the next scroll happens. Any async delay (even 1 RAF) causes drift.

3. **Safari's `scrollBy()` may have async behavior** even with `behavior: 'instant'`. Direct property assignment is more reliable.

4. **Angular signals don't need `ngZone.run()`.** Signals work outside zone.js. Wrapping signal updates in `ngZone.run()` is unnecessary overhead.
