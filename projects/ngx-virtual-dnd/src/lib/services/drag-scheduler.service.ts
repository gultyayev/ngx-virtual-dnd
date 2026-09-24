import { inject, Injectable, NgZone } from '@angular/core';
import { CursorPosition } from '../models/drag-drop.models';

/**
 * Callback invoked each RAF frame with the latest cursor and a dirty flag.
 *
 * @param cursor  — Latest cursor position queued via `queueCursorUpdate()`, or null if none.
 * @param cursorDirty — True when cursor was updated since the previous frame.
 */
export type SchedulerTickFn = (cursor: CursorPosition | null, cursorDirty: boolean) => void;

/**
 * Single RAF loop that coordinates all drag-frame work in ordered phases:
 *
 *   1. Participant phase (READ+WRITE): registered participants run first.
 *      AutoScrollService registers here to perform edge-scroll + immediate
 *      placeholder recalculation in the same synchronous frame — preserving
 *      the Safari synchronous-callback constraint.
 *   2. Main compute phase (COMPUTE+WRITE): onTick is called every frame with the
 *      latest cursor and a `cursorDirty` flag. Callers skip their hit-test when
 *      the flag is false, so autoscroll-only frames (cursor stationary) incur
 *      zero hit-test work.
 *
 * PointerDragHandler calls `queueCursorUpdate()` instead of managing its own
 * RAF per pointermove. This coalesces all moves within a frame into one update
 * and ensures pointer-move work always runs after participant work.
 */
@Injectable({
  providedIn: 'root',
})
export class DragSchedulerService {
  readonly #ngZone = inject(NgZone);

  #rafId: number | null = null;
  #onTick: SchedulerTickFn | null = null;

  /** Latest cursor queued from pointer move events. */
  #pendingCursor: CursorPosition | null = null;
  /** True when a new cursor was queued since the last frame. */
  #cursorDirty = false;

  /** Tick participants called before the main compute phase each frame. */
  readonly #participants: (() => void)[] = [];

  /**
   * Start the scheduler RAF loop.
   * No-op if already running.
   */
  start(onTick: SchedulerTickFn): void {
    if (this.#rafId !== null) {
      return;
    }
    this.#onTick = onTick;
    this.#ngZone.runOutsideAngular(() => {
      this.#scheduleNextTick();
    });
  }

  /**
   * Stop the scheduler and cancel the pending RAF.
   * Safe to call when not running.
   */
  stop(): void {
    if (this.#rafId !== null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
    // Null out onTick so that any in-flight RAF callback (race between cancel
    // and the browser delivering the frame) is a no-op.
    this.#onTick = null;
    this.#pendingCursor = null;
    this.#cursorDirty = false;
  }

  /**
   * Queue a cursor update from a pointer move event.
   * Multiple calls between frames are coalesced — only the latest matters.
   */
  queueCursorUpdate(position: CursorPosition): void {
    this.#pendingCursor = position;
    this.#cursorDirty = true;
  }

  /**
   * Register a function to be called at the start of each frame, before the main tick.
   * AutoScrollService registers here to perform edge-scroll within the same frame.
   * No-op if the same function reference is already registered.
   */
  addParticipant(fn: () => void): void {
    if (!this.#participants.includes(fn)) {
      this.#participants.push(fn);
    }
  }

  /**
   * Unregister a previously added participant.
   * No-op if the function was not registered.
   */
  removeParticipant(fn: () => void): void {
    const idx = this.#participants.indexOf(fn);
    if (idx !== -1) {
      this.#participants.splice(idx, 1);
    }
  }

  #scheduleNextTick(): void {
    this.#rafId = requestAnimationFrame(() => this.#tick());
  }

  #tick(): void {
    this.#rafId = null;

    // Guard against the race where stop() was called but the browser already
    // queued the callback before cancelAnimationFrame() could prevent delivery.
    if (!this.#onTick) {
      return;
    }

    // Snapshot and reset dirty flag before participants run so that any cursor
    // update they trigger (theoretically possible in future extensions) is
    // picked up in the NEXT frame, not folded into this one's compute phase.
    const cursorDirty = this.#cursorDirty;
    this.#cursorDirty = false;

    // Phase 1 — participants (autoscroll scroll + synchronous placeholder update)
    for (const participant of this.#participants) {
      participant();
    }

    // Phase 2 — main compute (cursor-based hit-test + signal write)
    this.#onTick(this.#pendingCursor, cursorDirty);

    // Reschedule only if still active (stop() may have been called by onTick).
    if (this.#onTick !== null) {
      this.#scheduleNextTick();
    }
  }
}
