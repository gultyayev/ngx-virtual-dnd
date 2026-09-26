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
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { VDND_VIRTUAL_VIEWPORT, VdndVirtualViewport } from '../tokens/virtual-viewport.token';
import { VDND_SCROLL_CONTAINER, VdndScrollContainer } from '../tokens/scroll-container.token';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';
import { FixedHeightStrategy } from '../strategies/fixed-height.strategy';
import { DynamicHeightStrategy } from '../strategies/dynamic-height.strategy';
import { ContentHeaderDirective } from '../directives/content-header.directive';

/**
 * A virtual content component that provides wrapper-based positioning
 * for virtual scrolling within an EXTERNAL scroll container.
 *
 * Use this component when you need virtual scrolling alongside other content
 * (headers, footers) within a shared scroll container. The component provides
 * a content wrapper with GPU-accelerated transform positioning while delegating
 * scroll handling to the parent `vdndScrollable` container.
 *
 * Headers marked with `vdndContentHeader` are automatically measured via
 * ResizeObserver — no manual offset calculation needed.
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

    .vdnd-content-spacer {
      position: absolute;
      top: 0;
      left: 0;
      width: 1px;
      visibility: hidden;
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
    <div class="vdnd-virtual-area" [style.height.px]="totalHeight()">
      <!-- Spacer maintains scroll height for the virtual list portion -->
      <div class="vdnd-content-spacer" [style.height.px]="totalHeight()"></div>

      <!-- Content wrapper with GPU-accelerated transform -->
      <div class="vdnd-content-wrapper" [style.transform]="contentTransform()">
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

  // ========== Inputs ==========

  /** Height of each item in pixels (used as estimate in dynamic mode) */
  itemHeight = input.required<number>();

  /**
   * Offset for content above the virtual list (e.g., header height).
   * When a `vdndContentHeader` is projected, this input is ignored —
   * the offset is auto-measured via ResizeObserver.
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

  /** Auto-measured header height from ResizeObserver */
  readonly #measuredHeaderHeight = signal(0);

  // ========== Strategy ==========

  /** The virtual scroll strategy, created based on dynamicItemHeight input */
  readonly #strategy = computed<VirtualScrollStrategy>(() => {
    const height = this.itemHeight();
    return this.dynamicItemHeight()
      ? new DynamicHeightStrategy(height)
      : new FixedHeightStrategy(height);
  });

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
   * returns the auto-measured header height. Otherwise falls back to the
   * `contentOffset` input for backward compatibility.
   */
  readonly effectiveContentOffset = computed(() => {
    const header = this.headerDirective();
    return header ? this.#measuredHeaderHeight() : this.contentOffset();
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
   */
  setRenderStartIndex(index: number): void {
    this.#renderStartIndex.set(index);
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

  // ========== Private Methods ==========

  /**
   * Sets up an effect that observes the projected header directive's element
   * with a ResizeObserver, keeping `#measuredHeaderHeight` in sync.
   */
  #setupHeaderMeasurement(): void {
    effect((onCleanup) => {
      const dir = this.headerDirective();
      if (!dir) {
        this.#measuredHeaderHeight.set(0);
        return;
      }

      // Server rendering: no layout to measure, and no ResizeObserver
      if (!this.#isBrowser) {
        return;
      }

      const el = dir.elementRef.nativeElement;
      this.#measuredHeaderHeight.set(el.offsetHeight);

      let observer: ResizeObserver | null = null;
      this.#ngZone.runOutsideAngular(() => {
        observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const height =
              entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight;
            this.#measuredHeaderHeight.set(height);
          }
        });
        observer.observe(el, { box: 'border-box' });
      });

      onCleanup(() => observer?.disconnect());
    });
  }
}
