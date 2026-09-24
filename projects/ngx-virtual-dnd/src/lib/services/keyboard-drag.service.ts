import { computed, inject, Injectable, signal } from '@angular/core';
import { DragStateService } from './drag-state.service';
import { DraggedItem, END_OF_LIST, GrabOffset } from '../models/drag-drop.models';

/**
 * Service for managing keyboard-initiated drag operations.
 * Works in conjunction with DragStateService to provide keyboard drag functionality.
 */
@Injectable({
  providedIn: 'root',
})
export class KeyboardDragService {
  readonly #dragState = inject(DragStateService);

  /** Total item count for the current droppable (set by droppable on keyboard drag start) */
  readonly #totalItemCount = signal<number>(0);

  /** Whether a keyboard drag is currently active */
  readonly isActive = computed(
    () => this.#dragState.isKeyboardDrag() && this.#dragState.isDragging(),
  );

  /** Current target index during keyboard navigation */
  readonly targetIndex = computed(() => this.#dragState.keyboardTargetIndex());

  /** Source index where the drag started */
  readonly sourceIndex = computed(() => this.#dragState.sourceIndex());

  /** Current active droppable ID */
  readonly activeDroppableId = computed(() => this.#dragState.activeDroppableId());

  /**
   * Start a keyboard drag operation.
   */
  startKeyboardDrag(
    item: DraggedItem,
    sourceIndex: number,
    totalItemCount: number,
    activeDroppableId: string,
  ): void {
    this.#totalItemCount.set(totalItemCount);

    // For keyboard drag, we position the preview at the element's location
    // We use a grab offset of 0,0 since we're not grabbing at a specific point
    const grabOffset: GrabOffset = { x: 0, y: 0 };

    // Get the element's position for the cursor position
    // This positions the preview at the element's original location
    const rect = item.element.getBoundingClientRect();
    const cursorPosition = { x: rect.left, y: rect.top };

    // Same-list adjustment: at start, targetIndex equals sourceIndex
    // Since sourceIndex >= sourceIndex is always true, add 1 to placeholderIndex
    // This accounts for the hidden item shifting everything up visually
    const initialPlaceholderIndex = sourceIndex + 1;

    this.#dragState.startDrag(
      item,
      cursorPosition,
      grabOffset,
      null, // no axis lock for keyboard drag
      activeDroppableId,
      END_OF_LIST,
      initialPlaceholderIndex,
      sourceIndex,
      true, // isKeyboardDrag
    );
  }

  /**
   * Move to a specific index during keyboard drag.
   * Returns the clamped target index.
   */
  moveToIndex(targetIndex: number): number {
    if (!this.isActive()) {
      return targetIndex;
    }

    const maxIndex = this.#maxTargetIndex(this.activeDroppableId());
    const clampedIndex = Math.max(0, Math.min(targetIndex, maxIndex));

    this.#dragState.setKeyboardTargetIndex(clampedIndex);

    return clampedIndex;
  }

  /**
   * Move up by one position (ArrowUp).
   * Returns the new target index.
   */
  moveUp(): number {
    const currentTarget = this.targetIndex() ?? 0;
    return this.moveToIndex(currentTarget - 1);
  }

  /**
   * Move down by one position (ArrowDown).
   * Returns the new target index.
   */
  moveDown(): number {
    const currentTarget = this.targetIndex() ?? 0;
    return this.moveToIndex(currentTarget + 1);
  }

  /**
   * Move to an adjacent droppable (ArrowLeft/ArrowRight).
   * The droppable registry is managed externally.
   */
  moveToDroppable(droppableId: string, targetIndex: number, totalItemCount: number): void {
    if (!this.isActive()) {
      return;
    }

    this.#totalItemCount.set(totalItemCount);
    const clampedIndex = Math.max(0, Math.min(targetIndex, this.#maxTargetIndex(droppableId)));
    this.#dragState.setKeyboardActiveDroppable(droppableId, clampedIndex);
  }

  /**
   * Complete the keyboard drag (Space or Enter to drop).
   */
  completeKeyboardDrag(): void {
    if (!this.isActive()) {
      return;
    }

    this.#dragState.endDrag();
  }

  /**
   * Cancel the keyboard drag (Escape).
   */
  cancelKeyboardDrag(): void {
    if (!this.isActive()) {
      return;
    }

    this.#dragState.cancelDrag();
  }

  /**
   * Update the total item count (when navigating to a new list).
   */
  setTotalItemCount(count: number): void {
    this.#totalItemCount.set(count);
  }

  /**
   * Last valid target index in the given droppable. Targets use the drop convention (the item's
   * final index after it leaves its source), so the source list ends at `totalItemCount - 1`,
   * while any other list can be appended to at `totalItemCount`.
   */
  #maxTargetIndex(droppableId: string | null): number {
    const totalItems = this.#totalItemCount();
    const isSourceList =
      droppableId !== null && droppableId === this.#dragState.sourceDroppableId();
    return isSourceList ? Math.max(0, totalItems - 1) : totalItems;
  }
}
