import type { NgZone } from '@angular/core';
import type { DragEndEvent, DraggedItem } from '../models/drag-drop.models';
import type { DragStateService } from '../services/drag-state.service';
import { placeholderToInsertionIndex } from '../utils/index-semantics';

/**
 * Ending a drag, shared by the pointer and keyboard drags: the `dragEnd` event both emit, and the
 * order in which it and the drop happen. What each tears down first (the pointer's frame loop and
 * hit-testing session, the keyboard's document listener) stays in its handler.
 */

/** The item as the draggable renders it when the drag ends */
export interface LiveDraggable {
  draggableId: string;
  data: unknown;
}

export interface DragEndArgs {
  /** The item the drag picked up, as the drag state recorded it */
  pickedUp: DraggedItem | null;
  /** The item the draggable renders now */
  live: LiveDraggable;
  /** The draggable's list as the DOM has it, for a drag state that recorded none */
  parentDroppableId: () => string | null;
  /** Whether the drag was cancelled (Escape, the draggable destroyed, ...) */
  cancelled: boolean;
  /**
   * Whether the drag ends over a list that takes the drop. Without one (or cancelled) dragEnd
   * reports no destination.
   */
  hasTarget: boolean;
}

/**
 * The `dragEnd` event of the drag in progress. Read before the drag state ends, which clears it.
 *
 * - The item: while the draggable still renders the item it picked up, its live ID and data (the
 *   consumer can replace the data mid-gesture). When its ID changed since (a recycled row renders
 *   another item), the item the drag picked up, which the drop reports too.
 * - The list: the source list as the drag started from it, as the drop reports it. Not a DOM
 *   lookup first: a draggable destroyed mid-drag (its row removed) is detached from its list here.
 * - The destination: the insertion index the drop reports (see `index-semantics.ts`).
 */
export function createDragEndEvent(dragState: DragStateService, args: DragEndArgs): DragEndEvent {
  const { pickedUp, live, cancelled, hasTarget } = args;
  const item = pickedUp && pickedUp.draggableId !== live.draggableId ? pickedUp : live;
  const sourceIndex = dragState.sourceIndex() ?? 0;
  const destinationIndex =
    cancelled || !hasTarget
      ? null
      : placeholderToInsertionIndex({
          sourceIndex,
          placeholderIndex: dragState.placeholderIndex(),
          sourceDroppableId: dragState.sourceDroppableId(),
          activeDroppableId: dragState.activeDroppableId(),
        });

  return {
    draggableId: item.draggableId,
    droppableId: dragState.sourceDroppableId() || args.parentDroppableId() || '',
    cancelled,
    data: item.data,
    sourceIndex,
    destinationIndex,
  };
}

/**
 * Emit `dragEnd`, then end the drag state, which delivers the drop synchronously, then run
 * `after` (the keyboard drag restores focus there). All in one entry into Angular's zone: the
 * listeners run outside it, and with zone.js a template listener marks its view dirty but
 * schedules no render, while each entry renders when it is left, so separate entries would render
 * the drag end twice. A no-op when zoneless.
 */
export function endDragInZone(
  ngZone: NgZone,
  emitDragEnd: () => void,
  endDragState: () => void,
  after?: () => void,
): void {
  ngZone.run(() => {
    emitDragEnd();
    endDragState();
    after?.();
  });
}
