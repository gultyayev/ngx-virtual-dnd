import { afterNextRender, computed, inject, Injectable, Injector, signal } from '@angular/core';
import { DragStateService } from './drag-state.service';
import { DragIndexCalculatorService } from './drag-index-calculator.service';
import { DroppableRegistryService } from './droppable-registry.service';
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
  readonly #dragIndexCalculator = inject(DragIndexCalculatorService);
  readonly #registry = inject(DroppableRegistryService);
  readonly #injector = inject(Injector);

  /** Total item count for the current droppable (set by droppable on keyboard drag start) */
  readonly #totalItemCount = signal<number>(0);

  /** Per-droppable callbacks that scroll the placeholder into view (see `registerRevealer`) */
  readonly #revealers = new Map<string, () => void>();

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
    this.#revealActivePlaceholder();

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
    this.#revealActivePlaceholder();
  }

  /**
   * Register the callback that scrolls a droppable's placeholder into view. It runs
   * synchronously on every keyboard move into or within that droppable, so a drop that
   * follows before the next render still lands inside the rendered range.
   */
  registerRevealer(droppableId: string, reveal: () => void): void {
    this.#revealers.set(droppableId, reveal);
  }

  /**
   * Unregister a droppable's reveal callback. Ignored if another callback has since been
   * registered under the same ID.
   */
  unregisterRevealer(droppableId: string, reveal: () => void): void {
    if (this.#revealers.get(droppableId) === reveal) {
      this.#revealers.delete(droppableId);
    }
  }

  /**
   * Scroll the active droppable's placeholder into view again, once: the space covered in a
   * scroll container around it changed. A no-op without a keyboard drag.
   * @internal
   */
  revealPlaceholder(): void {
    const droppableId = this.activeDroppableId();
    if (!this.isActive() || droppableId === null) {
      return;
    }
    const reveal = this.#revealers.get(droppableId);
    if (reveal) {
      reveal();
    } else {
      this.#revealSlot(droppableId);
    }
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

  #revealActivePlaceholder(): void {
    const droppableId = this.activeDroppableId();
    if (droppableId === null) {
      return;
    }
    const reveal = this.#revealers.get(droppableId);
    if (reveal) {
      reveal();
      return;
    }
    // A list without a reveal of its own (vdnd-virtual-content, vdnd-virtual-viewport,
    // *vdndVirtualFor in a vdndScrollable, an @for of plain rows): scroll it now, so a drop that
    // follows lands in the rendered range, and once more after the next render, when the content
    // has room for the placeholder (before, the scroll range can be one placeholder short at the
    // end) and a placeholder the list renders itself is in place.
    this.#revealSlot(droppableId);
    afterNextRender(() => this.#revealSlot(droppableId), { injector: this.#injector });
  }

  /** Scroll the placeholder in `droppableId` into view, while the keyboard drag is there. */
  #revealSlot(droppableId: string): void {
    if (!this.isActive() || this.activeDroppableId() !== droppableId) {
      return;
    }
    const element = this.#registry.getById(droppableId);
    const index = this.#dragState.placeholderIndex();
    const height = this.#dragState.draggedItem()?.height ?? 0;
    if (element && index !== null && height > 0) {
      this.#dragIndexCalculator.revealSlot(element, index, height);
    }
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
