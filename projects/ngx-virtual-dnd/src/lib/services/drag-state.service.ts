import { computed, effect, Injectable, signal } from '@angular/core';
import { CursorPosition, DraggedItem, DragState, GrabOffset } from '../models/drag-drop.models';

/**
 * Internal state type without high-frequency fields.
 * `cursorPosition`, `keyboardTargetIndex`, `activeDroppableId`, `placeholderId`
 * and `placeholderIndex` are split into dedicated signals so that high-frequency
 * pointer/placeholder updates don't trigger re-evaluation of rarely-changing
 * computeds (or rebuild the core state object every frame).
 */
type CoreDragState = Omit<
  DragState,
  | 'cursorPosition'
  | 'keyboardTargetIndex'
  | 'activeDroppableId'
  | 'placeholderId'
  | 'placeholderIndex'
>;

const INITIAL_CORE_STATE: CoreDragState = {
  isDragging: false,
  draggedItem: null,
  sourceDroppableId: null,
  sourceIndex: null,
  grabOffset: null,
  initialPosition: null,
  lockAxis: null,
  isKeyboardDrag: false,
};

/**
 * Central service for managing drag-and-drop state.
 * Uses signals for reactive state management.
 *
 * Architecture: High-frequency fields (`cursorPosition`, `keyboardTargetIndex`,
 * `activeDroppableId`, `placeholderId`, `placeholderIndex`) are stored in dedicated
 * signals, separate from the core state. This prevents 60fps cursor and
 * placeholder updates from rebuilding the core state object or re-evaluating the
 * 8+ computeds that only depend on rarely-changing properties (isDragging,
 * draggedItem, etc.).
 */
@Injectable({
  providedIn: 'root',
})
export class DragStateService {
  /** Core state signal — contains all rarely-changing properties */
  readonly #state = signal<CoreDragState>(INITIAL_CORE_STATE);

  /** High-frequency cursor position — updated at 60fps during pointer drag */
  readonly #cursorPosition = signal<CursorPosition | null>(null);

  /** High-frequency keyboard target index — updated on each arrow key press */
  readonly #keyboardTargetIndex = signal<number | null>(null);

  /** ID of the droppable currently being hovered over — changes on droppable crossings */
  readonly #activeDroppableId = signal<string | null>(null);

  /** `END_OF_LIST` while a droppable is targeted, otherwise null; see placeholderIndex */
  readonly #placeholderId = signal<string | null>(null);

  /** Index where the placeholder should be inserted — updated on each placeholder move */
  readonly #placeholderIndex = signal<number | null>(null);

  /** Snapshot captured synchronously immediately before the last drag state reset. */
  readonly #endedDragState = signal<DragState | null>(null);

  /** Flag indicating if the last drag was cancelled (not dropped) */
  readonly #wasCancelled = signal<boolean>(false);

  /** Whether the last drag was cancelled (for droppable to check before emitting drop) */
  readonly wasCancelled = this.#wasCancelled.asReadonly();

  /** Snapshot captured synchronously before the last drag reset. */
  readonly endedDragState = this.#endedDragState.asReadonly();

