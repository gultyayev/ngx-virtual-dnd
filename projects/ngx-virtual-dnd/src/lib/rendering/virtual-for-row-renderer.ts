import {
  EmbeddedViewRef,
  isDevMode,
  TemplateRef,
  untracked,
  ViewContainerRef,
} from '@angular/core';
import type { VirtualForContext } from '../directives/virtual-for.directive';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';
import type { ShiftAnimator } from '../utils/shift-animator';
import { revealDropTargetIn } from '../utils/drop-animator';

/**
 * Represents an item entry in the render queue for virtual scrolling.
 * @internal
 */
export interface RenderEntry<T> {
  type: 'item' | 'placeholder';
  key: unknown;
  context: VirtualForContext<T> | null;
  visualIndex: number;
}

/** What the renderer asks of the `*vdndVirtualFor` that owns it. */
export interface VirtualForRowRendererHost<T> {
  /** Where the rows render */
  readonly viewContainer: ViewContainerRef;
  /** The row template */
  readonly template: TemplateRef<VirtualForContext<T>>;
  /** Whether each row is positioned absolutely at its offset (no viewport lays them out) */
  readonly positionRows: boolean;
  /** Slides displaced rows; a pooled row's animation is cancelled */
  readonly shiftAnimator: ShiftAnimator | null;
  /** The dragged element, if any: a row that holds it is never pooled */
  draggedElement(): HTMLElement | undefined;
  /** Measure a row's root elements (dynamic heights) */
  observe(view: EmbeddedViewRef<VirtualForContext<T>>, key: unknown): void;
  /** Stop measuring a row's root elements */
  unobserve(view: EmbeddedViewRef<VirtualForContext<T>>): void;
}

/** How many views of rows that left stay pooled for rows that come in */
const MAX_POOLED_VIEWS = 10;

/**
 * The rows of a `*vdndVirtualFor`: a view of its template per rendered item, keyed by track key.
 * Its rules:
 * - Identity: a row keeps its view while its track key stays rendered.
 * - Duplicate keys: only the first item with a key renders, with a dev-mode warning.
 * - Order: each row moves to its index in the container.
 * - Checks: only new, pooled and changed rows are checked, with `detectChanges()`.
 * - Recycling (always on): a row that leaves is pooled for a row that comes in. Never one that
 *   holds the dragged element (destroying it cancels the drag) or one a leave animation keeps in
 *   the DOM.
 * - Layout: without a viewport, each row is positioned absolutely at its offset.
 */
export class VirtualForRowRenderer<T> {
  readonly #host: VirtualForRowRendererHost<T>;

  /** Pool of views for reuse */
  readonly #viewPool: EmbeddedViewRef<VirtualForContext<T>>[] = [];

  /** Currently active views keyed by their track-by value */
  readonly #activeViews = new Map<unknown, EmbeddedViewRef<VirtualForContext<T>>>();

  constructor(host: VirtualForRowRendererHost<T>) {
    this.#host = host;
  }

  /** Currently active views keyed by their track-by value */
  get views(): ReadonlyMap<unknown, EmbeddedViewRef<VirtualForContext<T>>> {
    return this.#activeViews;
  }

