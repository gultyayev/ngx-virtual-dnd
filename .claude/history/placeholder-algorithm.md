# Placeholder Index Algorithm — Detailed Design

This document covers the internals of `DragIndexCalculatorService`'s placeholder index calculation. Read this before modifying placeholder behavior.

## Capped Center Probe + Midpoint Refinement

The placeholder index probe uses two complementary mechanisms for dynamic heights:

### Capped Center Probe

`min(center, top + itemHeight/2)` limits how deep the probe reaches. Prevents a tall preview (e.g. 120px among 60px items) from overshooting multiple positions — the center would land 2+ items away, but the cap keeps it within one item of the top edge.

### Midpoint Refinement (Strategy Path Only)

After `findIndexAtOffset` returns an index, checks whether the preview's top edge has passed the target item's midpoint. Only then advances `visualIndex` by 1. Prevents a short preview (e.g. 60px entering a 150px item) from triggering displacement at ~20% overlap — displacement now requires 50% of the target item's actual height.

### Why Both Are Needed

These solve opposite directions of the height mismatch:

- The cap pulls the probe **up** (tall preview → short items)
- Midpoint pushes the index **down** (short preview → tall items)
- Removing either breaks the other's scenario

### Fixed-Height Path

Uses `Math.floor(relativeY / itemHeight)` directly (no refinement needed since all items are the same height).

### Constrained Mode

`constrainToContainer` uses the same capped center probe and midpoint refinement as unconstrained mode. Edge snapping overrides the index to 0 or totalItems when the preview bounds are within 2px of the droppable container edges (needed because clamping prevents the probe from reaching the first/last slot for tall items) — but only when the scroll container can't scroll further that way (`scrollTop` within 1px of 0 for the top, of `scrollHeight - clientHeight` for the bottom). The preview is pinned at an edge whenever the pointer goes past it, which is how a constrained drag autoscrolls, and the 2px tolerance also catches a card grabbed far from its top outside the autoscroll band. Snapping there regardless of scroll dropped the item at the start/end of a list scrolled far from it (#112); instead the probe's index (the visible edge row) stays until the list reaches that end. Page-scroll content (`vdnd-virtual-content`) skips the scroll check: its droppable rect spans all of its rows.

## Same-List Adjustment

When dragging within the same list, apply +1 adjustment when `visualIndex >= sourceIndex` to compensate for the hidden item.

## Virtual Scroll Integration

During same-list drag, the strategy's excluded index (`setExcludedIndex`) closes up the offsets after the dragged item, which is why `#isSourceIndexExcluded` skips the +1 adjustment once exclusion is applied. The total height keeps all N items, and `getTotalItemCount()` returns the logical N (strategy item count or `data-total-items`).

## Reading State After the Drag Ends

The live drag state is reset the moment the drag ends. `DragStateService.endDrag()` / `cancelDrag()` capture `endedDragState()` immediately before the reset, so code that runs after the end (the drop animation, for example) reads that instead of caching snapshots in effects. The drop itself needs no read: `endDrag()` passes the ended state to the target droppable's registered handler:

```typescript
#handleDrop(state: DragState): boolean {
  // state is endedDragState(): the final placeholderIndex, activeDroppableId, ...
}
```
