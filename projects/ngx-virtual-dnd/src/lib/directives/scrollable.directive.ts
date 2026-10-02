import {
  Directive,
  ElementRef,
  inject,
  input,
  NgZone,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { VDND_SCROLL_CONTAINER, VdndScrollContainer } from '../tokens/scroll-container.token';
import { AutoScrollConfig, AutoScrollService } from '../services/auto-scroll.service';
import {
  bindRafThrottledScrollTopSignal,
  bindResizeObserverHeightSignal,
} from '../utils/dom-signal-bindings';
import { createAutoScrollRegistration } from '../utils/auto-scroll-registration';

/**
 * Directive that marks an element as a scrollable container for virtual scrolling.
 *
 * Apply this directive to any scrollable element (with `overflow: auto` or `overflow: scroll`)
 * that contains a `*vdndVirtualFor` directive. The virtual scroll will use this element
 * as its scroll container.
 *
 * @example
 * Basic usage with a custom scroll container:
 * ```html
 * <div vdndScrollable style="overflow: auto; height: 400px;">
 *   <ng-container *vdndVirtualFor="let item of items(); itemHeight: 50; trackBy: trackById">
 *     <div>{{ item.name }}</div>
 *   </ng-container>
 * </div>
 * ```
 *
 * @example
 * With Ionic ion-content:
 * ```html
 * <ion-content vdndScrollable class="ion-content-scroll-host">
 *   <ng-container *vdndVirtualFor="let item of items(); itemHeight: 50; trackBy: trackById">
 *     <div>{{ item.name }}</div>
 *   </ng-container>
 * </ion-content>
 * ```
 *
 * @example
 * With auto-scroll configuration:
 * ```html
 * <div vdndScrollable
 *      [autoScrollEnabled]="true"
 *      [autoScrollConfig]="{ threshold: 80, maxSpeed: 20 }"
 *      style="overflow: auto; height: 400px;">
 *   ...
 * </div>
 * ```
 */
@Directive({
  selector: '[vdndScrollable]',
  providers: [{ provide: VDND_SCROLL_CONTAINER, useExisting: ScrollableDirective }],
  host: {
    class: 'vdnd-scrollable',
    '[style.overflow-anchor]': '"none"',
  },
})
export class ScrollableDirective implements VdndScrollContainer, OnInit, OnDestroy {
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
  #generatedScrollId = `vdnd-scroll-${Math.random().toString(36).slice(2, 9)}`;

  // ========== Inputs ==========

  /** Unique ID for this scroll container (used for auto-scroll registration) */
  scrollContainerId = input<string>();

  /** Whether auto-scroll is enabled when dragging near edges */
  autoScrollEnabled = input<boolean>(true);

  /** Auto-scroll configuration */
  autoScrollConfig = input<Partial<AutoScrollConfig>>({});

  // ========== VdndScrollContainer Implementation ==========

  constructor() {
    createAutoScrollRegistration({
      autoScrollService: this.#autoScrollService,
      getElement: () => this.nativeElement,
      getId: () => this.scrollContainerId() ?? this.#generatedScrollId,
      enabled: () => this.autoScrollEnabled(),
      config: () => this.autoScrollConfig(),
    });
  }

  get nativeElement(): HTMLElement {
    return this.#elementRef.nativeElement;
  }

  scrollTop(): number {
    return this.#scrollTop();
  }

  scrollTo(options: ScrollToOptions): void {
    this.nativeElement.scrollTo(options);
  }

  // ========== Additional API ==========

  /** Get the measured container height */
  containerHeight(): number {
    return this.#containerHeight();
  }

  /** Scroll by a delta amount */
  scrollBy(delta: number): void {
    const newPosition = Math.max(
      0,
      Math.min(
        // The element's position, not scrollTop(): that signal is the rendered position, committed
        // once per animation frame and only after a 5px move, so calls in one frame (or after a
        // scrollTo()) would overwrite each other and small steps would never add up.
        this.nativeElement.scrollTop + delta,
        this.nativeElement.scrollHeight - this.nativeElement.clientHeight,
      ),
    );
    this.scrollTo({ top: newPosition });
  }

  // ========== Lifecycle ==========

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