  /**
   * Reconcile views with the calculated items to render.
   * Moves unused views to pool, updates existing views, creates new views as needed.
   * Without a viewport, the rows at or after the gap move down by its height.
   * Returns the DOM position where placeholder should be inserted.
   */
  render(
    itemsToRender: RenderEntry<T>[],
    strategy: VirtualScrollStrategy,
    gap: { index: number; height: number } | null,
  ): number {
    const viewContainer = this.#host.viewContainer;

    // Determine which keys we need
    const neededKeys = new Set(
      itemsToRender.filter((r) => r.type === 'item').map((item) => item.key),
    );

    // Move unused views to pool
    for (const [key, view] of this.#activeViews) {
      if (!neededKeys.has(key)) {
        this.#activeViews.delete(key);
        this.#poolView(view);
      }
    }

    // Process items and track placeholder position
    let viewContainerIndex = 0;
    let placeholderDomPosition = -1;
    const renderedKeys = new Set<unknown>();
    const changedViews: EmbeddedViewRef<VirtualForContext<T>>[] = [];
    const renderedRows: { view: EmbeddedViewRef<VirtualForContext<T>>; entry: RenderEntry<T> }[] =
      [];

    for (const entry of itemsToRender) {
      if (entry.type === 'placeholder') {
        placeholderDomPosition = viewContainerIndex;
        continue;
      }

      if (renderedKeys.has(entry.key)) {
        this.#warnDuplicateTrackByKey(entry.key);
        continue;
      }
      renderedKeys.add(entry.key);

      const view = this.#getOrCreateView(entry.key, entry.context!, changedViews);

      // Ensure view is at correct position in ViewContainerRef
      const currentIndex = viewContainer.indexOf(view);
      if (currentIndex !== viewContainerIndex) {
        const targetIndex = this.#getSafeViewContainerIndex(currentIndex, viewContainerIndex);
        if (currentIndex >= 0) {
          if (currentIndex !== targetIndex) {
            viewContainer.move(view, targetIndex);
          }
        } else {
          viewContainer.insert(view, targetIndex);
        }
      }

      renderedRows.push({ view, entry });
      viewContainerIndex++;
    }

    this.#renderChangedViews(changedViews);

    // After the check, which creates the root nodes of a row whose root is in a control flow
    // block (`@if`), or replaces them
    for (const { view, entry } of renderedRows) {
      if (view.destroyed) continue;
      // Apply absolute positioning when not using viewport wrapper
      if (this.#host.positionRows) {
        let offset = strategy.getOffsetForIndex(entry.visualIndex);
        if (gap && entry.visualIndex >= gap.index) {
          offset += gap.height;
        }
        this.#applyAbsolutePositioning(view, offset);
      }

      // Observe for dynamic height measurement
      this.#host.observe(view, entry.key);
    }

    this.#trimViewPool();

    return placeholderDomPosition;
  }

  /**
   * The first element of the item view at `viewIndex`, which the placeholder goes before (the
   * render pass counts item views only, so its placeholder position is a view index). Null when
   * the index is past the last view (placeholder belongs at the end → append).
   */
  firstElementOf(viewIndex: number): Element | null {
    const viewContainer = this.#host.viewContainer;
    if (viewIndex < 0 || viewIndex >= viewContainer.length) {
      return null;
    }
    const view = viewContainer.get(viewIndex) as
      | EmbeddedViewRef<VirtualForContext<T>>
      | null
      | undefined;
    if (!view) {
      return null;
    }
    for (const node of view.rootNodes) {
      if (node instanceof HTMLElement) {
        return node;
      }
    }
    return null;
  }

  /** Destroy the pooled and active views. */
  destroy(): void {
    this.#viewPool.forEach((view) => view.destroy());
    this.#activeViews.forEach((view) => view.destroy());
  }

