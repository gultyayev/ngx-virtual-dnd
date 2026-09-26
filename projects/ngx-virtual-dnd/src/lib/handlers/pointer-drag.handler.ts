import { NgZone } from '@angular/core';
import { CursorPosition } from '../models/drag-drop.models';
import { findNoDragElement, INTERACTIVE_ELEMENT_SELECTOR } from '../utils/interactive-elements';

/**
 * Callbacks from the handler back into the directive for drag lifecycle.
 */
export interface PointerDragCallbacks {
  onDragStart: (position: CursorPosition) => void;
  onDragMove: (position: CursorPosition) => void;
  onDragEnd: (cancelled: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  isDragging: () => boolean;
  /** Whether a drag of another item (pointer or keyboard) is in progress. */
  isOtherDragActive: () => boolean;
}

/**
 * Context from the directive needed for pointer drag operations.
 */
export interface PointerDragContext {
  element: HTMLElement;
  groupName: string | null;
  disabled: boolean;
  dragHandle: string | undefined;
  dragThreshold: number;
  dragDelay: number;
}

/**
 * Dependencies injected from the directive (non-injectable handler).
 */
export interface PointerDragDeps {
  ngZone: NgZone;
  callbacks: PointerDragCallbacks;
  getContext: () => PointerDragContext;
}

/**
 * Handles pointer-based (mouse + touch) drag operations.
 *
 * Extracted from DraggableDirective to encapsulate:
 * - Pointer down / move / up lifecycle
 * - Drag threshold detection
 * - Drag delay timer
 * - Forwarding moves to the directive (DragSchedulerService coalesces them per frame)
 * - Document-level listener management
 * - Escape key cancellation during pointer drag, and cancellation when the window loses focus
 *   or the page is hidden (the release would never arrive)
 */
export class PointerDragHandler {
  readonly #deps: PointerDragDeps;

  /** Starting position of the drag */
  #startPosition: CursorPosition | null = null;

  /** Whether we're currently tracking a potential drag */
  #isTracking = false;

  /** Identifier of the finger that pressed, for touch gestures (other fingers are ignored) */
  #touchId: number | null = null;

  /** Bound event handlers for cleanup */
  #boundPointerMove: ((e: MouseEvent | TouchEvent) => void) | null = null;
  #boundPointerUp: ((e: MouseEvent | TouchEvent) => void) | null = null;
  #boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  #boundWindowBlur: (() => void) | null = null;
  #boundVisibilityChange: (() => void) | null = null;

  /** Timer ID for drag delay */
  #delayTimerId: ReturnType<typeof setTimeout> | null = null;

  /** Whether the delay has been satisfied (user held long enough) */
  #delayReady = false;

  constructor(deps: PointerDragDeps) {
    this.#deps = deps;
    this.#boundPointerMove = this.#onPointerMove.bind(this);
    this.#boundPointerUp = this.#onPointerUp.bind(this);
    this.#boundKeyDown = this.#onEscapeKeyDown.bind(this);
    this.#boundWindowBlur = this.#onFocusLost.bind(this);
    this.#boundVisibilityChange = this.#onVisibilityChange.bind(this);
  }

  /**
   * The position where the user initially pressed down.
   * Used by the directive to calculate grab offset when starting drag.
   */
  getStartPosition(): CursorPosition | null {
    return this.#startPosition;
  }

