import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  NgZone,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { VDND_VIRTUAL_VIEWPORT, VdndVirtualViewport } from '../tokens/virtual-viewport.token';
import { VDND_SCROLL_CONTAINER, VdndScrollContainer } from '../tokens/scroll-container.token';
import { AutoScrollConfig, AutoScrollService } from '../services/auto-scroll.service';
import {
  bindRafThrottledScrollTopSignal,
  bindResizeObserverHeightSignal,
} from '../utils/dom-signal-bindings';
import { createAutoScrollRegistration } from '../utils/auto-scroll-registration';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';
import { FixedHeightStrategy } from '../strategies/fixed-height.strategy';
import { DynamicHeightStrategy } from '../strategies/dynamic-height.strategy';

/**
 * A virtual viewport component that provides efficient wrapper-based positioning
 * for virtual scrolling. This component acts as the scroll container and provides
 * a content wrapper with GPU-accelerated transform positioning.
 *
 * Use this component when you need virtual scrolling with optimal performance.
 * Items rendered inside via `*vdndVirtualFor` will be positioned using a single
 * transform on the wrapper, rather than individual absolute positioning.
 *
 * @example
 * Basic usage:
 * ```html
 * <vdnd-virtual-viewport [itemHeight]="50" style="height: 400px;">
 *   <ng-container *vdndVirtualFor="let item of items(); trackBy: trackById">
 *     <div class="item">{{ item.name }}</div>
 *   </ng-container>
 * </vdnd-virtual-viewport>
 * ```
 *
 * @example
 * With dynamic item heights:
 * ```html
 * <vdnd-virtual-viewport
 *   [itemHeight]="50"
 *   [dynamicItemHeight]="true"
 *   style="height: 400px;">
 *   <ng-container *vdndVirtualFor="let item of items(); trackBy: trackById">
 *     <div class="item">{{ item.name }}</div>
 *   </ng-container>
 * </vdnd-virtual-viewport>
 * ```
 */
@Component({
  selector: 'vdnd-virtual-viewport',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: VDND_VIRTUAL_VIEWPORT, useExisting: VirtualViewportComponent },
    { provide: VDND_SCROLL_CONTAINER, useExisting: VirtualViewportComponent },
  ],
  host: {
    class: 'vdnd-virtual-viewport',
    // Read by the drag index calculator: rows start this far below the top of the scroll area
    '[attr.data-content-offset]': 'contentOffset()',
  },
  styles: `
    :host {
      display: block;
      overflow: auto;
      position: relative;
      /* Disable browser scroll anchoring to prevent scroll position adjustments
         when DOM changes (e.g., placeholder position updates during drag) */
      overflow-anchor: none;
    }

    .vdnd-viewport-spacer {
      position: absolute;
      left: 0;
      width: 1px;
      visibility: hidden;
      pointer-events: none;
    }

    .vdnd-viewport-content {
      position: absolute;
      left: 0;
      right: 0;
      will-change: transform;
    }
  `,
  template: `
    <!-- Spacer maintains total scroll height -->
    <div
      class="vdnd-viewport-spacer"
      [style.top.px]="contentOffset()"
      [style.height.px]="totalHeight()"
    ></div>

    <!-- Content wrapper with GPU-accelerated transform -->
    <div
      class="vdnd-viewport-content"
      [style.top.px]="contentOffset()"
      [style.transform]="contentTransform()"
    >
      <ng-content></ng-content>
    </div>
  `,
})
export class VirtualViewportComponent
  implements VdndVirtualViewport, VdndScrollContainer, OnInit, OnDestroy
{
  readonly #elementRef = inject(ElementRef<HTMLElement>);
  readonly #ngZone = inject(NgZone);
  readonly #autoScrollService = inject(AutoScrollService);

  /** Current scroll position (reactive) */
  readonly #scrollTop = signal(0);

  /** Measured container height (reactive) */
  readonly #containerHeight = signal(0);

  /** Cleanup function for scroll listener */
  #scrollCleanup: (() => void) | null = null;
  #resizeCleanup: (() => void) | null = null;

  /** Generated ID for auto-scroll registration */
  #generatedScrollId = `vdnd-viewport-${Math.random().toString(36).slice(2, 9)}`;

  /**
   * The actual first rendered item index, set by VirtualForDirective.
   * This accounts for overscan and is used for wrapper positioning.
   */
  readonly #renderStartIndex = signal(0);

  // ========== Inputs ==========

  /** Height of each item in pixels (used as estimate in dynamic mode) */
  itemHeight = input.required<number>();

  /**
   * Enable dynamic item height mode.
   * When true, items are auto-measured via ResizeObserver and `itemHeight`
   * serves as the initial estimate for unmeasured items.
   */
  dynamicItemHeight = input<boolean>(false);

  /** Offset for content below headers (in pixels) */
  contentOffset = input<number>(0);

  /** Unique ID for this scroll container (used for auto-scroll registration) */
  scrollContainerId = input<string>();

  /** Whether auto-scroll is enabled when dragging near edges */
  autoScrollEnabled = input<boolean>(true);

  /** Auto-scroll configuration */
  autoScrollConfig = input<Partial<AutoScrollConfig>>({});

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

  /** Total height of all items (for scroll height), derived from strategy item count */
  readonly totalHeight = computed(() => {
    const s = this.#strategy();
    s.version();
    return s.getTotalHeight(s.getItemCount());
  });

  /** Transform for content wrapper positioning */
  readonly contentTransform = computed(() => {
    const startIndex = this.#renderStartIndex();
    const s = this.#strategy();
    s.version();
    const offset = s.getOffsetForIndex(startIndex);
    return `translateY(${offset}px)`;
  });

  // ========== VdndVirtualViewport Implementation ==========

  scrollTop(): number {
    return this.#scrollTop();
  }

  containerHeight(): number {
    return this.#containerHeight();
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

  scrollTo(options: ScrollToOptions): void {
    this.nativeElement.scrollTo(options);
  }

  scrollBy(delta: number): void {
    const newPosition = Math.max(
      0,
      Math.min(
        this.scrollTop() + delta,
        this.nativeElement.scrollHeight - this.nativeElement.clientHeight,
      ),
    );
    this.scrollTo({ top: newPosition });
  }

  // ========== Lifecycle ==========

  constructor() {
    createAutoScrollRegistration({
      autoScrollService: this.#autoScrollService,
      getElement: () => this.nativeElement,
      getId: () => this.scrollContainerId() ?? this.#generatedScrollId,
      enabled: () => this.autoScrollEnabled(),
      config: () => this.autoScrollConfig(),
    });
  }

  ngOnInit(): void {
    this.#setupScrollListener();
    this.#setupResizeObserver();
  }

  ngOnDestroy(): void {
    this.#scrollCleanup?.();
    this.#resizeCleanup?.();
  }

  // ========== Private Methods ==========

  /** Minimum scroll delta (px) to trigger signal update */
  readonly #scrollThreshold = 5;

  #setupScrollListener(): void {
    this.#scrollCleanup = bindRafThrottledScrollTopSignal({
      element: this.nativeElement,
      ngZone: this.#ngZone,
      scrollTop: this.#scrollTop,
      thresholdPx: this.#scrollThreshold,
    });
  }

  #setupResizeObserver(): void {
    this.#resizeCleanup = bindResizeObserverHeightSignal({
      element: this.nativeElement,
      ngZone: this.#ngZone,
      height: this.#containerHeight,
      minDeltaPx: 1,
    });
  }
}
