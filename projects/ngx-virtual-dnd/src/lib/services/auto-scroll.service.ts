import { inject, Injectable } from '@angular/core';
import { CursorPosition } from '../models/drag-drop.models';
import { DragStateService } from './drag-state.service';
import { PositionCalculatorService } from './position-calculator.service';
import { DragSchedulerService } from './drag-scheduler.service';

/**
 * Configuration for auto-scroll behavior.
 */
export interface AutoScrollConfig {
  /** Distance from edge to start scrolling (in pixels) */
  threshold: number;
  /** Maximum scroll speed in pixels per 60fps frame (about 16.67ms) */
  maxSpeed: number;
  /** Whether to accelerate scroll based on distance from edge */
  accelerate: boolean;
}

/**
 * Default auto-scroll configuration.
 */
const DEFAULT_CONFIG: AutoScrollConfig = {
  threshold: 50,
  maxSpeed: 15,
  accelerate: true,
};

const BASE_FRAME_DURATION_MS = 1000 / 60;
const MIN_SCROLL_FRAME_SCALE = 1;
const MAX_SCROLL_FRAME_SCALE = 6;

/**
 * A container the tick asked to scroll that had no room: the axes it was asked to scroll, and its
 * scroll position and maximum then, to tell when it may have gained room.
 */
interface ExhaustedContainer {
  element: HTMLElement;
  vertical: boolean;
  horizontal: boolean;
  scrollTop: number;
  scrollLeft: number;
  maxScrollTop: number;
  maxScrollLeft: number;
}

/**
 * Service that handles auto-scrolling when dragging near container edges.
 */
@Injectable({
  providedIn: 'root',
})
export class AutoScrollService {
  readonly #dragState = inject(DragStateService);
  readonly #positionCalculator = inject(PositionCalculatorService);
  readonly #scheduler = inject(DragSchedulerService);

  /** Currently registered scrollable containers */
  #scrollableContainers = new Map<
    string,
    {
      element: HTMLElement;
      config: AutoScrollConfig;
    }
  >();

  /**
   * Candidate containers ordered innermost (deepest in the DOM) first, so a
   * nested scrollable wins over its ancestors under the cursor. Rebuilt lazily
   * whenever registrations change (containers rarely move mid-drag) and once per
   * drag (see startMonitoring), not per frame.
   */
  #orderedContainers:
    | { id: string; element: HTMLElement; config: AutoScrollConfig; depth: number }[]
    | null = null;

  /** Bound reference to #participantTick for stable add/remove with the scheduler. */
  readonly #boundParticipantTick: () => void = () => this.#participantTick();

  /** Callback to invoke when scrolling occurs (for placeholder recalculation) */
  #onScrollCallback: (() => void) | null = null;

  /** Optional cursor position override for edge detection (bypasses DragState read) */
  #cursorOverride: CursorPosition | null = null;

  /** Last tick cursor position for stationary detection */
  #lastTickCursorX = NaN;
  #lastTickCursorY = NaN;

  /**
   * The containers the last tick that ran asked to scroll but had no room left: the first
   * #exhaustedCount entries (the objects are reused from tick to tick). A resting cursor skips the
   * tick only while they stay as they were on the axes it asked for: content that grows (rows
   * measured taller, items added), a resize or a scroll can give one room, and the scroll resumes.
   */
  readonly #exhausted: ExhaustedContainer[] = [];
  #exhaustedCount = 0;

  /**
   * Last timestamp used to scale per-frame autoscroll distance by elapsed frame time.
   * Scale is intentionally floored at 1 to preserve the existing feel on 60fps+ displays while
   * compensating slower frames that would otherwise under-scroll.
   */
  #lastScrollTimestamp = 0;

  /** Reusable direction object for tick loop (avoids per-frame allocation) */
  readonly #tickDirection = { x: 0, y: 0 };

