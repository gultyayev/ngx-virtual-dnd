import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  effect,
  ElementRef,
  inject,
  input,
  NgZone,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { VDND_VIRTUAL_VIEWPORT, VdndVirtualViewport } from '../tokens/virtual-viewport.token';
import { VDND_SCROLL_CONTAINER, VdndScrollContainer } from '../tokens/scroll-container.token';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';
import { createHeightStrategy } from '../strategies/strategy-binding';
import { ContentHeaderDirective } from '../directives/content-header.directive';
import { hasViewportChanges, ViewportChangeListeners } from '../utils/viewport-changes';

/**
 * A virtual content component that provides wrapper-based positioning
 * for virtual scrolling within an EXTERNAL scroll container.
 *
 * Use this component when you need virtual scrolling alongside other content
 * (headers, footers) within a shared scroll container. The component provides
 * a content wrapper with GPU-accelerated transform positioning while delegating
 * scroll handling to the parent `vdndScrollable` container.
 *
 * With a header marked `vdndContentHeader`, the component measures where its rows start in the
 * scroll container's content (the header with its margins and everything above it: the
 * container's padding, the component's border and padding, content before it), again whenever
 * the header or the container resizes — no manual offset calculation needed. Content above the
 * component that changes height on its own is counted at the next such resize: put it in the
 * header, or pass `contentOffset` without a header.
 *
 * @example
 * Content projection with auto-measured header:
 * ```html
 * <div vdndScrollable style="overflow: auto; height: 100vh;">
 *   <vdnd-virtual-content [itemHeight]="50">
 *     <div class="header" vdndContentHeader>Welcome!</div>
 *     <ng-container *vdndVirtualFor="let item of items(); trackBy: trackById">
 *       <div class="item">{{ item.name }}</div>
 *     </ng-container>
 *   </vdnd-virtual-content>
 * </div>
 * ```
 *
 * @example
 * Manual offset (escape hatch):
 * ```html
 * <div vdndScrollable style="overflow: auto; height: 100vh;">
 *   <div class="header" #header>Welcome!</div>
 *   <vdnd-virtual-content [itemHeight]="50" [contentOffset]="header.offsetHeight">
 *     <ng-container *vdndVirtualFor="let item of items(); trackBy: trackById">
 *       <div class="item">{{ item.name }}</div>
 *     </ng-container>
 *   </vdnd-virtual-content>
 * </div>
 * ```
 */
@Component({
  selector: 'vdnd-virtual-content',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: VDND_VIRTUAL_VIEWPORT, useExisting: VirtualContentComponent },
    { provide: VDND_SCROLL_CONTAINER, useExisting: VirtualContentComponent },
  ],
  host: {
    class: 'vdnd-virtual-content',
    '[attr.data-content-offset]': 'effectiveContentOffset()',
    '[attr.data-item-height]': 'itemHeight()',
    '[attr.data-total-items]': 'totalItems()',
  },
  styles: `
    :host {
      display: block;
      position: relative;
    }

    .vdnd-virtual-area {
      position: relative;
    }

    /* As wide as the list and painted under the rows, for an app's placeholder rows
       (vdnd-virtual-spacer): the frames a fast scroll shows before its rows render show it */
    .vdnd-content-spacer {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      pointer-events: none;
    }

    .vdnd-content-wrapper {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      will-change: transform;
    }
  `,
  template: `
    <!-- Projected header — in normal document flow, auto-measured via ResizeObserver -->
    <ng-content select="[vdndContentHeader]" />

    <!-- Virtual area — sized to totalHeight, contains absolute-positioned spacer + wrapper -->
    <div #virtualArea class="vdnd-virtual-area" [style.height.px]="totalHeight()">
      <!-- Spacer maintains scroll height for the virtual list portion -->
      <div class="vdnd-content-spacer vdnd-virtual-spacer" [style.height.px]="totalHeight()"></div>

      <!-- Content wrapper with GPU-accelerated transform. Written, not bound: it moves with the
           rows, which *vdndVirtualFor renders in the scroll event (see setRenderStartIndex). -->
      <div #contentWrapper class="vdnd-content-wrapper vdnd-virtual-rows">
        <ng-content />
      </div>
    </div>
  `,
})
export class VirtualContentComponent implements VdndVirtualViewport, VdndScrollContainer {
  readonly #elementRef = inject(ElementRef<HTMLElement>);
  readonly #ngZone = inject(NgZone);
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /**
   * The parent scroll container injected via skip-self to get the actual scrollable element.
   * We provide our own VDND_SCROLL_CONTAINER with adjusted values to children.
   */
  readonly #parentScrollContainer = inject(VDND_SCROLL_CONTAINER, { skipSelf: true });

