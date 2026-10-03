import {
  afterEveryRender,
  computed,
  Directive,
  effect,
  ElementRef,
  EmbeddedViewRef,
  inject,
  Injector,
  input,
  isDevMode,
  NgZone,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  TemplateRef,
  untracked,
  ViewContainerRef,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { VDND_SCROLL_CONTAINER } from '../tokens/scroll-container.token';
import { VDND_OFFSET_ROWS_VIEWPORT, VDND_VIRTUAL_VIEWPORT } from '../tokens/virtual-viewport.token';
import { DragStateService } from '../services/drag-state.service';
import { DragIndexCalculatorService } from '../services/drag-index-calculator.service';
import { DroppableDirective } from './droppable.directive';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';
import { FixedHeightStrategy } from '../strategies/fixed-height.strategy';
import { DynamicHeightStrategy } from '../strategies/dynamic-height.strategy';
import { setStrategyItems } from '../strategies/strategy-items';
import { VDND_ANIMATION_CONFIG } from '../tokens/animation-config.token';
import { ShiftAnimationEntry, ShiftAnimator } from '../utils/shift-animator';
import { revealDropTargetIn } from '../utils/drop-animator';

/**
 * Context provided to the template for each virtual item.
 */
export interface VirtualForContext<T> {
  /** The item data (also available as implicit context) */
  $implicit: T;
  /** The item's index in the original array */
  index: number;
  /** Whether this is the first visible item */
  first: boolean;
  /** Whether this is the last visible item */
  last: boolean;
  /** Count of total items */
  count: number;
}

/**
 * Scroll containers given `position: relative` by a `*vdndVirtualFor`: the directives that rely on
 * it, and the inline position to restore once the last of them is destroyed.
 */
const positionedScrollContainers = new WeakMap<HTMLElement, { users: number; saved: string }>();

/** Whether an element (in the page) is positioned: a containing block for absolute children. */
function isPositioned(element: HTMLElement): boolean {
  const position = getComputedStyle(element).position;
  return position !== '' && position !== 'static';
}

/** Render-queue key of the placeholder entry */
const PLACEHOLDER_KEY = '__placeholder__';

/**
 * Represents an item entry in the render queue for virtual scrolling.
 * @internal
 */
interface RenderEntry<T> {
  type: 'item' | 'placeholder';
  key: unknown;
  context: VirtualForContext<T> | null;
  visualIndex: number;
}

/**
 * A structural directive for virtual scrolling within custom scroll containers.
 * Provides maximum flexibility for advanced use cases where the component wrapper
 * is not suitable.
 *
 * The directive must be placed inside `<vdnd-virtual-viewport>`, `<vdnd-virtual-content>` or an
 * element marked with the `vdndScrollable` directive, which provide the scroll container context
 * via dependency injection.
 *
 * The directive renders the drag placeholder itself; consumers just render their items normally.
 * Inside a viewport component the rows and the placeholder are laid out in the flow. Directly in
 * a `vdndScrollable` element, each row and the placeholder are positioned absolutely at their
 * offset (the rows after the placeholder move down by its height), so the scroll container must
 * be their containing block: when neither it nor an element between it and the rows is
 * positioned, the directive gives it `position: relative`.
 *
 * @example
 * Inside a viewport component (itemHeight and droppableId inherited automatically):
 * ```html
 * <vdnd-virtual-viewport [itemHeight]="50" style="height: 400px">
 *   <ng-container *vdndVirtualFor="let item of items(); trackBy: trackById">
 *     <div class="item">{{ item.name }}</div>
 *   </ng-container>
 * </vdnd-virtual-viewport>
 * ```
 *
 * @example
 * Standalone usage (itemHeight required):
 * ```html
 * <div vdndScrollable style="overflow: auto; height: 400px">
 *   <ng-container *vdndVirtualFor="let item of items(); itemHeight: 50; trackBy: trackById">
 *     <div class="item">{{ item.name }}</div>
 *   </ng-container>
 * </div>
 * ```
 */
@Directive({
  selector: '[vdndVirtualFor][vdndVirtualForOf]',
})
export class VirtualForDirective<T> implements OnInit, OnDestroy {
  readonly #templateRef = inject(TemplateRef<VirtualForContext<T>>);
  readonly #viewContainer = inject(ViewContainerRef);
  readonly #elementRef = inject(ElementRef<Comment>);
  readonly #scrollContainer = inject(VDND_SCROLL_CONTAINER);
  readonly #injector = inject(Injector);
  readonly #ngZone = inject(NgZone);
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly #dragState = inject(DragStateService);
  readonly #dragIndexCalculator = inject(DragIndexCalculatorService);

  /**
   * Optional viewport component that provides wrapper-based positioning.
   * When inside a viewport, items are positioned via the wrapper's transform,
   * so we skip individual absolute positioning.
   */
  readonly #viewport = inject(VDND_VIRTUAL_VIEWPORT, { optional: true });

  /** A vdnd-virtual-viewport, whose rows start contentOffset px down (see #rowsScrollTop) */
  readonly #offsetRowsViewport = inject(VDND_OFFSET_ROWS_VIEWPORT, { optional: true });

  /**
   * Optional parent droppable directive.
   * When present, droppableId is inherited automatically.
   */
  readonly #droppable = inject(DroppableDirective, { optional: true });

  /** Slides items displaced by the placeholder (only when VDND_ANIMATION_CONFIG is provided) */
  readonly #shiftAnimator = this.#createShiftAnimator();

  /** Whether we're inside a viewport component (use wrapper positioning) */
  readonly #useViewportPositioning = this.#viewport !== null;

  /** Pool of views for reuse */
  readonly #viewPool: EmbeddedViewRef<VirtualForContext<T>>[] = [];

  /** Currently active views keyed by their track-by value */
  readonly #activeViews = new Map<unknown, EmbeddedViewRef<VirtualForContext<T>>>();

  /** Single spacer element for scroll height */
  #spacer: HTMLDivElement | null = null;

  /** Placeholder element for drag operations */
  #placeholder: HTMLDivElement | null = null;

  /** Whether placeholder is currently in the DOM */
  #placeholderInDom = false;

  /** Whether this directive counts as a user of the position it set on the scroll container */
  #usesScrollContainerPosition = false;

  /** ResizeObserver for dynamic height measurement */
  #resizeObserver: ResizeObserver | null = null;

  /** Map from observed HTMLElement to its trackBy key (reset with each new observer) */
  #observedElements = new WeakMap<HTMLElement, unknown>();

  // ========== Inputs ==========

  /** The array of items to iterate over */
  vdndVirtualForOf = input.required<T[]>();

  /**
   * Height of each item in pixels (used as estimate in dynamic mode).
   * Optional when inside a viewport component — inherited from the viewport's strategy.
   */
  vdndVirtualForItemHeight = input<number>();

  /** Track-by function for efficient updates */
  vdndVirtualForTrackBy = input.required<(index: number, item: T) => unknown>();

  /** Number of items to render outside the visible area */
  vdndVirtualForOverscan = input<number>(3);

  /**
   * ID of the droppable this directive belongs to.
   * Required for placeholder positioning during drag operations.
   */
  vdndVirtualForDroppableId = input<string>();

  /**
   * Enable dynamic item height mode.
   * When true, items are auto-measured via ResizeObserver and `itemHeight`
   * serves as the initial estimate for unmeasured items.
   */
  vdndVirtualForDynamicItemHeight = input<boolean>(false);

  // ========== Resolved Values ==========

  /**
   * Effective droppable ID — uses explicit input or inherits from parent DroppableDirective.
   */
  readonly #effectiveDroppableId = computed(() => {
    return this.vdndVirtualForDroppableId() ?? this.#droppable?.vdndDroppable() ?? undefined;
  });

  // ========== Strategy ==========

  /**
   * The virtual scroll strategy.
   * If inside a viewport that has a strategy, use that. Otherwise create our own.
   */
  readonly #strategy = computed<VirtualScrollStrategy>(() => {
    // If viewport provides a strategy, use it (shared state for drag-drop)
    const viewportStrategy = this.#viewport?.strategy;
    if (viewportStrategy) return viewportStrategy;

    // Create our own strategy (standalone mode — itemHeight is required)
    const height = this.vdndVirtualForItemHeight();
    if (height === undefined) {
      if (isDevMode()) {
        console.warn(
          '[ngx-virtual-dnd] vdndVirtualFor requires itemHeight when not inside a viewport component ' +
            '(vdnd-virtual-viewport or vdnd-virtual-content). Falling back to 50px.',
        );
      }
      return new FixedHeightStrategy(50);
    }
    return this.vdndVirtualForDynamicItemHeight()
      ? new DynamicHeightStrategy(height)
      : new FixedHeightStrategy(height);
  });

  // ========== Placeholder Computed Values ==========

  /** Whether the placeholder should be shown in this container */
  readonly #shouldShowPlaceholder = computed(() => {
    const droppableId = this.#effectiveDroppableId();
    if (!droppableId) return false;
    if (!this.#dragState.isDragging()) return false;
    return this.#dragState.activeDroppableId() === droppableId;
  });

  /** The placeholder index when placeholder should be shown */
  readonly #placeholderIndex = computed(() => {
    if (!this.#shouldShowPlaceholder()) return -1;
    return this.#dragState.placeholderIndex() ?? -1;
  });

  // ========== Computed Values ==========

  /** First visible item index */
  readonly #firstVisibleIndex = computed(() => {
    const strategy = this.#strategy();
    // Read version to subscribe to dynamic height changes
    strategy.version();
    return strategy.getFirstVisibleIndex(this.#rowsScrollTop());
  });

  /**
   * How far the rows are scrolled. A vdnd-virtual-viewport's rows start contentOffset px down its
   * scroll area, but its scrollTop() is the raw position (scrollBy() relies on it), so subtract the
   * offset here. vdnd-virtual-content's scrollTop() already excludes its offset.
   */
  #rowsScrollTop(): number {
    const scrollTop = this.#scrollContainer.scrollTop();
    const viewport = this.#viewport;
    if (viewport === null || viewport !== this.#offsetRowsViewport) {
      return scrollTop;
    }
    return Math.max(0, scrollTop - viewport.contentOffset());
  }

  /** Number of visible items */
  readonly #visibleCount = computed(() => {
    const height = this.#scrollContainer.containerHeight();
    const strategy = this.#strategy();
    strategy.version();
    const startIndex = this.#firstVisibleIndex();
    return strategy.getVisibleCount(startIndex, height);
  });

  /** Range of items to render */
  readonly #renderRange = computed(() => {
    const first = this.#firstVisibleIndex();
    const visible = this.#visibleCount();
    const overscan = this.vdndVirtualForOverscan();
    const total = this.vdndVirtualForOf().length;

    const start = Math.max(0, first - overscan);
    const end = Math.min(total - 1, first + visible + overscan);

    return { start, end };
  });

  /**
   * Every item's track key, in order. Computed once per items change, and only when something
   * reads it: a dynamic-height strategy or a drag. A fixed-height strategy needs only the count.
   */
  readonly #itemKeys = computed(() => {
    const trackByFn = this.vdndVirtualForTrackBy();
    return this.vdndVirtualForOf().map((item, i) => trackByFn(i, item));
  });

  /**
   * Index of the dragged item in this list (-1 if not present or not dragging). The index where
   * the drag found its item is checked first: it spares a search of every track key.
   */
  readonly #draggedItemIndex = computed(() => {
    const draggedItem = this.#dragState.draggedItem();
    if (!draggedItem) return -1;

    const items = this.vdndVirtualForOf();
    const sourceIndex = this.#dragState.sourceIndex();
    if (sourceIndex !== null && sourceIndex >= 0 && sourceIndex < items.length) {
      const item = items[sourceIndex];
      if (
        this.vdndVirtualForTrackBy()(sourceIndex, item) === draggedItem.draggableId ||
        (draggedItem.data !== null && draggedItem.data !== undefined && item === draggedItem.data)
      ) {
        return sourceIndex;
      }
    }

    // The last item with the key, as an index map filled in order would give
    const byId = this.#itemKeys().lastIndexOf(draggedItem.draggableId);
    if (byId >= 0) {
      return byId;
    }

    const data = draggedItem.data as T | null | undefined;
    if (data !== null && data !== undefined) {
      return items.indexOf(data);
    }

    return -1;
  });

  /**
   * Index of the dragged item while the strategy excludes it (a drag from this list), else -1.
   * Only the source list looks for the dragged item (in all its keys).
   */
  readonly #excludedDraggedIndex = computed(() => {
    const droppableId = this.#effectiveDroppableId();
    const isSourceList =
      this.#dragState.isDragging() &&
      droppableId !== undefined &&
      droppableId === this.#dragState.sourceDroppableId();
    return isSourceList ? this.#draggedItemIndex() : -1;
  });

  constructor() {
    // Keep the strategy's items in sync. A fixed-height strategy needs only their count, which
    // spares computing every item's track key on each items change (each drop).
    effect(() => {
      setStrategyItems(this.#strategy(), this.vdndVirtualForOf().length, () => this.#itemKeys());
    });

    // Register strategy with drag index calculator for accurate position lookups
    effect((onCleanup) => {
      const droppableId = this.#effectiveDroppableId();
      const strategy = this.#strategy();
      if (droppableId) {
        this.#dragIndexCalculator.registerStrategy(droppableId, strategy);
        onCleanup(() => this.#dragIndexCalculator.unregisterStrategy(droppableId));
      }
    });

    // Set excluded index persistently during same-list drag.
    // This ensures ALL strategy methods (getTotalHeight, getOffsetForIndex, etc.)
    // correctly skip the hidden item — not just findIndexAtOffset.
    effect(() => {
      const strategy = this.#strategy();
      const draggedIndex = this.#excludedDraggedIndex();

      if (draggedIndex >= 0) {
        strategy.setExcludedIndex(draggedIndex);
      } else {
        strategy.setExcludedIndex(null);
      }
    });

    // Measure item heights in dynamic height mode: the directive's own input, or the viewport's
    // strategy when inherited. Both can change at runtime, and the strategy is replaced when they
    // do, so this creates, replaces or removes the observer. A new observer reports every
    // rendered item, so a new strategy gets their heights.
    effect((onCleanup) => {
      // Read the strategy first so the effect tracks its replacement even when the input is on
      const strategy = this.#strategy();
      const measure =
        this.vdndVirtualForDynamicItemHeight() || strategy instanceof DynamicHeightStrategy;
      // No ResizeObserver during server rendering
      if (!measure || !this.#isBrowser) {
        return;
      }
      untracked(() => this.#startMeasuring());
      onCleanup(() => this.#stopMeasuring());
    });

    // React to changes and update views
    effect(() => {
      this.#updateViews();
    });
  }

  ngOnInit(): void {
    // Server rendering: there is no ResizeObserver, and elements added outside the template
    // (spacer, placeholder) would not match the client's DOM during hydration. The browser adds
    // the spacer on init, so the server markup lacks only the list's scroll height until then.
    if (!this.#isBrowser) {
      return;
    }

    // Only create spacer when NOT inside a viewport component
    // (viewport provides its own spacer and wrapper positioning)
    if (!this.#useViewportPositioning) {
      this.#updateSpacers();
      // Once the scroll container is in the page with its styles
      // (retried on later renders while it is not)
      const positionRef = afterEveryRender(
        () => {
          if (this.#positionScrollContainer()) {
            positionRef.destroy();
          }
        },
        { injector: this.#injector },
      );
    }

    // Create placeholder element for drag operations
    this.#createPlaceholder();
  }

  ngOnDestroy(): void {
    this.#viewPool.forEach((view) => view.destroy());
    this.#activeViews.forEach((view) => view.destroy());

    // Clean up spacer element (only if we created one)
    this.#spacer?.remove();

    this.#releaseScrollContainerPosition();

    // Clean up placeholder element
    this.#placeholder?.remove();

    // Clean up ResizeObserver
    this.#resizeObserver?.disconnect();

    this.#shiftAnimator?.cancelAll();
  }

  #createShiftAnimator(): ShiftAnimator | null {
    const config = inject(VDND_ANIMATION_CONFIG, { optional: true });
    if (!config) return null;
    return new ShiftAnimator({
      config,
      injector: this.#injector,
      getScrollElement: () => this.#scrollContainer.nativeElement,
      getEntries: () => this.#shiftAnimationEntries(),
    });
  }

  /** Rendered item root elements (keyed by trackBy key) plus the placeholder. */
  *#shiftAnimationEntries(): Iterable<ShiftAnimationEntry> {
    for (const [key, view] of this.#activeViews) {
      for (const node of view.rootNodes) {
        if (node instanceof HTMLElement) {
          yield [key, node];
        }
      }
    }
    if (this.#placeholder && this.#placeholderInDom) {
      yield [PLACEHOLDER_KEY, this.#placeholder];
    }
  }

  /**
   * Create the placeholder element for drag operations.
   */
  #createPlaceholder(): void {
    const placeholder = document.createElement('div');
    placeholder.className = 'vdnd-drag-placeholder vdnd-drag-placeholder-visible';
    placeholder.style.cssText = 'display: block; pointer-events: none;';
    // Without a viewport the rows are positioned absolutely, so the placeholder is too
    if (!this.#useViewportPositioning) {
      placeholder.style.position = 'absolute';
      placeholder.style.left = '0';
      placeholder.style.right = '0';
    }
    this.#placeholder = placeholder;
  }

  /** The placeholder's height: the dragged item's, else the strategy's for the index. */
  #placeholderHeight(strategy: VirtualScrollStrategy, placeholderIndex: number): number {
    return this.#dragState.draggedItem()?.height ?? strategy.getItemHeight(placeholderIndex);
  }

  /**
   * The rows and the spacer are positioned absolutely, so the scroll container (or an element
   * inside it) must be their containing block, or they would not scroll with it. When neither the
   * scroll container nor an element between it and the rows is positioned, give the scroll
   * container `position: relative`. Directives sharing the scroll container share that position:
   * it is restored when the last of them is destroyed.
   *
   * Returns false while the scroll container is not in the page (its computed style is empty).
   */
  #positionScrollContainer(): boolean {
    const scrollElement = this.#scrollContainer.nativeElement;
    if (!scrollElement.isConnected) return false;

    let element = (this.#elementRef.nativeElement as Comment).parentElement;
    while (element) {
      if (element === scrollElement) {
        const positioned = positionedScrollContainers.get(scrollElement);
        if (positioned) {
          positioned.users++;
          this.#usesScrollContainerPosition = true;
        } else if (!isPositioned(scrollElement)) {
          positionedScrollContainers.set(scrollElement, {
            users: 1,
            saved: scrollElement.style.position,
          });
          scrollElement.style.position = 'relative';
          this.#usesScrollContainerPosition = true;
        }
        return true;
      }
      if (isPositioned(element)) return true;
      element = element.parentElement;
    }
    return true;
  }

  /** Stop using the scroll container's position, restoring it after its last user. */
  #releaseScrollContainerPosition(): void {
    if (!this.#usesScrollContainerPosition) return;
    this.#usesScrollContainerPosition = false;

    const scrollElement = this.#scrollContainer.nativeElement;
    const positioned = positionedScrollContainers.get(scrollElement);
    if (!positioned || --positioned.users > 0) return;

    positionedScrollContainers.delete(scrollElement);
    if (scrollElement.style.position === 'relative') {
      scrollElement.style.position = positioned.saved;
    }
  }

  /**
   * Set up spacer element for scroll height.
   */
  #updateSpacers(): void {
    // Create single spacer that maintains total scroll height
    const spacer = document.createElement('div');
    spacer.className = 'vdnd-virtual-for-spacer';
    spacer.style.cssText =
      'position: absolute; top: 0; left: 0; width: 1px; visibility: hidden; pointer-events: none;';

    // Insert spacer before the directive's anchor comment
    const comment = this.#elementRef.nativeElement;
    comment.parentNode?.insertBefore(spacer, comment);

    this.#spacer = spacer;

    // Update spacer height reactively
    // Must pass injector since we're outside constructor
    effect(
      () => {
        const total = this.vdndVirtualForOf().length;
        const strategy = this.#strategy();
        strategy.version();
        const placeholderIndex = this.#placeholderIndex();

        // Single spacer with full content height. The placeholder adds to it, unless it fills the
        // slot of the dragged item, which the strategy excludes (a drag within this list).
        let height = strategy.getTotalHeight(total);
        if (placeholderIndex >= 0 && this.#excludedDraggedIndex() < 0) {
          height += this.#placeholderHeight(strategy, placeholderIndex);
        }
        spacer.style.height = `${height}px`;
      },
      { injector: this.#injector },
    );
  }

  /** Create the ResizeObserver and observe the items already rendered. */
  #startMeasuring(): void {
    this.#setupResizeObserver();
    for (const [key, view] of this.#activeViews) {
      this.#observeViewElements(view, key);
    }
  }

  /** Disconnect the ResizeObserver and forget what it observed. */
  #stopMeasuring(): void {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#observedElements = new WeakMap();
  }

  /**
   * Set up ResizeObserver for dynamic height measurement.
   */
  #setupResizeObserver(): void {
    this.#ngZone.runOutsideAngular(() => {
      this.#resizeObserver = new ResizeObserver((entries) => {
        const strategy = this.#strategy();
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          const key = this.#observedElements.get(element);
          if (key === undefined) continue;

          const height = entry.borderBoxSize?.[0]?.blockSize ?? element.offsetHeight;
          if (height > 0) {
            strategy.setMeasuredHeight(key, height);
          }
        }
      });
    });
  }

  /**
   * Observe an element's root nodes for height changes.
   */
  #observeViewElements(view: EmbeddedViewRef<VirtualForContext<T>>, key: unknown): void {
    if (!this.#resizeObserver) return;

    for (const node of view.rootNodes) {
      if (node instanceof HTMLElement) {
        const existingKey = this.#observedElements.get(node);
        if (Object.is(existingKey, key)) {
          continue;
        }
        if (existingKey !== undefined) {
          this.#resizeObserver.unobserve(node);
        }
        this.#observedElements.set(node, key);
        this.#resizeObserver.observe(node);
      }
    }
  }

  /**
   * Stop any shift animation on a view about to be pooled — a recycled view must not
   * carry an in-flight offset over to the item it renders next.
   */
  #cancelShiftAnimation(view: EmbeddedViewRef<VirtualForContext<T>>): void {
    if (!this.#shiftAnimator) return;

    for (const node of view.rootNodes) {
      if (node instanceof HTMLElement) {
        this.#shiftAnimator.cancel(node);
      }
    }
  }

  /**
   * Stop observing an element's root nodes.
   */
  #unobserveViewElements(view: EmbeddedViewRef<VirtualForContext<T>>): void {
    if (!this.#resizeObserver) return;

    for (const node of view.rootNodes) {
      if (node instanceof HTMLElement) {
        this.#observedElements.delete(node);
        this.#resizeObserver.unobserve(node);
      }
    }
  }

  /**
   * Update the rendered views with true view recycling.
   * Views are kept in the DOM and have their context updated in place when possible.
   */
  #updateViews(): void {
    const items = this.vdndVirtualForOf();
    const { start, end } = this.#renderRange();
    const strategy = this.#strategy();
    strategy.version();
    const placeholderIndex = this.#placeholderIndex();
    const showPlaceholder = this.#shouldShowPlaceholder();
    const droppableId = this.#effectiveDroppableId();
    const sourceDroppableId = this.#dragState.sourceDroppableId();
    const isSourceList = droppableId ? droppableId === sourceDroppableId : true;
    // Only the source list keeps the dragged item rendered, so only it looks for the item
    const draggedIndex =
      this.#dragState.isDragging() && isSourceList ? this.#draggedItemIndex() : -1;
    const shouldKeepDragged = draggedIndex >= 0 && draggedIndex < items.length;

    // Snapshot positions before the DOM changes so displaced items can slide
    this.#shiftAnimator?.beforeUpdate(this.#dragState.isDragging(), placeholderIndex);

    // Notify viewport of render start index for wrapper positioning
    this.#notifyViewportRenderStart(start);

    // 1. Build the list of items to render
    const itemsToRender = this.#calculateItemsToRender({
      items,
      start,
      end,
      showPlaceholder,
      placeholderIndex,
      shouldKeepDragged,
      draggedIndex,
    });

    // 2. Reconcile views with the DOM. Without a viewport, the rows at or after the placeholder
    // move down by its height (with a viewport, the placeholder pushes them in the flow).
    const gap =
      showPlaceholder && placeholderIndex >= 0 && !this.#useViewportPositioning
        ? { index: placeholderIndex, height: this.#placeholderHeight(strategy, placeholderIndex) }
        : null;
    const placeholderDomPosition = this.#reconcileViews(
      itemsToRender,
      showPlaceholder,
      strategy,
      gap,
    );

    // 3. Position placeholder in DOM
    this.#positionPlaceholder(showPlaceholder, placeholderDomPosition, strategy, placeholderIndex);

    // 4. Trim view pool to prevent memory bloat
    this.#trimViewPool();
  }

  /**
   * Notify viewport of render start index for wrapper positioning.
   * With persistent excluded index, getOffsetForIndex already accounts for hidden items.
   */
  #notifyViewportRenderStart(start: number): void {
    if (!this.#useViewportPositioning) return;
    this.#viewport?.setRenderStartIndex(start);
  }

  /**
   * Calculate the list of items to render, including placeholder positioning
   * and keeping the dragged item alive when scrolled out of range.
   */
  #calculateItemsToRender(params: {
    items: T[];
    start: number;
    end: number;
    showPlaceholder: boolean;
    placeholderIndex: number;
    shouldKeepDragged: boolean;
    draggedIndex: number;
  }): RenderEntry<T>[] {
    const {
      items,
      start,
      end,
      showPlaceholder,
      placeholderIndex,
      shouldKeepDragged,
      draggedIndex,
    } = params;
    const trackByFn = this.vdndVirtualForTrackBy();
    const itemsToRender: RenderEntry<T>[] = [];

    // Track placeholder insertion with a flag instead of re-scanning itemsToRender
    // with `.some()` on every iteration (which made the build loop O(n²)).
    let placeholderInserted = false;

    // Build render list for visible range
    for (let i = start; i <= end && i < items.length; i++) {
      // Insert placeholder before item at placeholderIndex
      if (showPlaceholder && placeholderIndex === i && !placeholderInserted) {
        itemsToRender.push({
          type: 'placeholder',
          key: PLACEHOLDER_KEY,
          context: null,
          visualIndex: placeholderIndex,
        });
        placeholderInserted = true;
      }

      const item = items[i];
      itemsToRender.push({
        type: 'item',
        key: trackByFn(i, item),
        context: {
          $implicit: item,
          index: i,
          first: i === start,
          last: i === end || i === items.length - 1,
          count: items.length,
        },
        visualIndex: i,
      });
    }

    // Add placeholder at end if needed
    if (showPlaceholder && placeholderIndex >= items.length && !placeholderInserted) {
      itemsToRender.push({
        type: 'placeholder',
        key: PLACEHOLDER_KEY,
        context: null,
        visualIndex: placeholderIndex,
      });
    }

    // Keep dragged item view alive when scrolled out of range
    if (shouldKeepDragged && (draggedIndex < start || draggedIndex > end)) {
      const draggedItem = items[draggedIndex];
      const draggedKey = trackByFn(draggedIndex, draggedItem);
      const alreadyRendered = itemsToRender.some(
        (entry) => entry.type === 'item' && entry.key === draggedKey,
      );
      if (!alreadyRendered) {
        itemsToRender.push({
          type: 'item',
          key: draggedKey,
          context: {
            $implicit: draggedItem,
            index: draggedIndex,
            first: draggedIndex === 0,
            last: draggedIndex === items.length - 1,
            count: items.length,
          },
          visualIndex: draggedIndex,
        });
      }
    }

    return itemsToRender;
  }

  /**
   * Reconcile views with the calculated items to render.
   * Moves unused views to pool, updates existing views, creates new views as needed.
   * Returns the DOM position where placeholder should be inserted.
   */
  #reconcileViews(
    itemsToRender: RenderEntry<T>[],
    showPlaceholder: boolean,
    strategy: VirtualScrollStrategy,
    gap: { index: number; height: number } | null,
  ): number {
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

    // Remove placeholder from DOM if not needed
    if (!showPlaceholder && this.#placeholderInDom && this.#placeholder) {
      this.#placeholder.remove();
      this.#placeholderInDom = false;
    }

    // Process items and track placeholder position
    let viewContainerIndex = 0;
    let placeholderDomPosition = -1;
    const renderedKeys = new Set<unknown>();
    const changedViews: EmbeddedViewRef<VirtualForContext<T>>[] = [];

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
      const currentIndex = this.#viewContainer.indexOf(view);
      if (currentIndex !== viewContainerIndex) {
        const targetIndex = this.#getSafeViewContainerIndex(currentIndex, viewContainerIndex);
        if (currentIndex >= 0) {
          if (currentIndex !== targetIndex) {
            this.#viewContainer.move(view, targetIndex);
          }
        } else {
          this.#viewContainer.insert(view, targetIndex);
        }
      }

      // Apply absolute positioning when not using viewport wrapper
      if (!this.#useViewportPositioning) {
        let offset = strategy.getOffsetForIndex(entry.visualIndex);
        if (gap && entry.visualIndex >= gap.index) {
          offset += gap.height;
        }
        this.#applyAbsolutePositioning(view, offset);
      }

      // Observe for dynamic height measurement
      if (this.#resizeObserver) {
        this.#observeViewElements(view, entry.key);
      }

      viewContainerIndex++;
    }

    this.#renderChangedViews(changedViews);

    return placeholderDomPosition;
  }

  /**
   * Take a row's view out of the container and pool it. It keeps its element, so its shift
   * animation is cancelled (the item it renders next must not slide from this one's position),
   * and a drop animation that hides it shows it again.
   */
  #poolView(view: EmbeddedViewRef<VirtualForContext<T>>): void {
    const index = this.#viewContainer.indexOf(view);
    if (index >= 0) {
      this.#viewContainer.detach(index);
    }
    this.#unobserveViewElements(view);
    // A leave animation (`animate.leave`) keeps the row in the DOM, and Angular removes it when
    // the animation ends: in the row of another item by then, if the view were reused. A row
    // whose element is dragged (its draggable ID is not its track key) is destroyed too, which
    // cancels the drag instead of handing it to another item.
    const draggedElement = this.#dragState.draggedItem()?.element;
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
   * Clamp target indices for move/insert to avoid out-of-range operations when
   * reconciliation is given invalid duplicate keys or transiently inconsistent view state.
   */
  #getSafeViewContainerIndex(currentIndex: number, requestedIndex: number): number {
    const length = this.#viewContainer.length;

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
      view = this.#templateRef.createEmbeddedView(context);
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
   * on each scroll step. Untracked, so the rows' signal reads do not become this effect's
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
   * Position the placeholder element in the DOM at the correct index.
   */
  #positionPlaceholder(
    showPlaceholder: boolean,
    placeholderDomPosition: number,
    strategy: VirtualScrollStrategy,
    placeholderIndex: number,
  ): void {
    if (!showPlaceholder || !this.#placeholder) {
      return;
    }

    // Use the dragged item's height if available, otherwise use strategy height
    this.#placeholder.style.height = `${this.#placeholderHeight(strategy, placeholderIndex)}px`;
    // Without a viewport, place it in the gap the rows leave at its index. Also while the index
    // is outside the rendered range, so a placeholder left in the DOM never covers a row.
    if (!this.#useViewportPositioning && placeholderIndex >= 0) {
      this.#placeholder.style.top = `${strategy.getOffsetForIndex(placeholderIndex)}px`;
    }

    if (placeholderDomPosition < 0) {
      return;
    }

    const container = this.#viewContainer.element.nativeElement.parentElement;
    if (!container) return;

    // The placeholder goes immediately before the item view at placeholderDomPosition
    // (the reconcile pass counts item views only, so this index maps directly to a
    // ViewContainerRef view). Reading the reference node from that view avoids
    // re-querying and filtering container.children on every placeholder move.
    const insertBeforeEl = this.#getViewReferenceNode(placeholderDomPosition);

    if (!this.#placeholderInDom) {
      // First insertion
      if (insertBeforeEl) {
        container.insertBefore(this.#placeholder, insertBeforeEl);
      } else {
        container.appendChild(this.#placeholder);
      }
      this.#placeholderInDom = true;
    } else {
      // Move to correct position if needed
      const currentNextSibling = this.#placeholder.nextElementSibling;
      if (insertBeforeEl !== currentNextSibling) {
        if (insertBeforeEl) {
          container.insertBefore(this.#placeholder, insertBeforeEl);
        } else {
          container.appendChild(this.#placeholder);
        }
      }
    }
  }

  /**
   * Resolve the DOM node the placeholder should be inserted before, given the
   * item-view index produced by the reconcile pass. Returns null when the index
   * is past the last view (placeholder belongs at the end → append).
   */
  #getViewReferenceNode(viewIndex: number): Element | null {
    if (viewIndex < 0 || viewIndex >= this.#viewContainer.length) {
      return null;
    }
    const view = this.#viewContainer.get(viewIndex) as
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

  /**
   * Trim the view pool to prevent memory bloat, keeping a reasonable buffer.
   */
  #trimViewPool(): void {
    const maxPoolSize = 10;
    while (this.#viewPool.length > maxPoolSize) {
      const view = this.#viewPool.pop();
      view?.destroy();
    }
  }

  /**
   * Static method for Angular's structural directive microsyntax.
   */
  static ngTemplateContextGuard<T>(
    _dir: VirtualForDirective<T>,
    _ctx: unknown,
  ): _ctx is VirtualForContext<T> {
    return true;
  }
}
