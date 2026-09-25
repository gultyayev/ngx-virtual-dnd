import { inject, Injectable } from '@angular/core';
import { type CursorPosition, END_OF_LIST, type GrabOffset } from '../models/drag-drop.models';
import { PositionCalculatorService } from './position-calculator.service';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';

interface DroppableCache {
  droppableId: string | null;
  containerType: 'viewport' | 'virtualScroll' | 'virtualContent' | 'fallback';
  scrollContainer: HTMLElement;
  virtualScrollElement: HTMLElement | null;
  virtualContentElement: HTMLElement | null;
  scrollableParent: HTMLElement | null;
  itemHeight: number;
  isConstrainedToContainer: boolean;
  strategy: VirtualScrollStrategy | null;
}

/** Where a droppable's rows are, relative to the element they scroll in. */
export interface DroppableScrollGeometry {
  /** Viewport rect of the element the rows scroll in */
  rect: DOMRect;
  /**
   * How far the rows are scrolled: a row's offset from the first row (as in
   * `VirtualScrollStrategy.getOffsetForIndex`) is `rowTop - rect.top + scrollTop`. Space reserved
   * above the rows (`contentOffset`) is already subtracted.
   */
  scrollTop: number;
  /**
   * Whether the container virtualizes its rows itself (`vdnd-virtual-scroll`,
   * `vdnd-virtual-content`), so a row's index can't be counted from the rows before it. A
   * viewport's rows are virtualized by `*vdndVirtualFor`, which registers a strategy.
   */
  isVirtual: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class DragIndexCalculatorService {
  readonly #positionCalculator = inject(PositionCalculatorService);

  /** Registered strategies by droppable ID */
  readonly #strategies = new Map<string, VirtualScrollStrategy>();

  /** Cached droppable metadata to avoid repeated DOM queries during drag */
  readonly #droppableCache = new Map<HTMLElement, DroppableCache>();

  /**
   * Register a virtual scroll strategy for a droppable.
   * Used by virtual scroll components to provide dynamic height lookups.
   */
  registerStrategy(droppableId: string, strategy: VirtualScrollStrategy): void {
    this.#strategies.set(droppableId, strategy);
  }

  /**
   * Unregister a strategy when the droppable is destroyed.
   */
  unregisterStrategy(droppableId: string): void {
    this.#strategies.delete(droppableId);
  }

  /**
   * Get the registered strategy for a droppable ID.
   * Used by draggable to calculate source index with variable heights.
   */
  getStrategyForDroppable(droppableId: string): VirtualScrollStrategy | undefined {
    return this.#strategies.get(droppableId);
  }

  clearCache(): void {
    this.#droppableCache.clear();
  }

  #resolveDroppable(droppableElement: HTMLElement, draggedItemHeight: number): DroppableCache {
    const cached = this.#droppableCache.get(droppableElement);
    if (cached) return cached;

    const isViewport = droppableElement.hasAttribute('data-virtual-viewport');
    const virtualScrollElement = droppableElement.querySelector(
      'vdnd-virtual-scroll',
    ) as HTMLElement | null;
    const virtualContentElement = (
      droppableElement.matches('vdnd-virtual-content')
        ? droppableElement
        : droppableElement.closest('vdnd-virtual-content')
    ) as HTMLElement | null;

    let containerType: DroppableCache['containerType'];
    let scrollContainer: HTMLElement;
    let scrollableParent: HTMLElement | null = null;

    if (isViewport) {
      // The viewport scrolls its own rows. Checked first so a list nested in a row is not
      // mistaken for this one.
      containerType = 'viewport';
      scrollContainer = droppableElement;
    } else if (virtualScrollElement) {
      containerType = 'virtualScroll';
      scrollContainer = virtualScrollElement;
    } else if (virtualContentElement) {
      containerType = 'virtualContent';
      scrollableParent = virtualContentElement.closest('.vdnd-scrollable') as HTMLElement | null;
      scrollContainer = scrollableParent ?? virtualContentElement;
    } else {
      containerType = 'fallback';
      scrollContainer = droppableElement;
    }

    const droppableId = this.#positionCalculator.getDroppableId(droppableElement);
    const strategy = (droppableId ? this.#strategies.get(droppableId) : null) ?? null;

    const configuredHeight =
      virtualScrollElement?.getAttribute('data-item-height') ??
      virtualContentElement?.getAttribute('data-item-height');
    const parsedHeight = configuredHeight ? parseFloat(configuredHeight) : Number.NaN;
    const itemHeight = Number.isFinite(parsedHeight)
      ? parsedHeight
      : this.#getDraggedItemHeightFallback(draggedItemHeight, 50);

    const isConstrainedToContainer = droppableElement.hasAttribute('data-constrain-to-container');

    const entry: DroppableCache = {
      droppableId,
      containerType,
      scrollContainer,
      virtualScrollElement,
      virtualContentElement,
      scrollableParent,
      itemHeight,
      isConstrainedToContainer,
      strategy,
    };

    this.#droppableCache.set(droppableElement, entry);
    return entry;
  }

  getTotalItemCount(args: {
    droppableElement: HTMLElement;
    isSameList: boolean;
    draggedItemHeight: number;
  }): number {
    return this.#getTotalItemCount(args.droppableElement, args.isSameList, args.draggedItemHeight);
  }

  /**
   * Live scroll geometry of a droppable's rows (see {@link DroppableScrollGeometry}). The same
   * measurement places the placeholder and finds the dragged item's source index.
   */
  getScrollGeometry(
    droppableElement: HTMLElement,
    draggedItemHeight: number,
  ): DroppableScrollGeometry {
    return this.#getScrollGeometry(this.#resolveDroppable(droppableElement, draggedItemHeight));
  }

  calculatePlaceholderIndex(args: {
    droppableElement: HTMLElement;
    position: CursorPosition;
    /**
     * Unused: the index probe is direction-independent (capped center + midpoint refinement).
     * Kept so callers don't change.
     */
    previousPosition: CursorPosition | null;
    grabOffset: GrabOffset | null;
    draggedItemHeight: number;
    sourceDroppableId: string | null;
    sourceIndex: number | null;
  }): { index: number; placeholderId: string } {
    const {
      droppableElement,
      position,
      grabOffset,
      draggedItemHeight,
      sourceDroppableId,
      sourceIndex,
    } = args;

    // Resolve cached metadata (DOM queries run once per droppable per drag session)
    const cache = this.#resolveDroppable(droppableElement, draggedItemHeight);

    // Live reads: getBoundingClientRect() and scrollTop change during scroll
    const { rect, scrollTop: currentScrollTop } = this.#getScrollGeometry(cache);

    const {
      strategy,
      itemHeight,
      droppableId: currentDroppableId,
      isConstrainedToContainer,
    } = cache;

    // Calculate preview center position mathematically
    // The preview is positioned at: cursorPosition - grabOffset (see drag-preview.component.ts)
    // So preview center = cursorPosition.y - grabOffset.y + previewHeight/2
    // Using math avoids Safari's stale getBoundingClientRect() issue during autoscroll
    // Use actual dragged item height when available (important for dynamic heights)
    const previewHeight = this.#getDraggedItemHeightFallback(draggedItemHeight, itemHeight);
    const previewTopY = position.y - (grabOffset?.y ?? 0);
    const previewBottomY = previewTopY + previewHeight;
    const previewCenterY = previewTopY + previewHeight / 2;

    // Capped center probe: use preview center but limit how deep the probe reaches.
    // The cap prevents a tall preview (e.g. 120px among 60px items) from overshooting
    // multiple positions — the center would land 2+ items away, but the cap keeps it
    // within one item of the top edge.
    const indexProbeY = Math.min(previewCenterY, previewTopY + itemHeight / 2);

    // Convert to visual index
    const relativeY = indexProbeY - rect.top + currentScrollTop;

    // Determine same-list drag info before strategy branch
    const isSameList = sourceDroppableId !== null && sourceDroppableId === currentDroppableId;
    const sourceIndexValue = isSameList ? (sourceIndex ?? -1) : -1;

    let visualIndex: number;
    if (strategy) {
      visualIndex = strategy.findIndexAtOffset(relativeY);

      // Midpoint refinement for variable heights:
      // Only advance past an item when the preview top has crossed its midpoint.
      // Without this, a short preview entering a tall item's range triggers
      // displacement at ~20% overlap, which looks like unnatural overlapping.
      const topRelativeY = previewTopY - rect.top + currentScrollTop;
      const targetTop = strategy.getOffsetForIndex(visualIndex);
      const targetBottom = strategy.getOffsetForIndex(visualIndex + 1);
      const targetMidpoint = (targetTop + targetBottom) / 2;
      if (topRelativeY >= targetMidpoint) {
        visualIndex += 1;
      }
    } else {
      // Fixed height: simple division
      visualIndex = Math.floor(relativeY / itemHeight);
    }

    // Same-list +1 adjustment:
    // - No strategy: always adjust when visual index is at/after source
    // - Strategy: adjust only if exclusion has not been applied yet
    //   (prevents an off-by-one window during early drag updates)
    let placeholderIndex = visualIndex;
    if (isSameList && sourceIndexValue >= 0 && visualIndex >= sourceIndexValue) {
      const needsAdjustment = !strategy || !this.#isSourceIndexExcluded(strategy, sourceIndexValue);
      if (needsAdjustment) {
        placeholderIndex = visualIndex + 1;
      }
    }

    // Get total items using cached strategy to avoid duplicate DOM queries
    let totalItems: number;
    const cachedItemCount = strategy?.getItemCount();
    if (cachedItemCount !== undefined && Number.isFinite(cachedItemCount)) {
      totalItems = Math.max(0, cachedItemCount);
    } else {
      totalItems = this.#getTotalItemCount(droppableElement, isSameList, draggedItemHeight);
    }

    // Edge detection: allow dropping at the END of the list when cursor is near bottom edge.
    // Due to max scroll limits, the math alone can't reach totalItems when the list is longer
    // than the viewport. If cursor is in the bottom portion of the container and we're at
    // or past the last visible slot, snap to totalItems.
    const cursorRelativeToBottom = rect.bottom - previewCenterY;
    const isNearBottomEdge = cursorRelativeToBottom < itemHeight;
    if (isNearBottomEdge && placeholderIndex >= totalItems - 1) {
      placeholderIndex = totalItems;
    }

    // When the preview is constrained to the container bounds, large dragged items can
    // cover the first/last slots while their center never reaches them. Snap to edges
    // using preview bounds so top/bottom drops remain reachable.
    if (isConstrainedToContainer) {
      const droppableRect = droppableElement.getBoundingClientRect();
      const edgeTolerance = 2;
      const distanceToTop = Math.abs(previewTopY - droppableRect.top);
      const distanceToBottom = Math.abs(droppableRect.bottom - previewBottomY);

      if (distanceToTop <= edgeTolerance && distanceToTop <= distanceToBottom) {
        placeholderIndex = 0;
      } else if (distanceToBottom <= edgeTolerance) {
        placeholderIndex = totalItems;
      }
    }

    // Clamp to valid range
    placeholderIndex = Math.max(0, Math.min(placeholderIndex, totalItems));

    return { index: placeholderIndex, placeholderId: END_OF_LIST };
  }

  #getScrollGeometry(cache: DroppableCache): DroppableScrollGeometry {
    const { containerType, scrollContainer } = cache;
    const rect = scrollContainer.getBoundingClientRect();
    const isVirtual = containerType === 'virtualScroll' || containerType === 'virtualContent';

    switch (containerType) {
      case 'viewport':
        return {
          rect,
          scrollTop: scrollContainer.scrollTop - this.#readContentOffset(scrollContainer),
          isVirtual,
        };
      case 'virtualContent':
        // Without a vdndScrollable parent the content element itself is measured, unscrolled
        return cache.scrollableParent
          ? {
              rect,
              scrollTop:
                scrollContainer.scrollTop - this.#readContentOffset(cache.virtualContentElement),
              isVirtual,
            }
          : { rect, scrollTop: 0, isVirtual };
      default:
        return { rect, scrollTop: scrollContainer.scrollTop, isVirtual };
    }
  }