  /**
   * Take a row's view out of the container and pool it. It keeps its element, so its shift
   * animation is cancelled (the item it renders next must not slide from this one's position),
   * and a drop animation that hides it shows it again.
   */
  #poolView(view: EmbeddedViewRef<VirtualForContext<T>>): void {
    const viewContainer = this.#host.viewContainer;
    const index = viewContainer.indexOf(view);
    if (index >= 0) {
      viewContainer.detach(index);
    }
    this.#host.unobserve(view);
    // A leave animation (`animate.leave`) keeps the row in the DOM, and Angular removes it when
    // the animation ends: in the row of another item by then, if the view were reused. A row
    // whose element is dragged (its draggable ID is not its track key) is destroyed too, which
    // cancels the drag instead of handing it to another item.
    const draggedElement = this.#host.draggedElement();
    if (
      view.rootNodes.some(
        (node: Node) =>
          node.parentNode !== null || (!!draggedElement && node.contains(draggedElement)),
      )
    ) {
      view.destroy();
      return;
    }
    this.#cancelShiftAnimation(view);
    revealDropTargetIn(view.rootNodes);
    this.#viewPool.push(view);
  }

  /**
   * Stop any shift animation on a view about to be pooled — a recycled view must not
   * carry an in-flight offset over to the item it renders next.
   */
  #cancelShiftAnimation(view: EmbeddedViewRef<VirtualForContext<T>>): void {
    const shiftAnimator = this.#host.shiftAnimator;
    if (!shiftAnimator) return;

    for (const node of view.rootNodes) {
      if (node instanceof HTMLElement) {
        shiftAnimator.cancel(node);
      }
    }
  }

  /**
   * Clamp target indices for move/insert to avoid out-of-range operations when
   * reconciliation is given invalid duplicate keys or transiently inconsistent view state.
   */
  #getSafeViewContainerIndex(currentIndex: number, requestedIndex: number): number {
    const length = this.#host.viewContainer.length;

    if (currentIndex >= 0) {
      if (length <= 1) return 0;
      return Math.min(requestedIndex, length - 1);
    }

    return Math.min(requestedIndex, length);
  }

  /**
   * Duplicate trackBy keys cannot be reconciled to distinct views.
   * Warn in dev mode and skip duplicates to prevent container corruption.
   */
  #warnDuplicateTrackByKey(key: unknown): void {
    if (isDevMode()) {
      console.warn(
        `[ngx-virtual-dnd] Duplicate trackBy key detected in vdndVirtualFor: ${String(key)}. ` +
          'Skipping duplicate item to avoid view reconciliation errors.',
      );
    }
  }

  /**
   * Get an existing view or create/recycle one from the pool.
   * Adds the view to `changedViews` when it needs rendering: new, taken from the pool, or with a
   * changed context.
   */
  #getOrCreateView(
    key: unknown,
    context: VirtualForContext<T>,
    changedViews: EmbeddedViewRef<VirtualForContext<T>>[],
  ): EmbeddedViewRef<VirtualForContext<T>> {
    const activeView = this.#activeViews.get(key);
    let view = activeView ?? this.#viewPool.pop();

    if (view) {
      // A pooled view was detached, so change detection skipped it: render it even when it
      // comes back with the same context, as what its template shows may have changed since
      if (this.#updateContext(view.context, context) || !activeView) {
        changedViews.push(view);
      }
    } else {
      view = this.#host.template.createEmbeddedView(context);
      changedViews.push(view);
    }
    this.#activeViews.set(key, view);

    return view;
  }

  /** Copy the fields of `next` into `context`. Returns whether any of them changed. */
  #updateContext(context: VirtualForContext<T>, next: VirtualForContext<T>): boolean {
    if (
      Object.is(context.$implicit, next.$implicit) &&
      context.index === next.index &&
      context.first === next.first &&
      context.last === next.last &&
      context.count === next.count
    ) {
      return false;
    }
    context.$implicit = next.$implicit;
    context.index = next.index;
    context.first = next.first;
    context.last = next.last;
    context.count = next.count;
    return true;
  }

  /**
   * Render the views whose context changed, and only those. `markForCheck()` would mark every
   * ancestor view up to the root as well, re-rendering all of them (and every row of the list)
   * on each scroll step. Untracked, so the rows' signal reads do not become the owner's effect's
   * dependencies.
   */
  #renderChangedViews(changedViews: EmbeddedViewRef<VirtualForContext<T>>[]): void {
    if (changedViews.length === 0) return;
    untracked(() => {
      for (const view of changedViews) {
        if (!view.destroyed) {
          view.detectChanges();
        }
      }
    });
  }

  /**
   * Apply absolute positioning styles to a view's root nodes.
   */
  #applyAbsolutePositioning(view: EmbeddedViewRef<VirtualForContext<T>>, topOffset: number): void {
    for (const node of view.rootNodes) {
      if (node instanceof HTMLElement) {
        node.style.position = 'absolute';
        node.style.top = `${topOffset}px`;
        node.style.left = '0';
        node.style.right = '0';
      }
    }
  }

  /**
   * Trim the view pool to prevent memory bloat, keeping a reasonable buffer.
   */
  #trimViewPool(): void {
    while (this.#viewPool.length > MAX_POOLED_VIEWS) {
      const view = this.#viewPool.pop();
      view?.destroy();
    }
  }
}
