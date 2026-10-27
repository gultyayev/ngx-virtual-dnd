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
  EnvironmentInjector,
  inject,
  Injector,
  input,
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
import { AutoScrollConfig, AutoScrollService } from '../services/auto-scroll.service';
import { KeyboardDragService } from '../services/keyboard-drag.service';
import { DragPlaceholderComponent } from './drag-placeholder.component';
import {
  bindRafThrottledScrollTopSignal,
  bindResizeObserverHeightSignal,
} from '../utils/dom-signal-bindings';
import { createAutoScrollRegistration } from '../utils/auto-scroll-registration';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';
import { bindListStrategy, createHeightStrategy } from '../strategies/strategy-binding';
import { mapByAttribute } from '../utils/attribute-selectors';
import { VDND_ANIMATION_CONFIG } from '../tokens/animation-config.token';
import { ShiftAnimationEntry, ShiftAnimator } from '../utils/shift-animator';
import { ComponentRowRenderer, RenderedEntry } from '../rendering/component-row-renderer';
import { refreshDragOnScrollInsetChange } from '../utils/scroll-insets-refresh';
import {
  clipToScrollContainers,
  revealRangeAround,
  scrollAncestors,
  validScrollInset,
} from '../utils/scroll-insets';

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
/** A row starting less than this above the viewport's bottom edge shows nothing (sub-pixel) */
const BOTTOM_EDGE_TOLERANCE_PX = 0.5;