  /** The `data-content-offset` (px reserved above the rows) of a virtual container, or 0. */
  #readContentOffset(element: HTMLElement | null): number {
    const offset = parseFloat(element?.getAttribute('data-content-offset') ?? '');
    return Number.isFinite(offset) ? offset : 0;
  }

  #getTotalItemCount(
    droppableElement: HTMLElement,
    isSameList: boolean,
    draggedItemHeight: number,
  ): number {
    // Check if a registered strategy exists
    const droppableId = this.#positionCalculator.getDroppableId(droppableElement);
    const strategy = droppableId ? this.#strategies.get(droppableId) : null;
    const strategyItemCount = strategy?.getItemCount();
    if (strategyItemCount !== undefined && Number.isFinite(strategyItemCount)) {
      return Math.max(0, strategyItemCount);
    }

    // Check for embedded virtual scroll component
    const virtualScroll = droppableElement.querySelector('vdnd-virtual-scroll');
    if (virtualScroll) {
      // Use data-total-items attribute if available (always the true N)
      const totalItemsAttr = virtualScroll.getAttribute('data-total-items');
      if (totalItemsAttr) {
        const count = parseInt(totalItemsAttr, 10);
        if (Number.isFinite(count)) {
          return count;
        }
      }

      // Fallback: Use the spacer's height, NOT scrollHeight, to determine item count.
      // scrollHeight can be inflated by absolutely-positioned elements like the placeholder.
      const spacer = virtualScroll.querySelector(
        '.vdnd-virtual-scroll-spacer',
      ) as HTMLElement | null;
      const configuredHeight = virtualScroll.getAttribute('data-item-height');
      const itemHeight = configuredHeight
        ? parseInt(configuredHeight, 10)
        : this.#getDraggedItemHeightFallback(draggedItemHeight, 50);

      let totalHeight: number;
      if (spacer) {
        // Get the spacer's explicit height (set via Angular binding)
        totalHeight = parseFloat(spacer.style.height) || 0;
      } else {
        // Fallback: use scrollHeight if spacer not found
        totalHeight = (virtualScroll as HTMLElement).scrollHeight;
      }

      // When strategy exists, spacer height already accounts for exclusion.
      // Don't apply same-list +1 adjustment — strategy handles it.
      if (strategy) {
        const count = Math.round(totalHeight / itemHeight);
        return count;
      }

      // Spacer height reflects full N items (getTotalHeight no longer excludes)
      const count = Math.floor(totalHeight / itemHeight);
      return count;
    }

    // Check for page-level scroll (vdnd-virtual-content)
    const virtualContent = droppableElement.matches('vdnd-virtual-content')
      ? droppableElement
      : droppableElement.closest('vdnd-virtual-content');
    if (virtualContent) {
      // Prefer explicit total items attribute (works for both fixed and dynamic heights)
      const totalItemsAttr = (virtualContent as HTMLElement).getAttribute('data-total-items');
      if (totalItemsAttr) {
        const count = parseInt(totalItemsAttr, 10);
        if (Number.isFinite(count)) {
          // data-total-items is the true total N (derived from strategy item count)
          return count;
        }
      }

      // Fallback: use spacer height to determine total items
      const spacer = virtualContent.querySelector('.vdnd-content-spacer') as HTMLElement | null;
      if (spacer) {
        const totalHeight = parseFloat(spacer.style.height) || 0;
        const configuredHeight = virtualContent.getAttribute('data-item-height');
        const itemHeight = configuredHeight
          ? parseInt(configuredHeight, 10)
          : this.#getDraggedItemHeightFallback(draggedItemHeight, 72);
        return Math.floor(totalHeight / itemHeight);
      }
    }

    // Fallback for non-virtual scroll — querySelectorAll finds all N items
    // (including the hidden dragged item), so no adjustment needed
    const items = droppableElement.querySelectorAll('[data-draggable-id]');
    return items.length;
  }

  #getDraggedItemHeightFallback(height: number, fallback: number): number {
    return Number.isFinite(height) && height > 0 ? height : fallback;
  }

  /**
   * Detect whether a strategy has already excluded the source index.
   *
   * With exclusion applied, the source slot collapses in visual space:
   * offset(sourceIndex + 1) <= offset(sourceIndex). Without exclusion,
   * the next offset is strictly greater.
   */
  #isSourceIndexExcluded(strategy: VirtualScrollStrategy, sourceIndex: number): boolean {
    if (sourceIndex < 0) {
      return false;
    }

    const sourceOffset = strategy.getOffsetForIndex(sourceIndex);
    const nextOffset = strategy.getOffsetForIndex(sourceIndex + 1);

    return nextOffset <= sourceOffset;
  }
}