  /** Current scroll state */
  readonly #scrollState: {
    containerId: string | null;
    direction: { x: number; y: number };
    speed: number;
  } = {
    containerId: null,
    direction: { x: 0, y: 0 },
    speed: 0,
  };

  /**
   * Register a scrollable container for auto-scrolling.
   */
  registerContainer(
    id: string,
    element: HTMLElement,
    config: Partial<AutoScrollConfig> = {},
  ): void {
    this.#scrollableContainers.set(id, {
      element,
      config: { ...DEFAULT_CONFIG, ...config },
    });
    this.#orderedContainers = null;
  }

  /**
   * Unregister a scrollable container.
   */
  unregisterContainer(id: string): void {
    this.#scrollableContainers.delete(id);
    this.#orderedContainers = null;
  }

  /**
   * Build (or reuse) the candidate list ordered innermost-first by DOM depth.
   *
   * Sorting by absolute DOM depth (descending) is a *total* order, unlike an
   * `element.contains()` comparator which returns 0 for unrelated pairs and so
   * violates transitivity — with ≥3 containers a nested pair separated by an
   * unrelated one in registration order could end up never compared, leaving the
   * ancestor ahead of its descendant. Equal-depth (including unrelated) containers
   * keep registration order via the stable sort, so unrelated lists behave as before.
   */
  #getOrderedContainers(): {
    id: string;
    element: HTMLElement;
    config: AutoScrollConfig;
    depth: number;
  }[] {
    if (this.#orderedContainers) {
      return this.#orderedContainers;
    }

    const entries: {
      id: string;
      element: HTMLElement;
      config: AutoScrollConfig;
      depth: number;
    }[] = [];
    for (const [id, { element, config }] of this.#scrollableContainers) {
      // Registration is unconditional (directives can't expose DOM size as a signal, so
      // gating registration on it goes stale — see #27). Filter by live scroll geometry
      // here instead: this list is rebuilt per drag (startMonitoring nulls the cache) and
      // on register/unregister, so a container that grew scrollable after init is picked
      // up on the next drag, and one that shrank stops occupying a candidate slot.
      if (!this.#isScrollable(element)) {
        continue;
      }
      entries.push({ id, element, config, depth: this.#domDepth(element) });
    }

    // Deepest first; stable sort keeps registration order on ties.
    entries.sort((a, b) => b.depth - a.depth);

    this.#orderedContainers = entries;
    return entries;
  }

  /**
   * Whether the element currently has room to scroll on either axis. Read fresh each
   * time the candidate list is (re)built — never cached — so it always reflects the
   * live layout at drag start rather than a stale value captured at registration.
   */
  #isScrollable(element: HTMLElement): boolean {
    return element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth;
  }

  /** Number of ancestor elements — the element's absolute depth in the DOM tree. */
  #domDepth(element: HTMLElement): number {
    let depth = 0;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      depth++;
    }
    return depth;
  }

  /**
   * Start monitoring for auto-scroll.
   * Registers this service as a tick participant in DragSchedulerService.
   * The scheduler drives the RAF loop; this service handles scroll logic each frame.
   * @param onScroll Optional callback to invoke when scrolling occurs (for placeholder recalculation)
   */
  startMonitoring(onScroll?: () => void): void {
    this.#onScrollCallback = onScroll ?? null;
    // Recompute containment ordering fresh per drag: a registered container may have
    // been reparented (portal/DOM move) since the cache was built, which register/
    // unregister alone wouldn't catch.
    this.#orderedContainers = null;
    this.#scheduler.addParticipant(this.#boundParticipantTick);
  }

  /**
   * Stop monitoring for auto-scroll.
   * Removes this service from the scheduler's participant list.
   * Call this when a drag ends.
   */
  stopMonitoring(): void {
    this.#scheduler.removeParticipant(this.#boundParticipantTick);
    this.#onScrollCallback = null;
    this.#cursorOverride = null;
    this.#lastTickCursorX = NaN;
    this.#lastTickCursorY = NaN;
    this.#exhausted.length = 0;
    this.#exhaustedCount = 0;
    this.#lastScrollTimestamp = 0;
    this.#scrollState.containerId = null;
    this.#scrollState.direction.x = 0;
    this.#scrollState.direction.y = 0;
    this.#scrollState.speed = 0;
  }

  /**
   * Override the cursor position used for edge detection.
   * When set, #tick() uses this instead of DragStateService.cursorPosition().
   * Used by constrainToContainer to provide a position without grabOffset distortion.
   * @internal
   */
  setCursorOverride(position: CursorPosition): void {
    this.#cursorOverride = position;
  }

  /**
   * Participant tick — called by DragSchedulerService each RAF frame.
   *
   * Runs the edge-scroll check and, if a scroll is performed, synchronously
   * invokes #onScrollCallback (the placeholder recalculator) in the same frame.
   * No RAF scheduling here — the scheduler owns the loop.
   */
  #participantTick(): void {
    const cursor = this.#cursorOverride ?? this.#dragState.cursorPosition();

    // No cursor yet — nothing to scroll toward.
    if (!cursor) {
      return;
    }

    // Skip the container iteration when the cursor hasn't moved and scroll is idle, unless a
    // container it asked to scroll without room has changed since (see #exhausted).
    if (
      cursor.x === this.#lastTickCursorX &&
      cursor.y === this.#lastTickCursorY &&
      !this.isScrolling() &&
      !this.#exhaustedChanged()
    ) {
      return;
    }
    this.#lastTickCursorX = cursor.x;
    this.#lastTickCursorY = cursor.y;
    this.#exhaustedCount = 0;

    let scrollPerformed = false;
    // Frame scale is shared across candidates within a tick; computed lazily on
    // the first scroll attempt so stationary/idle frames don't advance the clock.
    let frameScale = 0;

    // Candidates are ordered innermost-first: when the deepest container under the
    // cursor is exhausted at its boundary, the loop falls through to its ancestors.
    for (const { id, element, config } of this.#getOrderedContainers()) {
      const rect = element.getBoundingClientRect();
      const isInside = this.#positionCalculator.isInsideContainer(cursor, rect);

      if (!isInside) {
        continue;
      }

      const nearEdge = this.#positionCalculator.getNearEdge(cursor, rect, config.threshold);

      // Reuse the per-frame direction object to avoid allocation.
      const direction = this.#tickDirection;
      direction.x = 0;
      direction.y = 0;
      let maxDistance = 0;

      if (nearEdge.top) {
        direction.y = -1;
        maxDistance = Math.max(maxDistance, config.threshold - (cursor.y - rect.top));
      } else if (nearEdge.bottom) {
        direction.y = 1;
        maxDistance = Math.max(maxDistance, config.threshold - (rect.bottom - cursor.y));
      }

      if (nearEdge.left) {
        direction.x = -1;
        maxDistance = Math.max(maxDistance, config.threshold - (cursor.x - rect.left));
      } else if (nearEdge.right) {
        direction.x = 1;
        maxDistance = Math.max(maxDistance, config.threshold - (rect.right - cursor.x));
      }

      if (direction.x !== 0 || direction.y !== 0) {
        let speed = config.maxSpeed;
        if (config.accelerate) {
          const distanceRatio = maxDistance / config.threshold;
          speed = Math.min(config.maxSpeed, Math.max(1, config.maxSpeed * distanceRatio));
        }

        if (frameScale === 0) {
          frameScale = this.#getFrameScale();
        }

        // #performScroll reports whether it actually moved the element. Only claim the
        // tick (and stop descending the candidate list) when a scroll really happened —
        // an exhausted container must not block its ancestors from scrolling.
        //
        // Axis independence is per-container: if this container scrolls on *either* axis
        // it claims the whole tick, so a corner where the inner container's Y is exhausted
        // but its X still moves will not additionally apply an ancestor's available Y that
        // same frame. This matches the issue's "break once a container scrolled" contract;
        // cross-container axis handoff is intentionally out of scope.
        const scrolled = this.#performScroll(element, direction, frameScale, speed);
        if (scrolled) {
          this.#scrollState.containerId = id;
          this.#scrollState.direction.x = direction.x;
          this.#scrollState.direction.y = direction.y;
          this.#scrollState.speed = speed;
          scrollPerformed = true;

          // Notify callback IMMEDIATELY in the same frame (no RAF delay)
          // Delaying via RAF causes cumulative drift during continuous autoscroll
          // because multiple scrolls happen before each delayed callback runs.
          // Note: No ngZone.run() needed here - the callback (DraggableDirective.#recalculatePlaceholder)
          // updates signals and plain fields, and enters the zone itself to emit dragEnd if it ends
          // the drag.
          // It runs after the scroll state is recorded: it may end the drag, and the reset of
          // stopMonitoring() must not be overwritten.
          this.#onScrollCallback?.();
          break;
        }
        // No room in any requested direction: a resting cursor retries it once it changes
        this.#recordExhausted(element, direction);
      }
    }

    if (!scrollPerformed) {
      this.#lastScrollTimestamp = 0;
      this.#scrollState.containerId = null;
      this.#scrollState.direction.x = 0;
      this.#scrollState.direction.y = 0;
      this.#scrollState.speed = 0;
    }
  }

  /**
   * Perform the actual scroll operation.
   *
   * Each axis is evaluated independently: a boundary-exhausted axis is skipped
   * while the other axis still scrolls (e.g. at a corner where vertical is
   * maxed out but horizontal is available).
   *
   * @returns `true` when at least one axis actually scrolled, `false` when the
   *   element was already at its boundary in every requested direction. The
   *   caller uses this to fall through to ancestor containers.
   */
  #performScroll(
    element: HTMLElement,
    direction: { x: number; y: number },
    frameScale: number,
    speed: number,
  ): boolean {
    const scrollX = direction.x * speed * frameScale;
    const scrollY = direction.y * speed * frameScale;

    // Integer bounds used only as a cheap fast path to skip the assignment.
    // scrollHeight/clientHeight are rounded integers while scrollTop is fractional on
    // WebKit and any non-integer zoom/DPR, so this max can overstate the true one by
    // up to ~1px. It must NOT decide whether a scroll happened — the browser clamps the
    // assignment, so a before/after comparison is the only reliable truth signal.
    // Without it, an element pinned at its fractional max reports `scrolled = true`,
    // permanently claims the tick (blocking ancestor fall-through) and fires the callback
    // every frame against unchanged offsets (the WebKit placeholder-drift family).
    const maxScrollY = element.scrollHeight - element.clientHeight;
    const maxScrollX = element.scrollWidth - element.clientWidth;

    let scrolled = false;

    // Use direct property assignment for guaranteed synchronous scroll
    // scrollBy() with 'instant' behavior may have async issues in Safari
    if (scrollY !== 0) {
      const canScrollUp = direction.y < 0 && element.scrollTop > 0;
      const canScrollDown = direction.y > 0 && element.scrollTop < maxScrollY;
      if (canScrollUp || canScrollDown) {
        const before = element.scrollTop;
        element.scrollTop += scrollY;
        if (element.scrollTop !== before) {
          scrolled = true;
        }
      }
    }

    if (scrollX !== 0) {
      const canScrollLeft = direction.x < 0 && element.scrollLeft > 0;
      const canScrollRight = direction.x > 0 && element.scrollLeft < maxScrollX;
      if (canScrollLeft || canScrollRight) {
        const before = element.scrollLeft;
        element.scrollLeft += scrollX;
        if (element.scrollLeft !== before) {
          scrolled = true;
        }
      }
    }

    return scrolled;
  }

  /** Record a container that had no room in `direction` (see #exhausted). */
  #recordExhausted(element: HTMLElement, direction: { x: number; y: number }): void {
    const exhausted = (this.#exhausted[this.#exhaustedCount] ??= {
      element,
      vertical: false,
      horizontal: false,
      scrollTop: 0,
      scrollLeft: 0,
      maxScrollTop: 0,
      maxScrollLeft: 0,
    });
    exhausted.element = element;
    exhausted.vertical = direction.y !== 0;
    exhausted.horizontal = direction.x !== 0;
    exhausted.scrollTop = element.scrollTop;
    exhausted.scrollLeft = element.scrollLeft;
    exhausted.maxScrollTop = element.scrollHeight - element.clientHeight;
    exhausted.maxScrollLeft = element.scrollWidth - element.clientWidth;
    this.#exhaustedCount++;
  }

  /**
   * Whether a container in #exhausted has scrolled or changed size on an axis it was asked to
   * scroll, so it may have room now.
   */
  #exhaustedChanged(): boolean {
    for (let i = 0; i < this.#exhaustedCount; i++) {
      const exhausted = this.#exhausted[i];
      const { element } = exhausted;
      if (
        (exhausted.vertical &&
          (element.scrollTop !== exhausted.scrollTop ||
            element.scrollHeight - element.clientHeight !== exhausted.maxScrollTop)) ||
        (exhausted.horizontal &&
          (element.scrollLeft !== exhausted.scrollLeft ||
            element.scrollWidth - element.clientWidth !== exhausted.maxScrollLeft))
      ) {
        return true;
      }
    }
    return false;
  }

  #getFrameScale(): number {
    const now = performance.now();
    const elapsedMs =
      this.#lastScrollTimestamp === 0 ? BASE_FRAME_DURATION_MS : now - this.#lastScrollTimestamp;

    this.#lastScrollTimestamp = now;

    return Math.min(
      Math.max(elapsedMs / BASE_FRAME_DURATION_MS, MIN_SCROLL_FRAME_SCALE),
      MAX_SCROLL_FRAME_SCALE,
    );
  }

  /**
   * Check if auto-scrolling is currently active.
   */
  isScrolling(): boolean {
    return (
      this.#scrollState.containerId !== null &&
      (this.#scrollState.direction.x !== 0 || this.#scrollState.direction.y !== 0)
    );
  }

  /**
   * Get the current scroll direction.
   */
  getScrollDirection(): { x: number; y: number } {
    return this.#scrollState.direction;
  }
}
