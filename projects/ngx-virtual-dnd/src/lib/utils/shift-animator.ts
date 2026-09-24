import { afterNextRender, Injector } from '@angular/core';
import {
  DEFAULT_SHIFT_DURATION,
  DEFAULT_SHIFT_EASING,
  type VdndAnimationConfig,
} from '../tokens/animation-config.token';

/** A rendered element and the identity it currently represents (trackBy key). */
export type ShiftAnimationEntry = readonly [key: unknown, element: HTMLElement];

interface MeasuredPosition {
  key: unknown;
  x: number;
  y: number;
}

interface RunningShift {
  animation: Animation;
  /** Starting offset of the animation (it eases from here to 0) */
  x: number;
  y: number;
}

/** Layout changes smaller than this are ignored (sub-pixel rounding noise). */
const MIN_SHIFT_PX = 0.5;

/**
 * FLIP animator for items displaced by the drag placeholder.
 *
 * Call `beforeUpdate()` before the DOM reflects a new drag/placeholder state. When the
 * placeholder moved, it snapshots every rendered element's visual position, then after
 * the render measures again and plays a compositor-only `transform` animation from the
 * old position to the new one.
 *
 * Positions are measured relative to the scroll content, so scrolling (including
 * programmatic scroll in the same tick) never animates. Measurements include any
 * in-flight animation, so a new displacement retargets from where the item currently
 * is instead of stacking or jumping. Elements whose target did not change keep their
 * running animation untouched.
 * @internal
 */
export class ShiftAnimator {
  readonly #config: VdndAnimationConfig;
  readonly #injector: Injector;
  readonly #getScrollElement: () => HTMLElement | null;
  readonly #getEntries: () => Iterable<ShiftAnimationEntry>;

  readonly #running = new Map<HTMLElement, RunningShift>();
  #snapshot: Map<HTMLElement, MeasuredPosition> | null = null;
  #reducedMotionQuery: MediaQueryList | null | undefined;
  #wasDragging = false;
  #lastPlaceholderIndex = -1;

  constructor(options: {
    config: VdndAnimationConfig;
    injector: Injector;
    getScrollElement: () => HTMLElement | null;
    getEntries: () => Iterable<ShiftAnimationEntry>;
  }) {
    this.#config = options.config;
    this.#injector = options.injector;
    this.#getScrollElement = options.getScrollElement;
    this.#getEntries = options.getEntries;
  }

  /**
   * Notify the animator of the drag state about to be rendered.
   * @param placeholderIndex placeholder index in this list, or -1 when not shown here
   */
  beforeUpdate(isDragging: boolean, placeholderIndex: number): void {
    const wasDragging = this.#wasDragging;
    const previousIndex = this.#lastPlaceholderIndex;
    this.#wasDragging = isDragging;
    this.#lastPlaceholderIndex = placeholderIndex;

    if (!isDragging) {
      // Drop/cancel: the list re-renders with the committed order, so snap everything.
      this.#snapshot = null;
      if (wasDragging) {
        this.cancelAll();
      }
      return;
    }

    // Drag start renders the placeholder in the hidden item's slot — nothing moves.
    // A pending snapshot means another update already captured this tick's "before".
    if (!wasDragging || placeholderIndex === previousIndex || this.#snapshot) {
      return;
    }
    if (!this.#isEnabled()) {
      return;
    }

    this.#snapshot = this.#measure();
    afterNextRender(() => this.#play(), { injector: this.#injector });
  }

  /** Stop the shift animation on an element (e.g. before its view is recycled). */
  cancel(element: HTMLElement): void {
    const running = this.#running.get(element);
    if (!running) return;
    this.#running.delete(element);
    running.animation.cancel();
  }

  /** Stop every running shift animation. */
  cancelAll(): void {
    for (const running of this.#running.values()) {
      running.animation.cancel();
    }
    this.#running.clear();
  }

  #isEnabled(): boolean {
    if (this.#duration() <= 0) return false;
    if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') {
      return false;
    }
    return !this.#prefersReducedMotion();
  }

  #duration(): number {
    return this.#config.shiftDuration ?? DEFAULT_SHIFT_DURATION;
  }

  #prefersReducedMotion(): boolean {
    if (this.#reducedMotionQuery === undefined) {
      this.#reducedMotionQuery =
        typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    }
    return this.#reducedMotionQuery?.matches ?? false;
  }

  /** Scroll-content origin, so positions are independent of the scroll offset. */
  #origin(): { x: number; y: number } {
    const scrollElement = this.#getScrollElement();
    if (!scrollElement) return { x: 0, y: 0 };
    const rect = scrollElement.getBoundingClientRect();
    return { x: rect.left - scrollElement.scrollLeft, y: rect.top - scrollElement.scrollTop };
  }

  #measure(): Map<HTMLElement, MeasuredPosition> {
    const origin = this.#origin();
    const positions = new Map<HTMLElement, MeasuredPosition>();
    for (const [key, element] of this.#getEntries()) {
      const rect = element.getBoundingClientRect();
      // Hidden (display: none) elements, such as the dragged item, have no box.
      if (rect.width === 0 && rect.height === 0) continue;
      positions.set(element, { key, x: rect.left - origin.x, y: rect.top - origin.y });
    }
    return positions;
  }

  #play(): void {
    const first = this.#snapshot;
    this.#snapshot = null;
    if (!first || !this.#wasDragging) return;

    const last = this.#measure();
    const stale: HTMLElement[] = [];
    const shifts: { element: HTMLElement; x: number; y: number }[] = [];

    // Read phase — no writes until every element is measured.
    for (const [element, to] of last) {
      const from = first.get(element);
      if (!from || !Object.is(from.key, to.key)) {
        // Newly rendered or recycled for another item: must not animate from a stale offset.
        stale.push(element);
        continue;
      }

      const dx = from.x - to.x;
      const dy = from.y - to.y;
      if (Math.abs(dx) < MIN_SHIFT_PX && Math.abs(dy) < MIN_SHIFT_PX) {
        continue;
      }

      // Both measurements include the in-flight offset, so the new animation must
      // start from that offset plus the layout delta to continue from the current spot.
      const current = this.#currentOffset(element);
      shifts.push({ element, x: dx + current.x, y: dy + current.y });
    }

    // Write phase
    for (const element of stale) {
      this.cancel(element);
    }
    for (const shift of shifts) {
      this.#start(shift.element, shift.x, shift.y);
    }
  }

  #currentOffset(element: HTMLElement): { x: number; y: number } {
    const running = this.#running.get(element);
    // Effect-level easing makes `progress` the eased progress, i.e. the fraction travelled.
    const progress = running?.animation.effect?.getComputedTiming().progress;
    if (!running || progress === null || progress === undefined) {
      return { x: 0, y: 0 };
    }
    const remaining = 1 - progress;
    return { x: running.x * remaining, y: running.y * remaining };
  }

  #start(element: HTMLElement, x: number, y: number): void {
    this.#running.get(element)?.animation.cancel();

    const animation = element.animate(
      [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0px, 0px)' }],
      {
        duration: this.#duration(),
        easing: this.#config.shiftEasing ?? DEFAULT_SHIFT_EASING,
        // Layer on top of any transform the consumer already applies to the item.
        composite: 'add',
      },
    );
    this.#running.set(element, { animation, x, y });
    animation.onfinish = () => {
      if (this.#running.get(element)?.animation === animation) {
        this.#running.delete(element);
      }
    };
  }
}