  // ========== Content Queries ==========

  /** Projected header directive (if any) */
  private readonly headerDirective = contentChild(ContentHeaderDirective);

  /** The rows' box, right below the header: where the list starts */
  private readonly virtualArea = viewChild<ElementRef<HTMLElement>>('virtualArea');

  /** The content wrapper, which the transform moves to the first rendered row */
  private readonly contentWrapper = viewChild<ElementRef<HTMLElement>>('contentWrapper');

  // ========== Inputs ==========

  /** Height of each item in pixels (used as estimate in dynamic mode) */
  itemHeight = input.required<number>();

  /**
   * Offset for content above the virtual list (e.g., header height): where the rows start in
   * the scroll container's content, measured from inside its border.
   * When a `vdndContentHeader` is projected, this input is ignored — the component
   * measures where its rows start instead (the header and everything above it).
   * Use this input only when the header lives outside the component.
   */
  contentOffset = input<number>(0);

  /**
   * Enable dynamic item height mode.
   * When true, items are auto-measured via ResizeObserver and `itemHeight`
   * serves as the initial estimate for unmeasured items.
   */
  dynamicItemHeight = input<boolean>(false);

  // ========== Internal State ==========

  /**
   * The actual first rendered item index, set by VirtualForDirective.
   * This accounts for overscan and is used for wrapper positioning.
   */
  readonly #renderStartIndex = signal(0);

  /**
   * Where the rows start in the parent scroll container's content, measured while a header is
   * projected: the header with its margins and everything above it (the container's padding,
   * this element's border and padding, content before it).
   */
  readonly #measuredRowsOffset = signal(0);

  /** Content transform last written to the content wrapper */
  #contentTransformSet: string | null = null;

  /** The lists that render the rows a header resize moves into view, before it is painted */
  readonly #headerChanges = new ViewportChangeListeners();

  // ========== Strategy ==========