@Component({
  selector: 'vdnd-virtual-scroll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'vdnd-virtual-scroll',
    '[style.height.px]': 'containerHeight() ?? null',
    '[attr.data-item-height]': 'itemHeight()',
    '[attr.data-total-items]': 'items().length',
    '[attr.data-scroll-inset-top]': 'rowsTop() || null',
    '[attr.data-scroll-inset-bottom]': 'rowsBottomSpace() || null',
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

  /** Where the row renderer inserts the rows (cannot use ES private with viewChild) */
  private readonly rowOutlet = viewChild('rows', { read: ViewContainerRef });

  /** The rows of the item template (see ComponentRowRenderer) */
  readonly #rowRenderer = new ComponentRowRenderer<T>({
    trackItem: (index, item) => this.trackEntry(index, { type: 'item', data: item, index }),
    itemId: (item) => this.itemIdFn()(item),
    draggedItem: () => this.#dragState.draggedItem(),
    shiftAnimator: this.#shiftAnimator,
  });

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

  /** The content wrapper's bottom padding last set (see #render) */
  #contentPaddingSet: string | null = null;

  /** Whether #revealPlaceholder is scheduled to run again after the next render */
  #revealAfterRenderPending = false;

  /** Template for rendering each item - passed as input instead of content child for reliability */
  itemTemplate = input.required<TemplateRef<VirtualScrollItemContext<T>>>();

  /** Unique ID for this scroll container (used for auto-scroll registration) */
  scrollContainerId = input<string>();

  /** Whether auto-scroll is enabled when dragging near edges */
  autoScrollEnabled = input<boolean>(true);

  /** Auto-scroll configuration */
  autoScrollConfig = input<Partial<AutoScrollConfig>>({});

  /**
   * Space (px) at the top of the list covered by content pinned over it, such as a header
   * overlaid on its rows. A drag treats the list as starting below it: `constrainToContainer`
   * keeps the preview under it, the top autoscroll zone starts at its lower edge (the pointer over
   * it scrolls at full speed), a pointer over it is not over the list, and a keyboard drag keeps
   * the placeholder below it. The rows start below it and the scroll range ends with as much
   * space below them as `scrollInsetBottom` covers, so the first and last rows can scroll clear
   * of both. Measured from the element's border box.
   */
  scrollInsetTop = input<number>(0);

  /** Space (px) at the bottom of the list covered by content pinned over it: see `scrollInsetTop`. */
  scrollInsetBottom = input<number>(0);

  /** The space reserved above the rows: `scrollInsetTop`, or 0 when negative or invalid. */
  protected readonly rowsTop = computed(() => validScrollInset(this.scrollInsetTop()));

  /** The space reserved below the rows: `scrollInsetBottom`, or 0 when negative or invalid. */
  protected readonly rowsBottomSpace = computed(() => validScrollInset(this.scrollInsetBottom()));

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
  readonly #strategy = computed<VirtualScrollStrategy>(() =>
    createHeightStrategy(this.itemHeight(), this.dynamicItemHeight()),
  );

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

  /** Height of the scroll content (for the scrollbar): all items and the space around them */
  protected readonly totalHeight = computed(() => {
    const count = this.items().length;
    const strategy = this.#strategy();
    strategy.version();
    return this.rowsTop() + strategy.getTotalHeight(count) + this.rowsBottomSpace();
  });

  /** Scroll offset into the rows (0 while the space above them is in view) */
  readonly #rowsScrollTop = computed(() => Math.max(0, this.#scrollTop() - this.rowsTop()));

  /** First visible item index */
  readonly #firstVisibleIndex = computed(() => {
    const strategy = this.#strategy();
    strategy.version();
    return strategy.getFirstVisibleIndex(this.#rowsScrollTop());
  });

  /** Number of items visible in the viewport after the first visible one */
  readonly #visibleCount = computed(() => {
    const height = this.effectiveHeight();
    const strategy = this.#strategy();
    strategy.version();
    const first = this.#firstVisibleIndex();
    // The strategy counts from the first visible row's top, plus a row for the part of it
    // scrolled away, which is enough unless that row is taller than the next ones (a tall row
    // that has mostly scrolled away): then count on to the row at the viewport's bottom edge.
    // Not to a row that starts there, which shows nothing: a fixed-height list renders the rows
    // it always has.
    const last = strategy.getFirstVisibleIndex(
      this.#rowsScrollTop() + Math.max(0, height - BOTTOM_EDGE_TOLERANCE_PX),
    );
    return Math.max(strategy.getVisibleCount(first, height), last - first);
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

    const offset = this.rowsTop() + strategy.getOffsetForIndex(start);
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

  constructor() {
    createAutoScrollRegistration({
      autoScrollService: this.#autoScrollService,
      getElement: () => this.#elementRef.nativeElement,
      getId: () => this.scrollContainerId() ?? this.#generatedScrollId,
      enabled: () => this.autoScrollEnabled(),
      config: () => this.autoScrollConfig(),
    });
    refreshDragOnScrollInsetChange(this.scrollInsetTop, this.scrollInsetBottom);

    // The strategy's items, registration and dragged-item exclusion
    bindListStrategy({
      strategy: this.#strategy,
      itemCount: () => this.items().length,
      itemKeys: this.#itemIds,
      // Read when the effect runs: a subclass can override the input with a field of its own
      droppableId: () => this.droppableId(),
      excludedIndex: this.#draggedItemIndex,
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

    // At drag end, keep a row dropped into this list in view. Every other list, and every drop
    // whose row stays in view, keeps its scroll position: the dropped row renders where the
    // placeholder was.
    effect(() => {
      const currentDraggedId = this.draggedItemId();
      const dragEnded = this.#previousDraggedId !== null && currentDraggedId === null;
      this.#previousDraggedId = currentDraggedId;
      if (dragEnded) {
        untracked(() => this.#revealDroppedItem());
      }
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
      scrollTop: this.#scrollTop,
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

    // Calculate placeholder position using strategy (rows start below the top inset)
    const targetTop = this.rowsTop() + strategy.getOffsetForIndex(placeholderIndex);
    const targetBottom = targetTop + this.placeholderHeight();

    // Calculate visible range: the part content pinned over the edges doesn't cover (read
    // tracked, so a keyboard drag reveals the placeholder again when it changes)
    const { hiddenTop, hiddenBottom } = this.#hiddenEdges(element, height);
    const viewportTop = currentScrollTop + hiddenTop;
    const viewportBottom = currentScrollTop + height - hiddenBottom;

    // Check if target is fully visible
    if (targetTop < viewportTop) {
      // Target is above viewport - scroll up
      const newScrollTop = Math.max(0, targetTop - hiddenTop);
      element.scrollTop = newScrollTop;
      this.#scrollTop.set(newScrollTop);
    } else if (targetBottom > viewportBottom) {
      // Target is below viewport - scroll down
      const newScrollTop = targetBottom - height + hiddenBottom;
      element.scrollTop = newScrollTop;
      this.#scrollTop.set(newScrollTop);
      if (!isFollowUp) {
        // The follow-up reveals it through the containers around the list: until then the
        // content can be one placeholder short
        this.#revealPlaceholderAfterRender();
        return;
      }
    }

    // The list scrolls the placeholder no further than its own scroll range: at its first slot,
    // a page's sticky header can still cover it. The containers around it reveal the rest.
    const top = element.getBoundingClientRect().top + targetTop - element.scrollTop;
    revealRangeAround(element, top, top + this.placeholderHeight());
  }

  /**
   * How much of the list's top and bottom (px) a keyboard drag keeps its placeholder out of: its
   * own scroll insets, and what the scroll containers around it cover or clip beyond them (a
   * page's sticky header the list scrolls under). Only its own insets while those containers
   * leave less than the placeholder of it.
   */
  #hiddenEdges(element: HTMLElement, height: number): { hiddenTop: number; hiddenBottom: number } {
    const hiddenTop = this.rowsTop();
    const hiddenBottom = this.rowsBottomSpace();
    const ancestors = scrollAncestors(element);
    const uncoveredHeight = height - hiddenTop - hiddenBottom;
    if (ancestors.length === 0 || uncoveredHeight <= 0) {
      return { hiddenTop, hiddenBottom };
    }
    const rect = element.getBoundingClientRect();
    const shown = clipToScrollContainers(
      new DOMRect(rect.left, rect.top + hiddenTop, rect.width, uncoveredHeight),
      ancestors,
    );
    if (!shown || shown.height < this.placeholderHeight()) {
      return { hiddenTop, hiddenBottom };
    }
    return { hiddenTop: shown.top - rect.top, hiddenBottom: rect.top + height - shown.bottom };
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
    // The space reserved below the rows follows the last one rendered, the placeholder after it
    // too: in a drag from another list it renders past the spacer's end
    const padding = `${this.rowsBottomSpace()}px`;
    const slot = this.#placeholderSlot();
    const placeholderHeight = slot >= 0 ? this.placeholderHeight() : null;

    // Untracked: the signals the rows' templates read must not become this effect's
    untracked(() => {
      if (transform !== this.#contentTransformSet) {
        wrapper.style.transform = transform;
        this.#contentTransformSet = transform;
      }
      if (padding !== this.#contentPaddingSet) {
        wrapper.style.paddingBottom = padding;
        this.#contentPaddingSet = padding;
      }
      this.#rowRenderer.render(
        outlet,
        template,
        entries,
        keys,
        trackBy,
        recycle,
        this.#viewCheckPending,
      );
      this.#renderPlaceholder(outlet, slot, placeholderHeight);
    });
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
    const before = this.#rowRenderer.firstNodeOfRows(slot, parent) ?? anchor;
    if (element.nextSibling !== before) {
      parent.insertBefore(element, before);
    }
  }

  #placeholderElement(): HTMLElement | null {
    return this.#placeholder?.location.nativeElement ?? null;
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
    this.#rowRenderer.destroyPool();
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
   * After a drop into this list, show its row whole when it renders cut off by an edge of the
   * visible area or less than a row's height outside it, scrolling just enough: a drop after the
   * last row of a list scrolled to (or near) its bottom lands right below it. A row that renders
   * in view stays where the placeholder showed it, and one far outside the view (its placeholder
   * was out of view too) leaves the list where the user left it.
   */
  #revealDroppedItem(): void {
    const droppableId = this.droppableId();
    const ended = this.#dragState.endedDragState();
    const placeholderIndex = ended?.placeholderIndex ?? -1;
    if (
      !droppableId ||
      !ended?.draggedItem ||
      this.#dragState.wasCancelled() ||
      ended.activeDroppableId !== droppableId ||
      placeholderIndex < 0
    ) {
      return;
    }
    const draggedId = ended.draggedItem.draggableId;
    // A row dropped from another list is not measured here yet: with dynamic heights it renders
    // as tall as the dragged item (the placeholder's height), not the estimate.
    const unmeasuredHeight =
      this.dynamicItemHeight() && ended.sourceDroppableId !== droppableId
        ? ended.draggedItem.height
        : 0;

    // In the write phase: before the drop animation (and shift animations) measure the rows.
    afterNextRender(
      {
        write: () => {
          // The consumer's drop handler has inserted the row by now, at the drop's destination
          // index: the placeholder index, or one less below its source in the same list. A drop
          // it did not apply there scrolls nothing.
          const items = this.items();
          const idFn = this.itemIdFn();
          const index = [placeholderIndex, placeholderIndex - 1].find(
            (i) => i >= 0 && i < items.length && idFn(items[i]) === draggedId,
          );
          const height = this.effectiveHeight();
          if (index === undefined || height <= 0) return;

          const strategy = this.#strategy();
          const rowHeight = unmeasuredHeight > 0 ? unmeasuredHeight : strategy.getItemHeight(index);
          // In the part of the list its insets leave uncovered (rows start below the top one)
          const insetTop = this.rowsTop();
          const shownHeight = Math.max(0, height - insetTop - this.rowsBottomSpace());
          const top = strategy.getOffsetForIndex(index);
          const bottom = top + rowHeight;
          const element = this.#elementRef.nativeElement;
          const scrollTop = element.scrollTop;
          // Near: within a row's height of the view, but no more than the view's own height
          const margin = Math.min(rowHeight, shownHeight);
          if (top > scrollTop + shownHeight + margin || bottom < scrollTop - margin) return;
          let target: number;
          if (top < scrollTop) {
            target = top;
          } else if (bottom > scrollTop + shownHeight) {
            // A row taller than the viewport shows its top
            target = Math.min(top, bottom - shownHeight);
          } else {
            return;
          }
          element.scrollTop = target;
          this.#scrollTop.set(element.scrollTop);
        },
      },
      { injector: this.#injector },
    );
  }

  /**
   * Rendered item roots, keyed by the row's track key (a recycled view renders another item, so
   * its element is no identity), and the placeholder.
   */
  *#shiftAnimationEntries(): Iterable<ShiftAnimationEntry> {
    if (this.rowOutlet()) {
      for (const row of this.#rowRenderer.rows) {
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
   * Scroll to a specific item index: its row starts at the top of the part `scrollInsetTop`
   * leaves uncovered.
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
   * Get the total scrollable height: the rows and the space reserved around them.
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
