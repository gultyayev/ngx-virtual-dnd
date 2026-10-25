import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';
import {
  type ItemIndex,
  insertionToPlaceholderIndex,
  type PlaceholderIndex,
} from './index-semantics';

/**
 * Where the placeholder goes for a preview over a list: the numbers only. The caller measures the
 * list (`DragIndexCalculatorService`); see `.claude/history/placeholder-algorithm.md` for why the
 * probe works as it does.
 */
export interface PlaceholderProbe {
  /** Viewport Y of the preview's top (cursor minus grab offset) */
  previewTopY: number;
  /** The preview's height */
  previewHeight: number;
  /** The list's row height: configured, or the dragged item's */
  itemHeight: number;
  /** Viewport Y of the element the rows scroll in */
  listTopY: number;
  /** How far the rows are scrolled (see `DroppableScrollGeometry.scrollTop`) */
  scrollTop: number;
  /** The list's strategy, if it registered one: exact offsets for variable heights */
  strategy: VirtualScrollStrategy | null;
  /** The dragged item's index when the list is its source list, otherwise null */
  sourceIndex: ItemIndex | null;
}

/**
 * The placeholder index under a preview, before the list's edges are taken into account (snapping
 * to the end, the clamp to the item count).
 */
export function probePlaceholderIndex(probe: PlaceholderProbe): PlaceholderIndex {
  const { previewTopY, previewHeight, itemHeight, listTopY, scrollTop, strategy, sourceIndex } =
    probe;

  // Capped center probe: use preview center but limit how deep the probe reaches.
  // The cap prevents a tall preview (e.g. 120px among 60px items) from overshooting
  // multiple positions — the center would land 2+ items away, but the cap keeps it
  // within one item of the top edge.
  const previewCenterY = previewTopY + previewHeight / 2;
  const probeY = Math.min(previewCenterY, previewTopY + itemHeight / 2);
  // Row offsets (from the first row) of the probe and the preview's top
  const probeOffset = probeY - listTopY + scrollTop;
  const previewTopOffset = previewTopY - listTopY + scrollTop;

  // The slot under the probe. Rows render without the hidden source, so a slot counted from them
  // is an insertion index. A strategy that excludes the source maps its offsets back onto the
  // list as it is, so its slot is a placeholder index already.
  let probedIndex: number;
  if (strategy) {
    probedIndex = strategy.findIndexAtOffset(probeOffset);

    // Midpoint refinement for variable heights:
    // Only advance past an item when the preview top has crossed its midpoint.
    // Without this, a short preview entering a tall item's range triggers
    // displacement at ~20% overlap, which looks like unnatural overlapping.
    const targetTop = strategy.getOffsetForIndex(probedIndex);
    const targetBottom = strategy.getOffsetForIndex(probedIndex + 1);
    if (previewTopOffset >= (targetTop + targetBottom) / 2) {
      probedIndex += 1;
    }
  } else {
    // Fixed height: simple division
    probedIndex = Math.floor(probeOffset / itemHeight);
  }

  // Count the hidden source in, unless the strategy has excluded it already (it has not in the
  // first frames of a drag, and then counts its slots without the source too)
  const placeholderIndex = insertionToPlaceholderIndex(
    probedIndex,
    sourceIndex,
    sourceIndex !== null,
  );
  if (
    placeholderIndex !== probedIndex &&
    strategy &&
    sourceIndex !== null &&
    isSourceIndexExcluded(strategy, sourceIndex)
  ) {
    return probedIndex;
  }
  return placeholderIndex;
}

/**
 * Detect whether a strategy has already excluded the source index.
 *
 * With exclusion applied, the source slot collapses in visual space:
 * offset(sourceIndex + 1) <= offset(sourceIndex). Without exclusion,
 * the next offset is strictly greater.
 */
function isSourceIndexExcluded(strategy: VirtualScrollStrategy, sourceIndex: ItemIndex): boolean {
  if (sourceIndex < 0) {
    return false;
  }

  const sourceOffset = strategy.getOffsetForIndex(sourceIndex);
  const nextOffset = strategy.getOffsetForIndex(sourceIndex + 1);

  return nextOffset <= sourceOffset;
}