  /**
   * Handle pointer down (mouse or touch).
   * Called from the directive's host binding.
   */
  onPointerDown(event: MouseEvent | TouchEvent, isTouch: boolean): void {
    const ctx = this.#deps.getContext();

    if (ctx.disabled) {
      return;
    }

    // Without a group, this draggable can't participate in DnD (fail gracefully).
    if (!ctx.groupName) {
      return;
    }

    // Check for left mouse button only
    if (!isTouch && (event as MouseEvent).button !== 0) {
      return;
    }

    // Check if click is on drag handle (if specified)
    if (ctx.dragHandle) {
      const target = event.target as HTMLElement;
      if (!target.closest(ctx.dragHandle)) {
        return;
      }
    }

    // Check for elements that should not trigger drag
    const target = event.target as HTMLElement;
    if (
      target.closest(INTERACTIVE_ELEMENT_SELECTOR) ||
      findNoDragElement(target, ctx.element) !== null
    ) {
      return;
    }

    // Track the finger that pressed this draggable; the others are ignored for the gesture.
    const touch = 'touches' in event ? PointerDragHandler.#pressingTouch(event, ctx.element) : null;
    if ('touches' in event && !touch) {
      return;
    }

    const delay = ctx.dragDelay;

    // For touch events with a delay configured, DON'T call preventDefault() on touchstart.
    // This allows native scrolling to work if the user swipes before the delay fires.
    // For mouse events or touch without delay, prevent default immediately to avoid
    // text selection and other default behaviors.
    if (!isTouch || delay === 0) {
      event.preventDefault();
    }
    event.stopPropagation();

    // A second finger on this draggable while the first is still down: keep following the first.
    if ('touches' in event && touch && this.#isTracking && this.#trackedTouch(event.touches)) {
      return;
    }

    // Only one drag at a time: a second finger or a press during a keyboard drag must not
    // replace the drag in progress. The press keeps the default handling above, so a mouse press
    // still doesn't focus this item (which would take the keys of a keyboard drag).
    if (this.#deps.callbacks.isOtherDragActive()) {
      return;
    }

    this.#isTracking = true;
    if (touch) {
      this.#touchId = touch.identifier;
      this.#startPosition = { x: touch.clientX, y: touch.clientY };
    } else {
      const mouse = event as MouseEvent;
      this.#startPosition = { x: mouse.clientX, y: mouse.clientY };
    }

    // Handle drag delay. A repeated press (e.g. after a release the page never saw) restarts the
    // delay; the previous timer must not survive, or it fires after the gesture has ended.
    this.#cancelDelayTimer();
    if (delay > 0) {
      this.#delayTimerId = setTimeout(() => {
        this.#delayTimerId = null;
        // Another drag started while this press was held: drop the press rather than show it
        // as ready to drag during that drag.
        if (this.#deps.callbacks.isOtherDragActive()) {
          this.cleanup();
          return;
        }
        this.#delayReady = true;
        this.#deps.callbacks.onPendingChange(true); // Emit ready state when delay passes
      }, delay);
    } else {
      this.#delayReady = true;
    }

