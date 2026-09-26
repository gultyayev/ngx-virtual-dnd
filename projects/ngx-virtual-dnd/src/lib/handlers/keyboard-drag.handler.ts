import { afterNextRender, EnvironmentInjector, NgZone } from '@angular/core';
import { DragStateService } from '../services/drag-state.service';
import { KeyboardDragService } from '../services/keyboard-drag.service';
import { PositionCalculatorService } from '../services/position-calculator.service';
import { DragIndexCalculatorService } from '../services/drag-index-calculator.service';
import { ElementCloneService } from '../services/element-clone.service';
import { OverlayContainerService } from '../services/overlay-container.service';
import { DragEndEvent, DragStartEvent } from '../models/drag-drop.models';
import { queryByAttribute } from '../utils/attribute-selectors';
import { normalizeDropDestinationIndex } from '../utils/drop-index-normalization';

/**
 * Context from the directive needed for keyboard drag operations.
 */
export interface KeyboardDragContext {
  element: HTMLElement;
  draggableId: string;
  groupName: string | null;
  data: unknown;
}

/**
 * Callbacks from the handler back into the directive for events.
 */
export interface KeyboardDragCallbacks {
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  getParentDroppableId: () => string | null;
  calculateSourceIndex: (element: HTMLElement, droppableElement: HTMLElement | null) => number;
}

/**
 * Dependencies injected from the directive (non-injectable handler).
 */
export interface KeyboardDragDeps {
  dragState: DragStateService;
  keyboardDrag: KeyboardDragService;
  positionCalculator: PositionCalculatorService;
  dragIndexCalculator: DragIndexCalculatorService;
  elementClone: ElementCloneService;
  overlayContainer: OverlayContainerService;
  ngZone: NgZone;
  envInjector: EnvironmentInjector;
  callbacks: KeyboardDragCallbacks;
  getContext: () => KeyboardDragContext;
}

/**
 * Handles keyboard-initiated drag operations (Space to start, arrows to move, Space/Enter to drop).
 *
 * Extracted from DraggableDirective to encapsulate:
 * - Starting/completing/cancelling keyboard drags
 * - Document-level keyboard listener during active drag
 * - Focus restoration after drag ends
 * - Cross-list movement via arrow keys
 *
 * Provides a unified `handleKey()` method that eliminates the duplicated
 * key→action dispatch that previously existed in both host bindings and
 * a document-level listener.
 */