  /** The virtual scroll strategy, created based on dynamicItemHeight input */
  readonly #strategy = computed<VirtualScrollStrategy>(() =>
    createHeightStrategy(this.itemHeight(), this.dynamicItemHeight()),
  );

  get strategy(): VirtualScrollStrategy {
    return this.#strategy();
  }

  // ========== Computed Values ==========

  /** Total item count, derived from strategy (populated by VirtualForDirective) */
  readonly totalItems = computed(() => {
    const s = this.#strategy();
    s.version();
    return s.getItemCount();
  });

  /** Total height of all items (for scroll height) */
  readonly totalHeight = computed(() => {
    const s = this.#strategy();
    s.version();
    return s.getTotalHeight(s.getItemCount());
  });

  /**
   * Effective content offset: when a `vdndContentHeader` directive is projected,
   * returns where the rows start (measured). Otherwise falls back to the
   * `contentOffset` input for backward compatibility.
   */
  readonly effectiveContentOffset = computed(() => {
    const header = this.headerDirective();
    return header ? this.#measuredRowsOffset() : this.contentOffset();
  });

  /**
   * Adjusted scroll position - subtracts the content offset so the virtual scroll
   * calculates visible items correctly relative to where the list starts.
   */
  readonly #adjustedScrollTop = computed(() => {
    return Math.max(0, this.#parentScrollContainer.scrollTop() - this.effectiveContentOffset());
  });

  /** Transform for content wrapper positioning */
  readonly contentTransform = computed(() => {
    const startIndex = this.#renderStartIndex();
    const s = this.#strategy();
    s.version();
    const offset = s.getOffsetForIndex(startIndex);
    return `translateY(${offset}px)`;
  });

  constructor() {
    this.#setupHeaderMeasurement();
    // The offset also follows the strategy's offsets: measured heights, a dragged item's slot
    effect(() => this.#writeContentTransform());
  }

  // ========== VdndVirtualViewport Implementation ==========

  /** Adjusted scroll position relative to the virtual list start */
  scrollTop(): number {
    return this.#adjustedScrollTop();
  }

  containerHeight(): number {
    return this.#parentScrollContainer.containerHeight();
  }

  get nativeElement(): HTMLElement {
    return this.#elementRef.nativeElement;
  }

  /**
   * Called by VirtualForDirective to inform this viewport of the actual
   * first rendered item index. Used for wrapper positioning.
   *
   * The wrapper moves right away: the directive renders the rows of a scroll in its scroll event,
   * and they must show at their offset in the frame that first shows the scroll.
   */
  setRenderStartIndex(index: number): void {
    this.#renderStartIndex.set(index);
    // Untracked: the directive calls this from its effect, which must not depend on it
    untracked(() => this.#writeContentTransform());
  }

  getOffsetForIndex(index: number): number {
    return this.#strategy().getOffsetForIndex(index);
  }

  // ========== VdndScrollContainer Implementation ==========

  /**
   * Scroll to a specific position, adjusting for content offset.
   */
  scrollTo(options: ScrollToOptions): void {
    const adjustedOptions = { ...options };
    if (adjustedOptions.top !== undefined) {
      // Add offset back when scrolling to ensure correct position
      adjustedOptions.top += this.effectiveContentOffset();
    }
    this.#parentScrollContainer.scrollTo(adjustedOptions);
  }

  /**
   * Call `listener` after each change of what the parent scroll container shows (its scroll and
   * resizes, when it tells about them: a custom scroll container doesn't), and after each header
   * resize that moves the rows: before the browser paints them (`*vdndVirtualFor` renders its rows
   * there). Returns the unsubscribe.
   *
   * @internal
   */
  onViewportChange(listener: () => void): () => void {
    const parent = this.#parentScrollContainer;
    const stopParent = hasViewportChanges(parent)
      ? parent.onViewportChange(listener)
      : () => undefined;
    const stopHeader = this.#headerChanges.onViewportChange(listener);
    return () => {
      stopParent();
      stopHeader();
    };
  }

  // ========== Private Methods ==========

  /** Move the content wrapper to the first rendered row's offset, unless it is there already. */
  #writeContentTransform(): void {
    const transform = this.contentTransform();
    const wrapper = this.contentWrapper()?.nativeElement;
    if (!wrapper || transform === this.#contentTransformSet) return;
    wrapper.style.transform = transform;
    this.#contentTransformSet = transform;
  }

  /**
   * Keeps `#measuredRowsOffset` in sync while a header is projected: measures now, and again
   * whenever a ResizeObserver reports the header or the parent scroll container resizing (the
   * container's width can reflow what sits above the header). The observer reports after the
   * frame's layout and before its paint: the lists render the rows a new offset moves into view
   * right away, or that frame would show the rows where the old offset put them.
   */
  #setupHeaderMeasurement(): void {
    effect((onCleanup) => {
      const dir = this.headerDirective();
      if (!dir) {
        this.#measuredRowsOffset.set(0);
        return;
      }

      // Server rendering: no layout to measure, and no ResizeObserver
      if (!this.#isBrowser) {
        return;
      }

      const header = dir.elementRef.nativeElement;
      const container = this.#parentScrollContainer.nativeElement;
      /** Returns whether the offset changed */
      const measure = (): boolean => {
        const offset = this.#measureRowsOffset(container);
        if (offset === null || offset === untracked(this.#measuredRowsOffset)) {
          return false;
        }
        this.#measuredRowsOffset.set(offset);
        return true;
      };
      // In change detection: the lists' effects render it in this pass
      measure();

      let observer: ResizeObserver | null = null;
      this.#ngZone.runOutsideAngular(() => {
        observer = new ResizeObserver(() => {
          if (measure()) {
            this.#headerChanges.notify();
          }
        });
        observer.observe(header, { box: 'border-box' });
        observer.observe(container);
      });

      onCleanup(() => observer?.disconnect());
    });
  }

  /**
   * Where the rows start in `container`'s scrolled content, as `contentOffset` counts it: from the
   * top of the content, inside the container's border. In layout pixels: a transform that scales
   * the container while it is measured (a zoom-in animation) is divided out, as no resize follows
   * when it ends. Null while the container has no layout box or the rows' box isn't rendered.
   */
  #measureRowsOffset(container: HTMLElement): number | null {
    const area = this.virtualArea()?.nativeElement;
    const layoutHeight = container.offsetHeight;
    if (!area || layoutHeight === 0) {
      return null;
    }
    const box = container.getBoundingClientRect();
    // offsetHeight is rounded to whole pixels: only a transform moves the ratio this far from 1
    const ratio = box.height / layoutHeight;
    const scale = Math.abs(ratio - 1) > 0.01 ? ratio : 1;
    return (
      (area.getBoundingClientRect().top - box.top) / scale -
      container.clientTop +
      container.scrollTop
    );
  }
}