  /** Whether a drag operation is in progress */
  readonly isDragging = computed(() => this.#state().isDragging);

  /** The currently dragged item, or null */
  readonly draggedItem = computed(() => this.#state().draggedItem);

  /** ID of the currently dragged item, or null (convenience signal for filtering) */
  readonly draggedItemId = computed(() => this.#state().draggedItem?.draggableId ?? null);

  /** ID of the droppable where the drag started */
  readonly sourceDroppableId = computed(() => this.#state().sourceDroppableId);

  /** Original index of the dragged item in the source list */
  readonly sourceIndex = computed(() => this.#state().sourceIndex);

  /** ID of the droppable currently being hovered over */
  readonly activeDroppableId = this.#activeDroppableId.asReadonly();

  /** `END_OF_LIST` while a droppable is targeted, otherwise null; see placeholderIndex */
  readonly placeholderId = this.#placeholderId.asReadonly();

  /** Index where the placeholder should be inserted */
  readonly placeholderIndex = this.#placeholderIndex.asReadonly();

  /** Current cursor position */
  readonly cursorPosition = this.#cursorPosition.asReadonly();

  /** Offset from cursor to element top-left (for maintaining grab position) */
  readonly grabOffset = computed(() => this.#state().grabOffset);

  /** Position when drag started (for axis locking) */
  readonly initialPosition = computed(() => this.#state().initialPosition);

  /** Axis to lock movement to */
  readonly lockAxis = computed(() => this.#state().lockAxis);

  /** Whether this is a keyboard-initiated drag */
  readonly isKeyboardDrag = computed(() => this.#state().isKeyboardDrag);

  /** Target index during keyboard navigation */
  readonly keyboardTargetIndex = this.#keyboardTargetIndex.asReadonly();

  constructor() {
    // Inject cursor styles once (for consistent grabbing cursor during drag)
    if (typeof document !== 'undefined') {
      const styleId = 'vdnd-cursor-styles';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          body.vdnd-dragging,
          body.vdnd-dragging * {
            cursor: grabbing !important;
          }
        `;
        document.head.appendChild(style);
      }
    }

    // Effect to toggle body class during drag
    effect(() => {
      if (typeof document === 'undefined') return;
      const isDragging = this.isDragging();
      document.body.classList.toggle('vdnd-dragging', isDragging);
    });
  }

  /**
   * Start a drag operation.
   */
  startDrag(
    item: DraggedItem,
    cursorPosition?: CursorPosition,
    grabOffset?: GrabOffset,
    lockAxis?: 'x' | 'y' | null,
    activeDroppableId?: string | null,
    placeholderId?: string | null,
    placeholderIndex?: number | null,
    sourceIndex?: number | null,
    isKeyboardDrag?: boolean,
    axisLockPosition?: CursorPosition,
  ): void {
    // Reset terminal drag metadata at start of new drag
    this.#endedDragState.set(null);
    this.#wasCancelled.set(false);
    this.#cursorPosition.set(cursorPosition ?? null);
    this.#keyboardTargetIndex.set(isKeyboardDrag ? (sourceIndex ?? 0) : null);
    this.#activeDroppableId.set(activeDroppableId ?? null);
    this.#placeholderId.set(placeholderId ?? null);
    this.#placeholderIndex.set(placeholderIndex ?? null);
    this.#state.set({
      isDragging: true,
      draggedItem: item,
      sourceDroppableId: item.droppableId,
      sourceIndex: sourceIndex ?? null,
      grabOffset: grabOffset ?? null,
      initialPosition: axisLockPosition ?? cursorPosition ?? null,
      lockAxis: lockAxis ?? null,
      isKeyboardDrag: isKeyboardDrag ?? false,
    });
  }

  /**
   * Update the drag position and targets.
   */
  updateDragPosition(update: {
    cursorPosition: CursorPosition;
    activeDroppableId: string | null;
    placeholderId: string | null;
    placeholderIndex: number | null;
  }): void {
    if (!this.#state().isDragging) {
      return;
    }

    // Write cursor to dedicated high-frequency signal
    this.#cursorPosition.set(update.cursorPosition);

    // Each target lives in its own signal, so a placeholder-only frame never
    // rebuilds the core state object or re-fires the rarely-changing computeds.
    // Signals already no-op on identical values, so unconditional sets are safe.
    this.#activeDroppableId.set(update.activeDroppableId);
    this.#placeholderId.set(update.placeholderId);
    this.#placeholderIndex.set(update.placeholderIndex);
  }

  /**
   * Update just the active droppable.
   */
  setActiveDroppable(droppableId: string | null): void {
    if (!this.#state().isDragging) {
      return;
    }

    this.#activeDroppableId.set(droppableId);
  }

  /**
   * Update just the placeholder ID.
   */
  setPlaceholder(placeholderId: string | null): void {
    if (!this.#state().isDragging) {
      return;
    }

    this.#placeholderId.set(placeholderId);
  }

  /**
   * Update only the placeholder signals without touching cursor position or active droppable.
   *
   * Used by the autoscroll scroll-only fast path: when a scroll fires, the cursor has not
   * moved, so only the placeholder index needs recalculation. Skipping the cursor and
   * active-droppable writes avoids spurious re-evaluation of computeds that read those signals.
   */
  updateScrollOnlyPlaceholder(placeholderId: string | null, placeholderIndex: number | null): void {
    if (!this.#state().isDragging) {
      return;
    }

    this.#placeholderId.set(placeholderId);
    this.#placeholderIndex.set(placeholderIndex);
  }

  /**
   * End the drag operation and reset state (normal drop).
   */
  endDrag(): void {
    this.#endedDragState.set(this.getStateSnapshot());
    this.#wasCancelled.set(false);
    this.#resetHighFrequencySignals();
    this.#state.set(INITIAL_CORE_STATE);
  }

  /**
   * Cancel the drag operation (escape key, disabled, etc.).
   */
  cancelDrag(): void {
    this.#endedDragState.set(this.getStateSnapshot());
    this.#wasCancelled.set(true);
    this.#resetHighFrequencySignals();
    this.#state.set(INITIAL_CORE_STATE);
  }

  /**
   * Reset the dedicated high-frequency signals to their initial null state.
   */
  #resetHighFrequencySignals(): void {
    this.#cursorPosition.set(null);
    this.#keyboardTargetIndex.set(null);
    this.#activeDroppableId.set(null);
    this.#placeholderId.set(null);
    this.#placeholderIndex.set(null);
  }

  /**
   * Check if a specific droppable is currently active.
   */
  isDroppableActive(droppableId: string): boolean {
    return this.#activeDroppableId() === droppableId;
  }

  /**
   * Get the current state snapshot (for event creation).
   */
  getStateSnapshot(): DragState {
    return {
      ...this.#state(),
      activeDroppableId: this.#activeDroppableId(),
      placeholderId: this.#placeholderId(),
      placeholderIndex: this.#placeholderIndex(),
      cursorPosition: this.#cursorPosition(),
      keyboardTargetIndex: this.#keyboardTargetIndex(),
    };
  }

  /**
   * Update the keyboard target index (for keyboard drag navigation).
   * Also updates placeholder position to match, applying same-list adjustment.
   */
  setKeyboardTargetIndex(targetIndex: number): void {
    if (!this.#state().isDragging || !this.#state().isKeyboardDrag) {
      return;
    }

    const state = this.#state();
    // Same-list adjustment: if target is at or after source, add 1
    // This accounts for the hidden item shifting everything up visually
    const sourceDroppableId = state.draggedItem?.droppableId;
    const activeDroppableId = this.#activeDroppableId();
    const isSameList = sourceDroppableId === activeDroppableId;
    const sourceIndex = state.sourceIndex ?? -1;

    let placeholderIndex = targetIndex;
    if (isSameList && sourceIndex >= 0 && targetIndex >= sourceIndex) {
      placeholderIndex = targetIndex + 1;
    }

    this.#keyboardTargetIndex.set(targetIndex);
    this.#placeholderIndex.set(placeholderIndex);
  }

  /**
   * Update the active droppable during keyboard navigation (for cross-list moves).
   */
  setKeyboardActiveDroppable(droppableId: string | null, targetIndex: number): void {
    if (!this.#state().isDragging || !this.#state().isKeyboardDrag) {
      return;
    }

    const state = this.#state();
    // Same-list adjustment: if moving back to source list and target is at or after source, add 1
    const sourceDroppableId = state.draggedItem?.droppableId;
    const isSameList = sourceDroppableId === droppableId;
    const sourceIndex = state.sourceIndex ?? -1;

    let placeholderIndex = targetIndex;
    if (isSameList && sourceIndex >= 0 && targetIndex >= sourceIndex) {
      placeholderIndex = targetIndex + 1;
    }

    this.#keyboardTargetIndex.set(targetIndex);
    this.#activeDroppableId.set(droppableId);
    this.#placeholderIndex.set(placeholderIndex);
  }
}
