import { isDevMode, untracked, type WritableSignal } from '@angular/core';
import { DropEvent } from '../models/drag-drop.models';

/**
 * Moves an item between signal-based lists based on a drop event.
 * Handles both same-list reordering and cross-list moves.
 *
 * @example
 * ```typescript
 * // In your component:
 * readonly list1 = signal<Item[]>([...]);
 * readonly list2 = signal<Item[]>([...]);
 *
 * onDrop(event: DropEvent): void {
 *   moveItem(event, {
 *     'list-1': this.list1,
 *     'list-2': this.list2,
 *   });
 * }
 * ```
 *
 * @param event The drop event from the droppable directive
 * @param lists A map of droppable IDs to their corresponding WritableSignal arrays
 */
export function moveItem<T>(event: DropEvent, lists: Record<string, WritableSignal<T[]>>): void {
  const sourceList = lists[event.source.droppableId];
  const destList = lists[event.destination.droppableId];

  if (!sourceList || !destList) {
    if (isDevMode()) {
      console.warn(
        `[ngx-virtual-dnd] [moveItem] Could not find list for droppable "${event.source.droppableId}" or "${event.destination.droppableId}"`,
      );
    }
    return;
  }

  const sourceIndex = event.source.index;
  const destIndex = event.destination.index;

  // Same list reorder
  if (event.source.droppableId === event.destination.droppableId) {
    reorderItems(event, sourceList);
    return;
  }

  // Cross-list move
  const sourceItems = sourceList();
  const item = sourceItems[sourceIndex];

  if (item === undefined) {
    if (isDevMode()) {
      console.warn(`[ngx-virtual-dnd] [moveItem] Could not find item at index ${sourceIndex}`);
    }
    return;
  }

  // Remove from source
  sourceList.update((items) => {
    const newItems = [...items];
    newItems.splice(sourceIndex, 1);
    return newItems;
  });

  // Insert at destination
  destList.update((items) => {
    const newItems = [...items];
    newItems.splice(destIndex, 0, item);
    return newItems;
  });
}

/**
 * Reorders items within a single signal-based list.
 *
 * @example
 * ```typescript
 * readonly items = signal<Item[]>([...]);
 *
 * onDrop(event: DropEvent): void {
 *   reorderItems(event, this.items);
 * }
 * ```
 *
 * @param event The drop event from the droppable directive
 * @param list The WritableSignal array to reorder
 */
export function reorderItems<T>(event: DropEvent, list: WritableSignal<T[]>): void {
  const sourceIndex = event.source.index;
  const destIndex = event.destination.index;

  // No-op if same position
  if (sourceIndex === destIndex) {
    return;
  }

  // The list may have changed during the drag; never splice in a missing item as undefined.
  // Read untracked: from an effect, a tracked read would make the effect re-run on this reorder.
  if (untracked(list)[sourceIndex] === undefined) {
    if (isDevMode()) {
      console.warn(`[ngx-virtual-dnd] [reorderItems] Could not find item at index ${sourceIndex}`);
    }
    return;
  }

  list.update((items) => {
    const newItems = [...items];
    const [removed] = newItems.splice(sourceIndex, 1);

    // Note: destination.index from DropEvent is already adjusted for same-list
    // reordering by DroppableDirective.#handleDrop(), so we use it directly.
    newItems.splice(destIndex, 0, removed);
    return newItems;
  });
}

/**
 * Applies a move operation immutably, returning new array objects.
 * Useful for state management patterns that require immutable updates.
 *
 * @example
 * ```typescript
 * onDrop(event: DropEvent): void {
 *   const { list1, list2 } = applyMove(event, {
 *     'list-1': this.list1,
 *     'list-2': this.list2,
 *   });
 *   // Use the returned arrays with your state management
 * }
 * ```
 *
 * @param event The drop event from the droppable directive
 * @param lists A map of droppable IDs to their corresponding arrays
 * @returns A new object with the same keys but updated arrays
 */
export function applyMove<T>(event: DropEvent, lists: Record<string, T[]>): Record<string, T[]> {
  const result = { ...lists };
  const sourceKey = event.source.droppableId;
  const destKey = event.destination.droppableId;
  const sourceIndex = event.source.index;
  const destIndex = event.destination.index;

  const sourceItems = [...(lists[sourceKey] ?? [])];
  const item = sourceItems[sourceIndex];

  if (item === undefined) {
    return result;
  }

  // Same list reorder
  // Note: destination.index from DropEvent is already adjusted for same-list
  // reordering by DroppableDirective.#handleDrop(), so we use it directly.
  if (sourceKey === destKey) {
    const [removed] = sourceItems.splice(sourceIndex, 1);
    sourceItems.splice(destIndex, 0, removed);
    result[sourceKey] = sourceItems;
    return result;
  }

  // Cross-list move
  const destItems = [...(lists[destKey] ?? [])];
  sourceItems.splice(sourceIndex, 1);
  destItems.splice(destIndex, 0, item);

  result[sourceKey] = sourceItems;
  result[destKey] = destItems;

  return result;
}

/**
 * Checks if a drop event represents a no-op (item dropped in its original position).
 * Useful for skipping unnecessary state updates.
 *
 * @example
 * ```typescript
 * onDrop(event: DropEvent): void {
 *   if (isNoOpDrop(event)) {
 *     return; // No action needed
 *   }
 *   moveItem(event, this.lists);
 * }
 * ```
 *
 * @param event The drop event to check
 * @returns true if the drop would result in no change
 */
export function isNoOpDrop(event: DropEvent): boolean {
  return (
    event.source.droppableId === event.destination.droppableId &&
    event.source.index === event.destination.index
  );
}

/**
 * Creates a new list with the item inserted at the specified index.
 * Low-level utility for custom implementations.
 *
 * @param list The source array
 * @param item The item to insert
 * @param index The index to insert at
 * @returns A new array with the item inserted
 */
export function insertAt<T>(list: T[], item: T, index: number): T[] {
  const result = [...list];
  result.splice(index, 0, item);
  return result;
}

/**
 * Creates a new list with the item at the specified index removed.
 * Low-level utility for custom implementations.
 *
 * @param list The source array
 * @param index The index to remove
 * @returns A new array with the item removed
 */
export function removeAt<T>(list: T[], index: number): T[] {
  const result = [...list];
  result.splice(index, 1);
  return result;
}
