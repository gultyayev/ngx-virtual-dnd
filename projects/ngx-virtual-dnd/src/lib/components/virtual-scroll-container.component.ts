import {
  afterNextRender,
  afterRenderEffect,
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  computed,
  createComponent,
  effect,
  ElementRef,
  EmbeddedViewRef,
  EnvironmentInjector,
  inject,
  Injector,
  input,
  isDevMode,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  signal,
  TemplateRef,
  untracked,
  viewChild,
  ViewContainerRef,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DragStateService } from '../services/drag-state.service';
import type { DraggedItem } from '../models/drag-drop.models';
import { AutoScrollConfig, AutoScrollService } from '../services/auto-scroll.service';
import { KeyboardDragService } from '../services/keyboard-drag.service';
import { DragIndexCalculatorService } from '../services/drag-index-calculator.service';
import { DragPlaceholderComponent } from './drag-placeholder.component';
import {
  bindRafThrottledScrollTopSignal,
  bindResizeObserverHeightSignal,
} from '../utils/dom-signal-bindings';
import { createAutoScrollRegistration } from '../utils/auto-scroll-registration';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';
import { FixedHeightStrategy } from '../strategies/fixed-height.strategy';
import { DynamicHeightStrategy } from '../strategies/dynamic-height.strategy';
import { setStrategyItems } from '../strategies/strategy-items';
import { mapByAttribute } from '../utils/attribute-selectors';
import { VDND_ANIMATION_CONFIG } from '../tokens/animation-config.token';
import { ShiftAnimationEntry, ShiftAnimator } from '../utils/shift-animator';
import { revealDropTargetIn } from '../utils/drop-animator';

/**
 * Context provided to the item template.
 */
export interface VirtualScrollItemContext<T> {
  /** The item data */
  $implicit: T;
  /** The item's index in the original array */
  index: number;
  /** Whether this item is "sticky" (always rendered) */
  isSticky: boolean;
}

/** An entry of the rendered list: an item's row, or the placeholder. */
interface RenderedEntry<T> {
  type: 'item' | 'placeholder';
  data: T | null;
  index: number;
  isSticky: boolean;
  isDragging: boolean;
}

/** A rendered row: the item template's view and the track key it was created for. */
interface RowView<T> {
  key: unknown;
  view: EmbeddedViewRef<VirtualScrollItemContext<T>>;
}

/**
 * How many views of rows that left a list stay pooled for rows that come in (recycleRows). A
 * scroll step reuses the views it pools right away; the pool keeps the rest, for example when
 * fewer rows render after the list shrinks.
 */
const MAX_POOLED_ROWS = 10;

/** `Node.DOCUMENT_POSITION_FOLLOWING`, without the `Node` global (servers have none) */
const DOCUMENT_POSITION_FOLLOWING = 4;

/**
 * The node that comes first in the DOM. A view's `rootNodes` list a control flow block's anchor
 * before the nodes rendered in it, which the DOM puts before the anchor.
 */
function firstInDocumentOrder(nodes: Node[]): Node | null {
  let first: Node | null = null;
  for (const node of nodes) {
    if (first === null || node.compareDocumentPosition(first) & DOCUMENT_POSITION_FOLLOWING) {
      first = node;
    }
  }
  return first;
}

/**
 * Which values belong to a longest increasing subsequence of `values` (negative values never
 * do). For rows: the views that can stay where they are while the others move around them, as
 * few as possible. A moved row loses focus and restarts its CSS transitions.
 */
function longestIncreasingRun(values: number[]): boolean[] {
  // tails[k]: the index of the smallest value that ends an increasing run of length k + 1
  const tails: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value < 0) continue;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]] < value) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    previous[i] = low > 0 ? tails[low - 1] : -1;
    tails[low] = i;
  }

  const inRun = new Array<boolean>(values.length).fill(false);
  for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i >= 0; i = previous[i]) {
    inRun[i] = true;
  }
  return inRun;
}

/**
 * A virtual scroll container that only renders visible items.
 *
 * Key features:
 * - Only renders items within the visible viewport plus an overscan buffer
 * - Supports "sticky" items that are always rendered (used for dragged items)
 * - Uses spacer divs to maintain correct scroll height
 * - Integrates with the drag-and-drop system
 * - Automatic height detection via ResizeObserver when containerHeight is not provided
 * - Supports dynamic item heights via `dynamicItemHeight` input
 *
 * @example
 * ```html
 * <!-- With fixed height items -->
 * <vdnd-virtual-scroll
 *   [items]="items()"
 *   [itemHeight]="50"
 *   [containerHeight]="400"
 *   [trackByFn]="trackById">
 *   <ng-template let-item let-index="index">
 *     <div class="item">{{ item.name }}</div>
 *   </ng-template>
 * </vdnd-virtual-scroll>
 *
 * <!-- With dynamic height items -->
 * <vdnd-virtual-scroll
 *   [items]="items()"
 *   [itemHeight]="50"
 *   [dynamicItemHeight]="true"
 *   [containerHeight]="400"
 *   [trackByFn]="trackById">
 *   <ng-template let-item let-index="index">
 *     <div class="item">{{ item.description }}</div>
 *   </ng-template>
 * </vdnd-virtual-scroll>
 * ```
 */