    // Add document-level event listeners
    this.#deps.ngZone.runOutsideAngular(() => {
      if (isTouch) {
        document.addEventListener('touchmove', this.#boundPointerMove!, { passive: false });
        document.addEventListener('touchend', this.#boundPointerUp!);
        document.addEventListener('touchcancel', this.#boundPointerUp!);
      } else {
        document.addEventListener('mousemove', this.#boundPointerMove!);
        document.addEventListener('mouseup', this.#boundPointerUp!);
      }
      // Listen for Escape key on document to cancel drag
      document.addEventListener('keydown', this.#boundKeyDown!);
      // Switching windows or tabs mid-drag means the release never reaches this page: cancel
      // instead of leaving the drag active until the next press.
      window.addEventListener('blur', this.#boundWindowBlur!);
      document.addEventListener('visibilitychange', this.#boundVisibilityChange!);
    });
  }

  /**
   * Remove listeners + cancel timers.
   * Called after pointer up or when cancelling.
   */
  cleanup(): void {
    this.#isTracking = false;
    this.#startPosition = null;
    this.#touchId = null;
    this.#deps.callbacks.onPendingChange(false); // Clear pending state on cleanup
    this.#cancelDelayTimer();

    // Server rendering destroys the directive without a global document, and never added any
    if (typeof document === 'undefined') {
      return;
    }

    // Remove event listeners
    if (this.#boundPointerMove) {
      document.removeEventListener('mousemove', this.#boundPointerMove);
      document.removeEventListener('touchmove', this.#boundPointerMove);
    }
    if (this.#boundPointerUp) {
      document.removeEventListener('mouseup', this.#boundPointerUp);
      document.removeEventListener('touchend', this.#boundPointerUp);
      document.removeEventListener('touchcancel', this.#boundPointerUp);
    }
    if (this.#boundKeyDown) {
      document.removeEventListener('keydown', this.#boundKeyDown);
    }
    if (this.#boundWindowBlur) {
      window.removeEventListener('blur', this.#boundWindowBlur);
    }
    if (this.#boundVisibilityChange) {
      document.removeEventListener('visibilitychange', this.#boundVisibilityChange);
    }
  }

  /**
   * Teardown when the directive is destroyed: removes listeners and cancels timers.
   */
  destroy(): void {
    this.cleanup();
  }

  /**
   * Handle pointer move (mouse or touch).
   */
  #onPointerMove(event: MouseEvent | TouchEvent): void {
    if (!this.#isTracking) {
      return;
    }

    let position: CursorPosition;
    if ('touches' in event) {
      // `touches` holds every finger's current position, so the tracked finger's is there even
      // when only another finger moved
      const touch = this.#trackedTouch(event.touches) ?? this.#trackedTouch(event.changedTouches);
      if (!touch) {
        // The tracked finger is gone. While dragging, keep other fingers from scrolling the page.
        if (this.#deps.callbacks.isDragging()) {
          event.preventDefault();
        }
        return;
      }
      position = { x: touch.clientX, y: touch.clientY };
    } else {
      position = { x: event.clientX, y: event.clientY };
    }
    const ctx = this.#deps.getContext();

    // Check if we've moved past the threshold
    if (!this.#deps.callbacks.isDragging() && this.#startPosition) {
      const distance = Math.sqrt(
        Math.pow(position.x - this.#startPosition.x, 2) +
          Math.pow(position.y - this.#startPosition.y, 2),
      );

      if (distance < ctx.dragThreshold) {
        return;
      }

      // If delay is configured and not yet ready, cancel the drag attempt
      // (user moved before the delay was satisfied).
      // DON'T call preventDefault() here - let native scrolling take over.
      if (!this.#delayReady) {
        this.#cancelDelayTimer();
        this.cleanup();
        return;
      }

      // Another press won the race and started its drag first: give up this one.
      if (this.#deps.callbacks.isOtherDragActive()) {
        this.cleanup();
        return;
      }

      // Start the drag - now we can prevent default
      event.preventDefault();
      this.#deps.callbacks.onDragStart(position);
    } else if (this.#deps.callbacks.isDragging()) {
      // Already dragging - prevent default to stop scrolling
      event.preventDefault();
    }

    // Only update drag if we're actually dragging
    if (!this.#deps.callbacks.isDragging()) {
      return;
    }

    // Notify the directive of the new position — it queues this into the scheduler
    // (DragSchedulerService) which coalesces multiple moves per frame into one RAF tick.
    this.#deps.callbacks.onDragMove(position);
  }

  /**
   * Handle pointer up (mouse or touch).
   */
  #onPointerUp(event: MouseEvent | TouchEvent): void {
    if (!this.#isTracking) {
      return;
    }

    // Another finger lifted (or was cancelled) while the tracked one is still down. Touches
    // without an identifier (malformed synthetic events) can't be told apart: any release ends.
    if (
      'touches' in event &&
      typeof this.#touchId === 'number' &&
      this.#trackedTouch(event.changedTouches) === null &&
      this.#trackedTouch(event.touches) !== null
    ) {
      return;
    }

    // Only prevent default if we were actually dragging
    // Otherwise, allow native touch behavior (like scroll momentum) to complete
    if (this.#deps.callbacks.isDragging()) {
      event.preventDefault();
      this.#deps.callbacks.onDragEnd(false);
    }

    this.cleanup();
  }

  /**
   * Cancel the delay timer if active.
   */
  #cancelDelayTimer(): void {
    if (this.#delayTimerId !== null) {
      clearTimeout(this.#delayTimerId);
      this.#delayTimerId = null;
    }
    this.#delayReady = false;
  }

  /**
   * Handle keydown events on document to cancel drag with Escape.
   */
  #onEscapeKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.#deps.callbacks.isDragging()) {
      // No ngZone.run() needed - #endDrag uses signals which work outside zone
      this.#deps.callbacks.onDragEnd(true);
      this.cleanup();
    }
  }

  /**
   * Cancel the drag (or drop the pending press) when the window loses focus.
   */
  #onFocusLost(): void {
    if (!this.#isTracking) {
      return;
    }

    if (this.#deps.callbacks.isDragging()) {
      this.#deps.callbacks.onDragEnd(true);
    }
    this.cleanup();
  }

  /**
   * Treat the page being hidden (tab switch, app switch on mobile) as focus loss.
   */
  #onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      this.#onFocusLost();
    }
  }

  /**
   * The tracked finger in `touches`, or null. Synthetic touch events (e.g. from test tools) can
   * leave a list undefined, so a missing list counts as empty.
   */
  #trackedTouch(touches: TouchList | undefined): Touch | null {
    return Array.from(touches ?? []).find((touch) => touch.identifier === this.#touchId) ?? null;
  }

  /**
   * The finger that pressed this draggable: of the touches that started with this event, the
   * one on the draggable (several fingers can land in one touchstart).
   */
  static #pressingTouch(event: TouchEvent, element: HTMLElement): Touch | null {
    // Either list can be undefined on synthetic events
    const started = Array.from((event.changedTouches as TouchList | undefined) ?? []);
    const onElement = started.find(
      (touch) => touch.target instanceof Node && element.contains(touch.target),
    );
    return onElement ?? started[0] ?? Array.from(event.touches ?? [])[0] ?? null;
  }
}
