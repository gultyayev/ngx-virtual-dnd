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
import { DroppableDirective } from './droppable.directive';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';
import { FixedHeightStrategy } from '../strategies/fixed-height.strategy';
import { DynamicHeightStrategy } from '../strategies/dynamic-height.strategy';
import { bindListStrategy, createHeightStrategy } from '../strategies/strategy-binding';
import { VDND_ANIMATION_CONFIG } from '../tokens/animation-config.token';
import { ShiftAnimationEntry, ShiftAnimator } from '../utils/shift-animator';
import { RenderEntry, VirtualForRowRenderer } from '../rendering/virtual-for-row-renderer';

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

  /**
   * Optional viewport component that provides wrapper-based positioning.
   * When inside a viewport, items are positioned via the wrapper's transform,
   * so we skip individual absolute positioning.
   */
  readonly #viewport = inject(VDND_VIRTUAL_VIEWPORT, { optional: true });

  /** A vdnd-virtual-viewport, whose rows start rowsOffset() px down (see #rowsScrollTop) */
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

  /** The rows (see VirtualForRowRenderer) */
  readonly #rowRenderer = new VirtualForRowRenderer<T>({
    viewContainer: this.#viewContainer,
    template: this.#templateRef,
    positionRows: !this.#useViewportPositioning,
    shiftAnimator: this.#shiftAnimator,
    draggedElement: () => this.#dragState.draggedItem()?.element,
    observe: (view, key) => this.#observeViewElements(view, key),
    unobserve: (view) => this.#unobserveViewElements(view),
  });

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
    return createHeightStrategy(height, this.vdndVirtualForDynamicItemHeight());
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
    return strategy.getFirstVisibleIndex(this.#toStrategyOffset(this.#rowsScrollTop()));
  });

  /**
   * Without a viewport, the gap the placeholder opens among the absolutely positioned rows: the
   * rows at or after `index` move down by `height` from their strategy offsets, the gap starting at
   * `offset`. Null with a viewport (the placeholder pushes the rows in the flow) or no placeholder.
   */
  readonly #gap = computed(() => {
    if (this.#useViewportPositioning) return null;
    const index = this.#placeholderIndex();
    if (index < 0) return null;
    const strategy = this.#strategy();
    strategy.version();
    return {
      index,
      offset: strategy.getOffsetForIndex(index),
      height: this.#placeholderHeight(strategy, index),
    };
  });

  /**
   * Map a position among the rendered rows to the strategy's offsets, which leave out the gap:
   * past the gap, subtract its height; inside it, the gap's start (the row after it comes next).
   */
  #toStrategyOffset(position: number): number {
    const gap = this.#gap();
    if (!gap || position <= gap.offset) return position;
    return Math.max(gap.offset, position - gap.height);
  }

  /**
   * How far the rows are scrolled. A vdnd-virtual-viewport's rows start rowsOffset() px down its
   * scroll area (its content offset or top scroll inset), but its scrollTop() is the raw position,
   * so subtract the offset here. vdnd-virtual-content's scrollTop() already excludes its offset.
   */
  #rowsScrollTop(): number {
    const scrollTop = this.#scrollContainer.scrollTop();
    const viewport = this.#offsetRowsViewport;
    if (viewport === null || viewport !== this.#viewport) {
      return scrollTop;
    }
    return Math.max(0, scrollTop - viewport.rowsOffset());
  }

  /**
   * Last visible item index: the item at the bottom edge, so a dragged item's closed-up slot in
   * view leaves no row unrendered. The bottom edge moves by the gap only as far as the top edge
   * does: a gap in view then renders the rows it pushes out of view too, which keeps the range
   * (and every row) as it is while the placeholder moves within view.
   */
  readonly #lastVisibleIndex = computed(() => {
    const strategy = this.#strategy();
    strategy.version();
    const top = this.#rowsScrollTop();
    const gapAbove = top - this.#toStrategyOffset(top);
    const bottom = top + this.#scrollContainer.containerHeight();
    return strategy.getFirstVisibleIndex(bottom - gapAbove);
  });

  /** Range of items to render */
  readonly #renderRange = computed(() => {
    const first = this.#firstVisibleIndex();
    const last = this.#lastVisibleIndex();
    const overscan = this.vdndVirtualForOverscan();
    const total = this.vdndVirtualForOf().length;

    const start = Math.max(0, first - overscan);
    const end = Math.min(total - 1, Math.max(first, last) + overscan);

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
    // The strategy's items, registration and dragged-item exclusion
    bindListStrategy({
      strategy: this.#strategy,
      itemCount: () => this.vdndVirtualForOf().length,
      itemKeys: this.#itemKeys,
      droppableId: this.#effectiveDroppableId,
      excludedIndex: this.#excludedDraggedIndex,
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
    this.#rowRenderer.destroy();

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
    for (const [key, view] of this.#rowRenderer.views) {
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
    for (const [key, view] of this.#rowRenderer.views) {
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
        this.#resizeObserver.observe(node, { box: 'border-box' });
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

    // Remove placeholder from DOM if not needed
    if (!showPlaceholder && this.#placeholderInDom && this.#placeholder) {
      this.#placeholder.remove();
      this.#placeholderInDom = false;
    }

    // 2. Reconcile views with the DOM. Without a viewport, the rows at or after the placeholder
    // move down by its height (with a viewport, the placeholder pushes them in the flow).
    const placeholderDomPosition = this.#rowRenderer.render(itemsToRender, strategy, this.#gap());

    // 3. Position placeholder in DOM
    this.#positionPlaceholder(showPlaceholder, placeholderDomPosition, strategy, placeholderIndex);
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
    const insertBeforeEl = this.#rowRenderer.firstElementOf(placeholderDomPosition);

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
   * Static method for Angular's structural directive microsyntax.
   */
  static ngTemplateContextGuard<T>(
    _dir: VirtualForDirective<T>,
    _ctx: unknown,
  ): _ctx is VirtualForContext<T> {
    return true;
  }
}