export class KeyboardDragHandler {
  readonly #deps: KeyboardDragDeps;
  #boundKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor(deps: KeyboardDragDeps) {
    this.#deps = deps;
    this.#boundKeyDown = this.#onDocumentKeyDown.bind(this);
  }

  /**
   * Whether a keyboard drag is currently active.
   */
  isActive(): boolean {
    return this.#deps.keyboardDrag.isActive();
  }

  /**
   * Start a keyboard drag operation.
   */
  activate(): void {
    const ctx = this.#deps.getContext();
    if (!ctx.groupName) {
      return;
    }

    const element = ctx.element;
    const rect = element.getBoundingClientRect();

    // Find the parent droppable
    const droppableElement = this.#deps.positionCalculator.getDroppableParent(
      element,
      ctx.groupName,
    );
    if (!droppableElement) {
      return;
    }

    const droppableId = this.#deps.positionCalculator.getDroppableId(droppableElement);
    if (!droppableId) {
      return;
    }

    // Calculate source index
    const sourceIndex = this.#deps.callbacks.calculateSourceIndex(element, droppableElement);

    // Get total item count from the droppable
    const totalItemCount = this.#deps.dragIndexCalculator.getTotalItemCount({
      droppableElement,
      isSameList: false,
      draggedItemHeight: rect.height,
    });

    // Clone element BEFORE updating drag state.
    // Template-first: skip the clone when a template-based preview is mounted.
    const clonedElement = this.#deps.overlayContainer.hasTemplatePreview()
      ? undefined
      : this.#deps.elementClone.cloneElement(element);

    // Start keyboard drag
    this.#deps.keyboardDrag.startKeyboardDrag(
      {
        draggableId: ctx.draggableId,
        droppableId,
        element,
        clonedElement,
        height: rect.height,
        width: rect.width,
        data: ctx.data,
      },
      sourceIndex,
      totalItemCount,
      droppableId,
    );

    // Add document-level keyboard listener (since element is hidden with display:none)
    this.#deps.ngZone.runOutsideAngular(() => {
      document.addEventListener('keydown', this.#boundKeyDown!);
    });

    // Emit drag start event
    this.#deps.callbacks.onDragStart({
      draggableId: ctx.draggableId,
      droppableId,
      data: ctx.data,
      position: { x: rect.left, y: rect.top },
      sourceIndex,
    });
  }

  /**
   * Unified key dispatch. Returns true if the key was handled.
   * Used by both host bindings and the document-level listener.
   *
   * Handled keys are consumed entirely (preventDefault + stopPropagation): right after pickup
   * the source element can still be focused because Angular has not applied display:none yet,
   * and without stopping propagation the same keydown would be processed by both the element's
   * host binding and the document-level listener — moving the item two positions per press.
   */
  handleKey(event: KeyboardEvent): boolean {
    if (!this.isActive()) {
      return false;
    }

    const handled = this.#dispatchKey(event.key);

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }

    return handled;
  }

  /**
   * Execute the drag action for a key. Returns true if the key maps to an action.
   */
  #dispatchKey(key: string): boolean {
    switch (key) {
      case ' ': // Space
      case 'Enter':
        this.complete();
        return true;
      case 'Escape':
      case 'Tab':
        this.cancel();
        return true;
      case 'ArrowUp':
        this.#deps.keyboardDrag.moveUp();
        return true;
      case 'ArrowDown':
        this.#deps.keyboardDrag.moveDown();
        return true;
      case 'ArrowLeft':
        this.#moveToAdjacentDroppable('left');
        return true;
      case 'ArrowRight':
        this.#moveToAdjacentDroppable('right');
        return true;
      default:
        return false;
    }
  }

  /**
   * Complete a keyboard drag operation (drop the item).
   */
  complete(): void {
    const ctx = this.#deps.getContext();
    const sourceIndex = this.#deps.dragState.sourceIndex() ?? 0;
    const activeDroppableId = this.#deps.dragState.activeDroppableId();

    // Revalidate the active target: it may have been disabled after the drag navigated
    // into it. A disabled (or missing) target is not a valid drop — report no destination.
    // The droppable's own disabled guard suppresses the drop event, keeping dragEnd and
    // drop consistent (non-cancelled dragEnd with destinationIndex: null, no drop).
    const hasValidTarget =
      activeDroppableId !== null &&
      !this.#deps.positionCalculator.isDroppableDisabledById(activeDroppableId);

    const destinationIndex = hasValidTarget
      ? normalizeDropDestinationIndex({
          sourceIndex,
          placeholderIndex: this.#deps.dragState.placeholderIndex(),
          sourceDroppableId: this.#deps.dragState.sourceDroppableId(),
          activeDroppableId,
        })
      : null;

    // Remove document listener
    this.#cleanupDocumentListener();

    // Clear droppable metadata cache from this drag session
    this.#deps.dragIndexCalculator.clearCache();

    // Emit drag end event
    this.#deps.callbacks.onDragEnd({
      draggableId: ctx.draggableId,
      droppableId: this.#deps.callbacks.getParentDroppableId() ?? '',
      cancelled: false,
      data: ctx.data,
      sourceIndex,
      destinationIndex,
    });

    // The item stays in its source list when there is no valid target
    const fallbackDroppableId = hasValidTarget
      ? activeDroppableId
      : this.#deps.dragState.sourceDroppableId();

    this.#deps.keyboardDrag.completeKeyboardDrag();

    // Restore focus to the moved element after state updates
    this.#restoreFocus(ctx.draggableId, fallbackDroppableId);
  }

  /**
   * Cancel a keyboard drag operation.
   */
  cancel(): void {
    const ctx = this.#deps.getContext();
    const sourceIndex = this.#deps.dragState.sourceIndex() ?? 0;
    // A cancelled item goes back to its source list
    const sourceDroppableId = this.#deps.dragState.sourceDroppableId();

    // Remove document listener
    this.#cleanupDocumentListener();

    // Clear droppable metadata cache from this drag session
    this.#deps.dragIndexCalculator.clearCache();

    // Emit drag end event
    this.#deps.callbacks.onDragEnd({
      draggableId: ctx.draggableId,
      droppableId: this.#deps.callbacks.getParentDroppableId() ?? '',
      cancelled: true,
      data: ctx.data,
      sourceIndex,
      destinationIndex: null,
    });

    this.#deps.keyboardDrag.cancelKeyboardDrag();

    // Restore focus to the original element after state updates
    this.#restoreFocus(ctx.draggableId, sourceDroppableId);
  }

  /**
   * Teardown — remove any active document listener.
   */
  destroy(): void {
    this.#cleanupDocumentListener();
  }

  /**
   * Restore focus to the dragged element after keyboard drag ends.
   * Uses afterNextRender to ensure Angular has finished updating the DOM
   * (element is no longer hidden after isDragging() becomes false).
   *
   * Uses EnvironmentInjector to ensure callback runs even if the directive
   * is destroyed during cross-list moves.
   *
   * `fallbackDroppableId` is the list whose first draggable gets focus when the element is not
   * rendered (for example scrolled out of a virtual list). Callers read it before ending the
   * drag, which clears the drag state.
   */
  #restoreFocus(draggableId: string, fallbackDroppableId: string | null): void {
    afterNextRender(
      () => {
        const element = queryByAttribute<HTMLElement>(document, 'data-draggable-id', draggableId);

        if (element) {
          element.focus();
        } else if (fallbackDroppableId) {
          // Fallback: focus the first draggable in the list the item ended up in
          const container = queryByAttribute<HTMLElement>(
            document,
            'data-droppable-id',
            fallbackDroppableId,
          );
          const firstDraggable = container?.querySelector<HTMLElement>('[data-draggable-id]');
          firstDraggable?.focus();
        }
      },
      { injector: this.#deps.envInjector },
    );
  }

  /**
   * Move to an adjacent droppable in the specified direction.
   */
  #moveToAdjacentDroppable(direction: 'left' | 'right'): void {
    const currentDroppableId = this.#deps.dragState.activeDroppableId();
    if (!currentDroppableId) {
      return;
    }

    const groupName = this.#deps.getContext().groupName;
    if (!groupName) {
      return;
    }
    const adjacent = this.#deps.positionCalculator.findAdjacentDroppable(
      currentDroppableId,
      direction,
      groupName,
    );

    if (!adjacent) {
      return;
    }

    // Derive the destination list's item count from DragIndexCalculatorService — the single
    // source of truth that correctly handles registered strategies, dynamic-height lists, and
    // vdnd-virtual-content (page-scroll) lists. Arrowing back to the origin lands on the source
    // list, so compute isSameList rather than assuming a distinct target.
    const itemCount = this.#deps.dragIndexCalculator.getTotalItemCount({
      droppableElement: adjacent.element,
      isSameList: adjacent.id === this.#deps.dragState.sourceDroppableId(),
      draggedItemHeight: this.#deps.dragState.draggedItem()?.height ?? 0,
    });

    // Maintain the current target index (clamped to the new list's size)
    const currentTargetIndex = this.#deps.keyboardDrag.targetIndex() ?? 0;
    const targetIndex = Math.min(currentTargetIndex, itemCount);

    this.#deps.keyboardDrag.moveToDroppable(adjacent.id, targetIndex, itemCount);
  }

  /**
   * Document-level keydown listener active during keyboard drag.
   */
  #onDocumentKeyDown(event: KeyboardEvent): void {
    this.handleKey(event);
  }

  /**
   * Remove the document-level keyboard listener.
   */
  #cleanupDocumentListener(): void {
    // Server rendering destroys the directive without a global document, and never added it
    if (this.#boundKeyDown && typeof document !== 'undefined') {
      document.removeEventListener('keydown', this.#boundKeyDown);
    }
  }
}