@Component({
  selector: 'vdnd-virtual-scroll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'vdnd-virtual-scroll',
    '[style.height.px]': 'containerHeight() ?? null',
    '[attr.data-item-height]': 'itemHeight()',
    '[attr.data-total-items]': 'items().length',
  },
  // No bindings: the effects render the rows, the placeholder, the spacer height and the content
  // offset (see #render). A signal read here would re-render every row whenever it changes.
  template: `
    <!-- Single spacer maintains scroll height -->
    <div #spacer class="vdnd-virtual-scroll-spacer"></div>

    <!-- Content wrapper positioned via GPU-accelerated transform -->
    <div #contentWrapper class="vdnd-virtual-scroll-content-wrapper">
      <ng-container #rows />
    </div>
  `,
  styles: `
    :host {
      display: block;
      overflow: auto;
      position: relative;
      /* Disable browser scroll anchoring - this prevents scroll position from being
         adjusted when the DOM changes (e.g., when placeholder position updates).
         Without this, autoscroll UP would fight with browser's scroll restoration. */
      overflow-anchor: none;
    }

    .vdnd-virtual-scroll-spacer {
      /* Invisible spacer that maintains scroll height */
      position: absolute;
      top: 0;
      left: 0;
      width: 1px;
      visibility: hidden;
      pointer-events: none;
    }

    .vdnd-virtual-scroll-content-wrapper {
      /* GPU-accelerated positioning */
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      will-change: transform;
    }
  `,
})
export class VirtualScrollContainerComponent<T>
  implements OnChanges, OnInit, AfterViewInit, AfterViewChecked, OnDestroy
{
  readonly #dragState = inject(DragStateService);
  readonly #elementRef = inject(ElementRef<HTMLElement>);
  readonly #autoScrollService = inject(AutoScrollService);
  readonly #dragIndexCalculator = inject(DragIndexCalculatorService);
  readonly #keyboardDrag = inject(KeyboardDragService);
  readonly #ngZone = inject(NgZone);
  readonly #injector = inject(Injector);
  readonly #environmentInjector = inject(EnvironmentInjector);
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Cleanup function for scroll listener */
  #scrollCleanup: (() => void) | null = null;
  #resizeCleanup: (() => void) | null = null;

  /** ResizeObserver for dynamic height measurement (only in dynamic height mode) */
  readonly #itemResizeObserver = signal<ResizeObserver | null>(null);

  /** Map from observed HTMLElement to its trackBy key */
  readonly #observedElements = new WeakMap<HTMLElement, unknown>();
  /** Stable mapping from rendered key to observed element for unobserve cleanup */
  readonly #observedElementByKey = new Map<unknown, HTMLElement>();

  /** Measured height from ResizeObserver (used when containerHeight is not provided) */
  readonly #measuredHeight = signal(0);

  /** Slides items displaced by the placeholder (only when VDND_ANIMATION_CONFIG is provided) */
  readonly #shiftAnimator = this.#createShiftAnimator();

  /** The template's spacer (cannot use ES private with viewChild) */
  private readonly spacer = viewChild<ElementRef<HTMLElement>>('spacer');

  /** The template's content wrapper (cannot use ES private with viewChild) */
  private readonly contentWrapper = viewChild<ElementRef<HTMLElement>>('contentWrapper');

  /** Where #renderRows inserts the rows (cannot use ES private with viewChild) */
  private readonly rowOutlet = viewChild('rows', { read: ViewContainerRef });

  /** Rendered rows, in DOM order */
  #rows: RowView<T>[] = [];

  /** The entries the rendered rows show */
  #rowEntries: RenderedEntry<T>[] | null = null;

  /** The template the rendered rows were created from */
  #rowTemplate: TemplateRef<VirtualScrollItemContext<T>> | null = null;

  /** The track function that gave the rendered rows their keys */
  #rowTrackBy: unknown = null;

  /** Views of rows that left, detached, to render rows that come in (recycleRows) */
  #rowPool: EmbeddedViewRef<VirtualScrollItemContext<T>>[] = [];

  /**
   * Set while this component's view is about to be checked in the current change detection pass:
   * from an input change (ngOnChanges, which runs before its effects; the first render included)
   * until the check (ngAfterViewChecked). That check renders every row.
   */
  #viewCheckPending = false;

  /** The placeholder, created on its first render and reused */
  #placeholder: ComponentRef<DragPlaceholderComponent> | null = null;

  /** Height last set on the placeholder */
  #placeholderHeightSet: number | null = null;

  /** Content offset last written to the content wrapper */
  #contentTransformSet: string | null = null;

  /** Whether #revealPlaceholder is scheduled to run again after the next render */
  #revealAfterRenderPending = false;

  /** Whether duplicate track keys were reported (once per list) */
  #warnedDuplicateKeys = false;

  /** The row keys last checked for duplicates (checked again when the rows change) */
  #rowKeysChecked: unknown[] | null = null;

  /** Template for rendering each item - passed as input instead of content child for reliability */
  itemTemplate = input.required<TemplateRef<VirtualScrollItemContext<T>>>();

  /** Unique ID for this scroll container (used for auto-scroll registration) */
  scrollContainerId = input<string>();

  /** Whether auto-scroll is enabled when dragging near edges */
  autoScrollEnabled = input<boolean>(true);

  /** Auto-scroll configuration */
  autoScrollConfig = input<Partial<AutoScrollConfig>>({});

  /** Array of items to render */
  items = input.required<T[]>();

  /** Height of each item in pixels (used as estimate in dynamic mode) */
  itemHeight = input.required<number>();

  /**
   * Enable dynamic item height mode.
   * When true, items are auto-measured via ResizeObserver and `itemHeight`
   * serves as the initial estimate for unmeasured items.
   */
  dynamicItemHeight = input<boolean>(false);

  /**
   * Height of the container in pixels.
   * If not provided, the container will automatically measure its height from CSS.
   * This allows you to set the height via CSS (e.g., flex, height: 100%, etc.)
   * and the component will adapt automatically, including on resize.
   */
  containerHeight = input<number>();

  /**
   * Effective height used for calculations.
   * Uses explicit containerHeight if provided, otherwise uses measured height.
   */
  readonly effectiveHeight = computed(() => this.containerHeight() ?? this.#measuredHeight());

  /** Number of items to render above/below the visible area */
  overscan = input<number>(3);

  /** IDs of items that should always be rendered (e.g., dragged items) */
  stickyItemIds = input<string[]>([]);

  /** Function to get a unique ID from an item */
  itemIdFn = input.required<(item: T) => string>();

  /**
   * Track-by function for the @for loop.
   * Optional - if not provided, will be derived from itemIdFn.
   */
  trackByFn = input<(index: number, item: T) => string | number>();

  /**
   * ID of the droppable this virtual scroll belongs to.
   * Required for placeholder positioning.
   */
  droppableId = input<string>();

  /**
   * Reuse the views of rows that scroll out to render the rows that scroll in, instead of
   * destroying them and creating new ones. Scrolling creates fewer components and elements, but
   * a row's components, element and DOM state (focus aside) then carry over to other items.
   * @default false
   */
  recycleRows = input<boolean>(false);

  /**
   * Whether to automatically add the dragged item to the sticky list.
   * This ensures the dragged item remains visible during virtual scrolling.
   * @default true
   */
  autoStickyDraggedItem = input<boolean>(true);

  // ========== Strategy ==========

  /** The virtual scroll strategy, created based on dynamicItemHeight input */
  readonly #strategy = computed<VirtualScrollStrategy>(() => {
    const height = this.itemHeight();
    return this.dynamicItemHeight()
      ? new DynamicHeightStrategy(height)
      : new FixedHeightStrategy(height);
  });

  /**
   * Effective track-by function - uses provided trackByFn or derives from itemIdFn.
   */
  protected readonly effectiveTrackByFn = computed(() => {
    const userFn = this.trackByFn();
    if (userFn) return userFn;

    const idFn = this.itemIdFn();
    return (_index: number, item: T) => idFn(item);
  });

  /**
   * Track function for rendered entries (items + placeholder).
   */
  protected trackEntry(
    _index: number,
    entry: { type: 'item' | 'placeholder'; data: T | null; index: number },
  ): string | number {
    if (entry.type === 'placeholder') {
      return '__placeholder__';
    }
    const trackFn = this.effectiveTrackByFn();
    return trackFn(entry.index, entry.data as T);
  }

  /**
   * Effective sticky item IDs - combines user-provided IDs with auto-sticky dragged item.
   */
  protected readonly effectiveStickyIds = computed(() => {
    const userIds = this.stickyItemIds();

    if (!this.autoStickyDraggedItem()) {
      return userIds;
    }

    const draggedId = this.draggedItemId();
    if (!draggedId) {
      return userIds;
    }

    // Avoid creating new array if dragged ID is already in the list
    if (userIds.includes(draggedId)) {
      return userIds;
    }

    return [...userIds, draggedId];
  });

  /** Current scroll position */
  readonly #scrollTop = signal(0);

  /** Total height of all items (for scrollbar) */
  protected readonly totalHeight = computed(() => {
    const count = this.items().length;
    const strategy = this.#strategy();
    strategy.version();
    return strategy.getTotalHeight(count);
  });

  /** First visible item index */
  readonly #firstVisibleIndex = computed(() => {
    const strategy = this.#strategy();
    strategy.version();
    return strategy.getFirstVisibleIndex(this.#scrollTop());
  });

  /** Number of items visible in the viewport */
  readonly #visibleCount = computed(() => {
    const height = this.effectiveHeight();
    const strategy = this.#strategy();
    strategy.version();
    return strategy.getVisibleCount(this.#firstVisibleIndex(), height);
  });

  /** Range of items to render (with overscan) */
  readonly #renderRange = computed(() => {
    const first = this.#firstVisibleIndex();
    const visible = this.#visibleCount();
    const overscan = this.overscan();
    const total = this.items().length;

    const start = Math.max(0, first - overscan);
    const end = Math.min(total - 1, first + visible + overscan);

    return { start, end };
  });

  /** Transform offset for content wrapper (position of first rendered item) */
  protected readonly contentTransform = computed(() => {
    const { start } = this.#renderRange();
    const strategy = this.#strategy();
    strategy.version();

    const offset = strategy.getOffsetForIndex(start);
    return `translateY(${offset}px)`;
  });

  /** The ID of the currently dragged item (if any) */
  protected readonly draggedItemId = computed(() => {
    return this.#dragState.draggedItem()?.draggableId ?? null;
  });

  /**
   * Every item's ID, in order. Computed once per items change, and only when something reads it:
   * a dynamic-height strategy, a drag, or a sticky item outside the rendered rows. A fixed-height
   * strategy needs only the item count.
   */
  readonly #itemIds = computed(() => {
    const idFn = this.itemIdFn();
    return this.items().map((item) => idFn(item));
  });

  /**
   * Index of each item ID (the last, when several share one), for the sticky items outside the
   * rendered rows. Built on first use, so an items change (a drop) builds none.
   */
  readonly #itemIndexMap = computed(() => {
    const ids = this.#itemIds();
    const map = new Map<string, number>();
    for (let i = 0; i < ids.length; i++) {
      map.set(ids[i], i);
    }
    return map;
  });

  /**
   * The index of the currently dragged item in the items array (-1 if not found or not dragging).
   * Found without the index map, which only this lookup would need on a drag: a drag that started
   * in another list has no item here (IDs are unique across lists), the index where the drag found
   * its item is checked next, and only then every item ID is searched.
   */
  readonly #draggedItemIndex = computed(() => {
    const draggedId = this.draggedItemId();
    if (!draggedId) return -1;

    const droppableId = this.droppableId();
    const sourceDroppableId = this.#dragState.sourceDroppableId();
    if (droppableId && sourceDroppableId && droppableId !== sourceDroppableId) return -1;

    const sourceIndex = this.#dragState.sourceIndex();
    const items = this.items();
    if (
      sourceIndex !== null &&
      sourceIndex >= 0 &&
      sourceIndex < items.length &&
      this.itemIdFn()(items[sourceIndex]) === draggedId
    ) {
      return sourceIndex;
    }
    return this.#itemIds().lastIndexOf(draggedId);
  });

  /** Memoized Set of sticky IDs - rebuilt only when effectiveStickyIds() changes */
  readonly #stickyIdsSet = computed(() => new Set(this.effectiveStickyIds()));

  /** Whether the placeholder should be shown in this container */
  protected readonly shouldShowPlaceholder = computed(() => {
    if (!this.#dragState.isDragging()) return false;
    return this.#dragState.activeDroppableId() === this.droppableId();
  });

  /** The placeholder index when placeholder should be shown */
  protected readonly placeholderIndex = computed(() => {
    if (!this.shouldShowPlaceholder()) return -1;
    return this.#dragState.placeholderIndex() ?? -1;
  });

  /** Height for the placeholder — use dragged item's actual height in dynamic mode */
  protected readonly placeholderHeight = computed(() => {
    if (this.dynamicItemHeight()) {
      const draggedItemHeight = this.#dragState.draggedItem()?.height;
      if (draggedItemHeight && draggedItemHeight > 0) return draggedItemHeight;
    }
    return this.itemHeight();
  });

  /**
   * Rows to render: the items in range, then the sticky items outside it. Independent of the
   * placeholder, so a placeholder move leaves the rows as they are.
   */
  readonly #renderedRows = computed(() => {
    const items = this.items();
    const { start, end } = this.#renderRange();
    const stickyIds = this.#stickyIdsSet();
    const idFn = this.itemIdFn();
    const draggedId = this.draggedItemId();

    const result: RenderedEntry<T>[] = [];
    const renderedIds = new Set<string>();

    // Add all items in the visible range
    for (let i = start; i <= end && i < items.length; i++) {
      const item = items[i];
      const id = idFn(item);
      result.push({
        type: 'item',
        data: item,
        index: i,
        isSticky: stickyIds.has(id),
        isDragging: id === draggedId,
      });
      renderedIds.add(id);
    }

    // Add any sticky items that aren't already rendered
    const missingStickyIndices: { id: string; index: number }[] = [];
    for (const id of stickyIds) {
      if (renderedIds.has(id)) continue;
      // The drag knows its item's index; the index map serves the other sticky items
      const index =
        id === draggedId ? this.#draggedItemIndex() : (this.#itemIndexMap().get(id) ?? -1);
      if (index < 0) continue;
      missingStickyIndices.push({ id, index });
    }
    if (missingStickyIndices.length > 1) {
      missingStickyIndices.sort((a, b) => a.index - b.index);
    }

    for (const { id, index } of missingStickyIndices) {
      const item = items[index];
      if (item === undefined) continue;
      result.push({
        type: 'item',
        data: item,
        index,
        isSticky: true,
        isDragging: id === draggedId,
      });
    }

    return result;
  });

  /** Track keys of #renderedRows, in order */
  readonly #rowKeys = computed(() =>
    this.#renderedRows().map((entry, i) => this.trackEntry(i, entry)),
  );

  /**
   * Where the placeholder renders among the rows: before the row at this position (after the
   * rows in range when it equals their count), or -1 when it is not rendered. It goes before the
   * item at the placeholder index when that item is in range, and after the rows in range when
   * the index is past the last item.
   */
  readonly #placeholderSlot = computed(() => {
    const placeholderIndex = this.placeholderIndex();
    if (placeholderIndex < 0) return -1;

    const itemCount = this.items().length;
    const { start, end } = this.#renderRange();
    const lastInRange = Math.min(end, itemCount - 1);
    if (placeholderIndex >= start && placeholderIndex <= lastInRange) {
      return placeholderIndex - start;
    }
    if (placeholderIndex >= itemCount) {
      return Math.max(0, lastInRange - start + 1);
    }
    return -1;
  });

  /** Items to render, including sticky items and placeholder */
  protected readonly renderedItems = computed(() => {
    const rows = this.#renderedRows();
    const slot = this.#placeholderSlot();

    const result: {
      type: 'item' | 'placeholder';
      data: T | null;
      index: number;
      isSticky: boolean;
      // The container doesn't read it, but subclasses can: renderedItems is protected
      isDragging: boolean;
    }[] = [...rows];
    if (slot >= 0) {
      result.splice(slot, 0, {
        type: 'placeholder',
        data: null,
        index: this.placeholderIndex(),
        isSticky: false,
        isDragging: false,
      });
    }
    return result;
  });

  /** Generated ID for auto-scroll registration */
  #generatedScrollId = `vdnd-scroll-${Math.random().toString(36).slice(2, 9)}`;

  /** Track previous dragged ID to detect drag end */
  #previousDraggedId: string | null = null;

  /** Track previous total height to detect if we were at bottom before drag ended */
  #previousTotalHeight = 0;

  constructor() {
    createAutoScrollRegistration({
      autoScrollService: this.#autoScrollService,
      getElement: () => this.#elementRef.nativeElement,
      getId: () => this.scrollContainerId() ?? this.#generatedScrollId,
      enabled: () => this.autoScrollEnabled(),
      config: () => this.autoScrollConfig(),
    });

    // Keep the strategy's items in sync. A fixed-height strategy needs only their count, which
    // spares computing every item's ID on each items change (each drop).
    effect(() => {
      setStrategyItems(this.#strategy(), this.items().length, () => this.#itemIds());
    });

    // Register strategy with drag index calculator for accurate drag calculations
    effect((onCleanup) => {
      const droppableId = this.droppableId();
      const strategy = this.#strategy();
      if (droppableId) {
        this.#dragIndexCalculator.registerStrategy(droppableId, strategy);
        onCleanup(() => this.#dragIndexCalculator.unregisterStrategy(droppableId));
      }
    });

    // Set excluded index persistently during same-list drag.
    effect(() => {
      const strategy = this.#strategy();
      const draggedIndex = this.#draggedItemIndex();
      strategy.setExcludedIndex(draggedIndex >= 0 ? draggedIndex : null);
    });

    // Keyboard drag autoscroll: keep the placeholder visible. Arrow keys call
    // #revealPlaceholder synchronously (through KeyboardDragService) so a drop right after a
    // move never lands outside the rendered range; this effect re-runs it when item
    // measurements or the viewport height change during the drag.
    effect((onCleanup) => {
      const droppableId = this.droppableId();
      if (!droppableId) return;
      const reveal = (): void => untracked(() => this.#revealPlaceholder());
      this.#keyboardDrag.registerRevealer(droppableId, reveal);
      onCleanup(() => this.#keyboardDrag.unregisterRevealer(droppableId, reveal));
    });
    effect(() => this.#revealPlaceholder());

    // Preserve scroll position when drag ends at bottom of list.
    // Safety net: totalHeight no longer shrinks during drag (getTotalHeight
    // ignores exclusion), but this logic remains as harmless protection
    // in case future changes reintroduce height variance.
    effect(() => {
      const currentDraggedId = this.draggedItemId();
      const currentTotalHeight = this.totalHeight();
      const element = this.#elementRef.nativeElement;

      // Detect drag end (was dragging, now not)
      if (this.#previousDraggedId !== null && currentDraggedId === null) {
        const currentScrollTop = element.scrollTop;
        const strategy = this.#strategy();
        strategy.version();
        const height = this.effectiveHeight();
        const totalItems = this.items().length;

        // Calculate if we were at/near bottom (within 10px tolerance)
        // using the height FROM THE PREVIOUS CYCLE (when dragging was active)
        const dragReducedMaxScroll = Math.max(0, this.#previousTotalHeight - height);
        const wasAtBottom = currentScrollTop >= dragReducedMaxScroll - 10;

        if (wasAtBottom && dragReducedMaxScroll > 0) {
          // Clear exclusion before calculating new height
          strategy.setExcludedIndex(null);

          // Adjust scroll to new bottom position after totalHeight increases
          afterNextRender(
            () => {
              const newTotalHeight = strategy.getTotalHeight(totalItems);
              const newMaxScroll = Math.max(0, newTotalHeight - height);
              element.scrollTop = newMaxScroll;
              this.#scrollTop.set(newMaxScroll);
            },
            { injector: this.#injector },
          );
        }
      }

      this.#previousDraggedId = currentDraggedId;
      this.#previousTotalHeight = currentTotalHeight;
    });

    // Clamp scrollTop during drag if totalHeight ever shrinks.
    // With the current fix, getTotalHeight no longer excludes the dragged item,
    // so this is effectively a no-op. Kept as a safety net.
    effect(() => {
      const isDragging = this.#dragState.isDragging();
      const totalHeight = this.totalHeight();
      const element = this.#elementRef.nativeElement;

      if (isDragging) {
        const containerHeight = this.effectiveHeight();
        const maxScroll = Math.max(0, totalHeight - containerHeight);
        const currentScrollTop = element.scrollTop;

        // Clamp scrollTop to valid range
        if (currentScrollTop > maxScroll) {
          element.scrollTop = maxScroll;
          this.#scrollTop.set(maxScroll);
        }
      }
    });

    effect(() => {
      const spacer = this.spacer()?.nativeElement;
      if (spacer) {
        spacer.style.height = `${this.totalHeight()}px`;
      }
    });

    // Last, so it renders what the effects above scrolled to. Component effects run before the
    // component's own view is checked, which has nothing to update: the template has no bindings.
    effect(() => this.#render());
  }

  ngOnChanges(): void {
    this.#viewCheckPending = true;
  }

  ngOnInit(): void {
    // Measure rows in dynamic height mode. dynamicItemHeight can change at runtime, and the
    // strategy is replaced when it (or itemHeight) does, so this creates, replaces or removes the
    // observer. #observeRenderedItems observes every rendered row with each new observer, so a
    // new strategy gets their heights.
    effect(
      (onCleanup) => {
        // No ResizeObserver during server rendering
        if (!this.dynamicItemHeight() || !this.#isBrowser) return;
        this.#strategy();
        const observer = untracked(() => this.#createItemResizeObserver());
        this.#itemResizeObserver.set(observer);
        onCleanup(() => {
          observer.disconnect();
          this.#observedElementByKey.clear();
          this.#itemResizeObserver.set(null);
        });
      },
      { injector: this.#injector },
    );
  }

  ngAfterViewInit(): void {
    const element = this.#elementRef.nativeElement;

    this.#resizeCleanup = bindResizeObserverHeightSignal({
      element,
      ngZone: this.#ngZone,
      height: this.#measuredHeight,
      minDeltaPx: 1,
    });

    // Scroll listener outside Angular zone with RAF throttling.
    // This avoids template event binding which would mark the component dirty 60x/sec.
    this.#scrollCleanup = bindRafThrottledScrollTopSignal({
      element,
      ngZone: this.#ngZone,
      scrollTop: this.#scrollTop,
      thresholdPx: 5,
    });

    // Observe rendered items for dynamic height measurement
    this.#observeRenderedItems();
  }

  ngAfterViewChecked(): void {
    this.#viewCheckPending = false;
  }

  /**
   * Scroll so the placeholder is fully visible during a keyboard drag into this list.
   * Reads only signals and strategy offsets, so it works before the placeholder renders.
   *
   * A scroll down runs it once more after the next render (`isFollowUp`): before the placeholder
   * renders after the last row, the content is one placeholder shorter, and the browser clamps
   * the scroll to that shorter range. The follow-up re-applies the scroll once the rendered
   * content is tall enough.
   */
  #revealPlaceholder(isFollowUp = false): void {
    // Only apply when this droppable is active during keyboard drag
    if (!this.#dragState.isKeyboardDrag()) return;
    const activeDroppable = this.#dragState.activeDroppableId();
    if (activeDroppable !== this.droppableId()) return;

    // The placeholder renders before the item at placeholderIndex. Below the source in the
    // same list that is keyboardTargetIndex + 1: the dragged item's slot is excluded.
    if (this.#dragState.keyboardTargetIndex() === null) return;
    const placeholderIndex = this.placeholderIndex();
    if (placeholderIndex < 0) return;

    const strategy = this.#strategy();
    strategy.version();
    const height = this.effectiveHeight();
    if (height <= 0) return;

    const element = this.#elementRef.nativeElement;
    const currentScrollTop = element.scrollTop;

    // Calculate placeholder position using strategy
    const targetTop = strategy.getOffsetForIndex(placeholderIndex);
    const targetBottom = targetTop + this.placeholderHeight();

    // Calculate visible range
    const viewportTop = currentScrollTop;
    const viewportBottom = currentScrollTop + height;

    // Check if target is fully visible
    if (targetTop < viewportTop) {
      // Target is above viewport - scroll up
      element.scrollTop = targetTop;
      this.#scrollTop.set(targetTop);
    } else if (targetBottom > viewportBottom) {
      // Target is below viewport - scroll down
      const newScrollTop = targetBottom - height;
      element.scrollTop = newScrollTop;
      this.#scrollTop.set(newScrollTop);
      if (!isFollowUp) this.#revealPlaceholderAfterRender();
    }
  }

  /** Run #revealPlaceholder again, once, after the next render, when the scroll range includes the placeholder. */
  #revealPlaceholderAfterRender(): void {
    if (this.#revealAfterRenderPending) return;
    this.#revealAfterRenderPending = true;
    afterNextRender(
      () => {
        this.#revealAfterRenderPending = false;
        this.#revealPlaceholder(true);
      },
      { injector: this.#injector },
    );
  }

  /**
   * Render the content offset, the rows and the placeholder. From an effect, not the template:
   * Angular checks every row view in this component's view each time a signal its template reads
   * changes, so reading the placeholder there re-rendered every row on each placeholder move.
   * Here a placeholder move only moves the placeholder, and a row renders when its context does.
   */
  #render(): void {
    // Snapshot the rendered positions before anything moves, so displaced rows can slide. First,
    // as a subclass that renders its own template relies on it too.
    const isDragging = this.#dragState.isDragging();
    const placeholderIndex = this.placeholderIndex();
    untracked(() => this.#shiftAnimator?.beforeUpdate(isDragging, placeholderIndex));

    const outlet = this.rowOutlet();
    const wrapper = this.contentWrapper()?.nativeElement;
    // Not this component's template (a subclass's own): it renders renderedItems() itself
    if (!outlet || !wrapper) return;

    const template = this.itemTemplate() ?? null;
    const entries = this.#renderedRows();
    const keys = this.#rowKeys();
    const trackBy = this.effectiveTrackByFn();
    const recycle = this.recycleRows();
    const transform = this.contentTransform();
    const slot = this.#placeholderSlot();
    const placeholderHeight = slot >= 0 ? this.placeholderHeight() : null;

    // Untracked: the signals the rows' templates read must not become this effect's
    untracked(() => {
      if (transform !== this.#contentTransformSet) {
        wrapper.style.transform = transform;
        this.#contentTransformSet = transform;
      }
      this.#renderRows(outlet, template, entries, keys, trackBy, recycle);
      this.#renderPlaceholder(outlet, slot, placeholderHeight);
    });
  }

  /**
   * Give each entry a view of the item template, in order. As with `@for`, a row keeps its view
   * (and the components in it) while its track key stays rendered, and only the rows out of order
   * move. The view of a row that leaves is destroyed, or with `recycle` pooled and given to a row
   * that comes in. Only new, pooled and changed views are checked, with `detectChanges()`:
   * `markForCheck()` would mark every ancestor view up to the root too.
   */
  #renderRows(
    outlet: ViewContainerRef,
    template: TemplateRef<VirtualScrollItemContext<T>> | null,
    entries: RenderedEntry<T>[],
    keys: unknown[],
    trackBy: unknown,
    recycle: boolean,
  ): void {
    if (!recycle) {
      this.#destroyRowPool();
    }

    // Nothing to do, as on a placeholder move
    if (
      entries === this.#rowEntries &&
      template === this.#rowTemplate &&
      trackBy === this.#rowTrackBy
    ) {
      return;
    }

    // A new template renders every row anew; without one there is no row (as ngTemplateOutlet)
    if (template !== this.#rowTemplate) {
      for (const row of this.#rows) {
        row.view.destroy();
      }
      this.#rows = [];
      this.#destroyRowPool();
      this.#rowTemplate = template;
    }
    if (!template) return;

    // A new track function gives the rendered rows new keys; they keep their views (as with @for)
    if (trackBy !== this.#rowTrackBy) {
      for (const row of this.#rows) {
        const { $implicit, index } = row.view.context;
        row.key = this.trackEntry(index, { type: 'item', data: $implicit, index });
      }
      this.#rowTrackBy = trackBy;
    }

    // The last render's views by key, in order: an entry takes the first view left for its key
    const previous = new Map<unknown, RowView<T>[]>();
    for (const row of this.#rows) {
      if (row.view.destroyed) continue;
      const views = previous.get(row.key);
      if (views) {
        views.push(row);
      } else {
        previous.set(row.key, [row]);
      }
    }
    const kept = keys.map((key) => previous.get(key)?.shift());
    this.#warnDuplicateKeys(keys);

    // Remove the rows that left, then keep in place the longest run of kept views that is
    // already in order (their positions in the outlet, which now holds only kept views)
    const dragged = this.#dragState.draggedItem();
    for (const views of previous.values()) {
      for (const row of views) {
        // The dragged item's view is destroyed, as without recycling: that cancels the drag
        // instead of handing it to another item
        if (recycle && !this.#rendersDraggedItem(row.view, dragged)) {
          this.#poolRow(outlet, row.view);
        } else {
          row.view.destroy();
        }
      }
    }
    const positions = new Map<unknown, number>();
    for (let i = 0; i < outlet.length; i++) {
      positions.set(outlet.get(i), i);
    }
    const inPlace = longestIncreasingRun(kept.map((row) => (row ? positions.get(row.view)! : -1)));

    // From the last row up, so each row goes right before the next one, already in place
    const rows: RowView<T>[] = new Array(entries.length);
    const toCheck: EmbeddedViewRef<VirtualScrollItemContext<T>>[] = [];
    let next: EmbeddedViewRef<VirtualScrollItemContext<T>> | null = null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      let row = kept[i];
      if (row) {
        if (!inPlace[i]) {
          this.#moveBefore(outlet, row.view, next);
        }
        if (this.#updateContext(row.view.context, entry)) {
          toCheck.push(row.view);
        }
      } else {
        const index: number = next ? outlet.indexOf(next) : outlet.length;
        // A pooled view is checked whatever its context: nothing checked it while detached
        let view = this.#rowPool.pop();
        if (view) {
          this.#updateContext(view.context, entry);
          outlet.insert(view, index);
        } else {
          const context: VirtualScrollItemContext<T> = {
            $implicit: entry.data as T,
            index: entry.index,
            isSticky: entry.isSticky,
          };
          view = outlet.createEmbeddedView(template, context, index);
        }
        row = { key: keys[i], view };
        toCheck.push(view);
      }
      rows[i] = row;
      next = row.view;
    }
    this.#rows = rows;
    while (this.#rowPool.length > MAX_POOLED_ROWS) {
      this.#rowPool.pop()!.destroy();
    }

    // When this component's own view is checked later in this pass, that check renders every row
    if (!this.#viewCheckPending) {
      // Top to bottom (toCheck lists them bottom up)
      for (let i = toCheck.length - 1; i >= 0; i--) {
        toCheck[i].detectChanges();
      }
    }
    this.#rowEntries = entries;
  }

  /**
   * Whether a row's view renders the dragged item: its item has the dragged ID, or the view holds
   * the dragged element (its draggable ID need not be the item's ID).
   */
  #rendersDraggedItem(
    view: EmbeddedViewRef<VirtualScrollItemContext<T>>,
    dragged: DraggedItem | null,
  ): boolean {
    if (!dragged) return false;
    return (
      this.itemIdFn()(view.context.$implicit) === dragged.draggableId ||
      view.rootNodes.some((node: Node) => node.contains(dragged.element))
    );
  }

  /**
   * Take a row's view out of the outlet and pool it. It keeps its element, so its shift
   * animation is cancelled (the item it renders next must not slide from this one's position),
   * and a drop animation that hides it shows it again.
   */
  #poolRow(outlet: ViewContainerRef, view: EmbeddedViewRef<VirtualScrollItemContext<T>>): void {
    outlet.detach(outlet.indexOf(view));
    const nodes = view.rootNodes;
    // A leave animation (`animate.leave`) keeps the row in the DOM, and Angular removes it when
    // the animation ends: in the row of another item by then, if the view were reused
    if (nodes.some((node) => node.parentNode !== null)) {
      view.destroy();
      return;
    }
    for (const node of nodes) {
      if (node instanceof HTMLElement) {
        this.#shiftAnimator?.cancel(node);
      }
    }
    revealDropTargetIn(nodes);
    this.#rowPool.push(view);
  }

  #destroyRowPool(): void {
    for (const view of this.#rowPool) {
      view.destroy();
    }
    this.#rowPool = [];
  }

  /** Move a row's view right before `next` (last without one), unless it is there already. */
  #moveBefore(
    outlet: ViewContainerRef,
    view: EmbeddedViewRef<VirtualScrollItemContext<T>>,
    next: EmbeddedViewRef<VirtualScrollItemContext<T>> | null,
  ): void {
    const target = next ? outlet.indexOf(next) : outlet.length;
    const current = outlet.indexOf(view);
    if (current === target - 1) return;
    // move() takes the view out before inserting it, which shifts the views after it
    outlet.move(view, current < target ? target - 1 : target);
  }

  /** Copy an entry into a row's context. Returns whether the context changed. */
  #updateContext(context: VirtualScrollItemContext<T>, entry: RenderedEntry<T>): boolean {
    if (
      Object.is(context.$implicit, entry.data) &&
      context.index === entry.index &&
      context.isSticky === entry.isSticky
    ) {
      return false;
    }
    context.$implicit = entry.data as T;
    context.index = entry.index;
    context.isSticky = entry.isSticky;
    return true;
  }

  /** Items sharing a track key still render (a view each), but drag and drop needs unique IDs. */
  #warnDuplicateKeys(keys: unknown[]): void {
    if (this.#warnedDuplicateKeys || keys === this.#rowKeysChecked || !isDevMode()) return;
    this.#rowKeysChecked = keys;
    const seen = new Set<unknown>();
    for (const key of keys) {
      if (seen.has(key)) {
        this.#warnedDuplicateKeys = true;
        console.warn(
          `[ngx-virtual-dnd] vdnd-virtual-scroll rendered two items with the track key ` +
            `${String(key)}. Give every item a unique ID (itemIdFn, or trackByFn).`,
        );
        return;
      }
      seen.add(key);
    }
  }

  /**
   * Put the placeholder before the row at `slot` (see #placeholderSlot), or take it out of the
   * DOM. It is a DragPlaceholderComponent of its own, outside this view: moving it or setting its
   * height checks no row.
   */
  #renderPlaceholder(outlet: ViewContainerRef, slot: number, height: number | null): void {
    if (slot < 0 || height === null) {
      this.#placeholderElement()?.remove();
      return;
    }

    this.#placeholder ??= createComponent(DragPlaceholderComponent, {
      environmentInjector: this.#environmentInjector,
    });
    if (height !== this.#placeholderHeightSet) {
      this.#placeholder.setInput('itemHeight', height);
      this.#placeholder.changeDetectorRef.detectChanges();
      this.#placeholderHeightSet = height;
    }

    // Rows are inserted before the outlet's anchor, so the anchor follows the last of them
    const anchor: Node = outlet.element.nativeElement;
    const parent = anchor.parentNode;
    const element = this.#placeholderElement();
    if (!parent || !element) return;
    const before = this.#firstNodeOfRows(slot, parent) ?? anchor;
    if (element.nextSibling !== before) {
      parent.insertBefore(element, before);
    }
  }

  #placeholderElement(): HTMLElement | null {
    return this.#placeholder?.location.nativeElement ?? null;
  }

  /** The first node in `parent` of the rows from `index` on (null when none has one). */
  #firstNodeOfRows(index: number, parent: Node): Node | null {
    for (let i = index; i < this.#rows.length; i++) {
      const nodes = this.#rows[i].view.rootNodes.filter((node) => node.parentNode === parent);
      const node = firstInDocumentOrder(nodes);
      if (node) return node;
    }
    return null;
  }

  ngOnDestroy(): void {
    this.#scrollCleanup?.();
    this.#resizeCleanup?.();
    const itemResizeObserver = this.#itemResizeObserver();
    for (const element of this.#observedElementByKey.values()) {
      itemResizeObserver?.unobserve(element);
    }
    this.#observedElementByKey.clear();
    itemResizeObserver?.disconnect();
    this.#shiftAnimator?.cancelAll();
    // Detached, so not destroyed with this view
    this.#destroyRowPool();
    // Created outside this view, so not destroyed with it (and destroy() leaves it in the DOM)
    this.#placeholderElement()?.remove();
    this.#placeholder?.destroy();
    this.#placeholder = null;
  }

  #createShiftAnimator(): ShiftAnimator | null {
    const config = inject(VDND_ANIMATION_CONFIG, { optional: true });
    if (!config) return null;
    return new ShiftAnimator({
      config,
      injector: this.#injector,
      getScrollElement: () => this.#elementRef.nativeElement,
      getEntries: () => this.#shiftAnimationEntries(),
    });
  }

  /**
   * Rendered item roots, keyed by the row's track key (a recycled view renders another item, so
   * its element is no identity), and the placeholder.
   */
  *#shiftAnimationEntries(): Iterable<ShiftAnimationEntry> {
    if (this.rowOutlet()) {
      for (const row of this.#rows) {
        for (const node of row.view.rootNodes) {
          if (node instanceof HTMLElement) {
            yield [row.key, node];
          }
        }
      }
      const placeholder = this.#placeholderElement();
      if (placeholder?.isConnected) {
        yield [placeholder, placeholder];
      }
      return;
    }

    // A subclass's own template (see #render) never recycles: each element is its own identity
    const wrapper = this.#elementRef.nativeElement.querySelector(
      '.vdnd-virtual-scroll-content-wrapper',
    );
    if (!wrapper) return;
    for (const child of Array.from(wrapper.children)) {
      if (child instanceof HTMLElement) {
        yield [child, child];
      }
    }
  }

  /**
   * Create the ResizeObserver that measures individual item heights.
   */
  #createItemResizeObserver(): ResizeObserver {
    return this.#ngZone.runOutsideAngular(
      () =>
        new ResizeObserver((entries) => {
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
        }),
    );
  }

  /**
   * Observe currently rendered items' DOM elements for height changes.
   * Called after view init; re-observes after each render in dynamic mode, and every rendered
   * item when a new observer is created.
   */
  #observeRenderedItems(): void {
    // Re-observe whenever the rows change, once #render has put them in the DOM. The rows, not
    // renderedItems(): a placeholder move changes no row. A new item template changes no entry
    // but renders every row anew, as new elements.
    afterRenderEffect(
      () => {
        const observer = this.#itemResizeObserver();
        if (!observer) return;
        const rendered = this.#renderedRows();
        const idFn = this.itemIdFn();
        this.itemTemplate();

        // Find the content wrapper and observe item elements
        const wrapper = this.#elementRef.nativeElement.querySelector(
          '.vdnd-virtual-scroll-content-wrapper',
        );
        if (!wrapper) return;

        // The DOM element of each item, by its data-draggable-id: one query for all rows, where a
        // query per row scanned the wrapper once for each (quadratic in the rendered rows)
        const elementsById = mapByAttribute<HTMLElement>(wrapper, 'data-draggable-id');
        const nextObservedByKey = new Map<unknown, HTMLElement>();

        for (const entry of rendered) {
          if (entry.type !== 'item' || !entry.data) continue;
          const key = idFn(entry.data);
          const el = elementsById.get(key);
          if (el) {
            nextObservedByKey.set(key, el);
          }
        }

        for (const [key, oldElement] of this.#observedElementByKey) {
          const nextElement = nextObservedByKey.get(key);
          if (nextElement !== oldElement) {
            observer.unobserve(oldElement);
          }
        }

        for (const [key, nextElement] of nextObservedByKey) {
          const currentElement = this.#observedElementByKey.get(key);
          if (currentElement !== nextElement) {
            this.#observedElements.set(nextElement, key);
            observer.observe(nextElement);
          }
        }

        this.#observedElementByKey.clear();
        for (const [key, element] of nextObservedByKey) {
          this.#observedElementByKey.set(key, element);
        }
      },
      { injector: this.#injector },
    );
  }

  /**
   * Scroll to a specific position.
   */
  scrollTo(position: number): void {
    const element = this.#elementRef.nativeElement;
    element.scrollTop = position;
    // Store where the browser actually scrolled. It clamps to the scrollable range, and if that
    // leaves the element where it was, no scroll event arrives to correct an out-of-range value.
    this.#scrollTop.set(element.scrollTop);
  }

  /**
   * Scroll to a specific item index.
   */
  scrollToIndex(index: number): void {
    const strategy = this.#strategy();
    const position = strategy.getOffsetForIndex(index);
    this.scrollTo(position);
  }

  /**
   * Get the current scroll position.
   */
  getScrollTop(): number {
    // Read the element: the scroll signal is the rendered position, committed once per animation
    // frame and only after a 5px move. Server rendering has no layout, so fall back to it there.
    const scrollTop = this.#elementRef.nativeElement.scrollTop;
    return Number.isFinite(scrollTop) ? scrollTop : this.#scrollTop();
  }

  /**
   * Get the total scrollable height.
   */
  getScrollHeight(): number {
    return this.totalHeight();
  }

  /**
   * Scroll by a delta amount.
   */
  scrollBy(delta: number): void {
    const newPosition = Math.max(
      0,
      Math.min(this.getScrollTop() + delta, this.getScrollHeight() - this.effectiveHeight()),
    );
    this.scrollTo(newPosition);
  }
}
