import {
  computed,
  Directive,
  ElementRef,
  EnvironmentInjector,
  inject,
  input,
  NgZone,
  OnDestroy,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { DragStateService } from '../services/drag-state.service';
import { PositionCalculatorService } from '../services/position-calculator.service';
import { AutoScrollService } from '../services/auto-scroll.service';
import { ElementCloneService } from '../services/element-clone.service';
import { KeyboardDragService } from '../services/keyboard-drag.service';
import { DragIndexCalculatorService } from '../services/drag-index-calculator.service';
import { OverlayContainerService } from '../services/overlay-container.service';
import { DragSchedulerService } from '../services/drag-scheduler.service';
import {
  CursorPosition,
  DragEndEvent,
  DragStartEvent,
  GrabOffset,
} from '../models/drag-drop.models';
import { VDND_GROUP_TOKEN } from './droppable-group.directive';
import { createEffectiveGroupSignal } from '../utils/group-resolution';
import { KeyboardDragHandler } from '../handlers/keyboard-drag.handler';
import { PointerDragHandler } from '../handlers/pointer-drag.handler';
import { normalizeDropDestinationIndex } from '../utils/drop-index-normalization';
import { isPressOnNestedControl, NO_DRAG_CLASS } from '../utils/interactive-elements';

/**
 * Makes an element draggable within the virtual scroll drag-and-drop system.
 *
 * @example
 * ```html
 * <!-- With explicit group -->
 * <div
 *   vdndDraggable="item-1"
 *   vdndDraggableGroup="my-group"
 *   [vdndDraggableData]="item">
 *   Drag me!
 * </div>
 *
 * <!-- With inherited group from parent vdndGroup directive -->
 * <div vdndGroup="my-group">
 *   <div vdndDraggable="item-1" [vdndDraggableData]="item">
 *     Drag me!
 *   </div>
 * </div>
 * ```
 */
@Directive({
  selector: '[vdndDraggable]',
  host: {
    '[attr.data-draggable-id]': 'vdndDraggable()',
    '[class.vdnd-draggable]': 'true',
    '[class.vdnd-draggable-dragging]': 'isDragging()',
    '[class.vdnd-draggable-disabled]': 'disabled()',
    '[class.vdnd-drag-pending]': 'isPending()',
    '[style.display]': 'isDragging() ? "none" : null',
    '[attr.aria-grabbed]': 'isDragging() ? "true" : "false"',
    '[tabindex]': 'disabled() ? -1 : 0',
    '(mousedown)': 'onPointerDown($event, false)',
    '(touchstart)': 'onPointerDown($event, true)',
    '(keydown.space)': 'onKeyboardActivate($event)',
    '(keydown.enter)': 'onEnterKey($event)',
    '(keydown.arrowup)': 'onArrowKey($event)',
    '(keydown.arrowdown)': 'onArrowKey($event)',
    '(keydown.arrowleft)': 'onArrowKey($event)',
    '(keydown.arrowright)': 'onArrowKey($event)',
    '(keydown.escape)': 'onEscape()',
  },
})
export class DraggableDirective implements OnInit, OnDestroy {
  readonly #elementRef = inject(ElementRef<HTMLElement>);
  readonly #dragState = inject(DragStateService);
  readonly #positionCalculator = inject(PositionCalculatorService);
  readonly #autoScroll = inject(AutoScrollService);
  readonly #elementClone = inject(ElementCloneService);
  readonly #keyboardDrag = inject(KeyboardDragService);
  readonly #dragIndexCalculator = inject(DragIndexCalculatorService);
  readonly #overlayContainer = inject(OverlayContainerService);
  readonly #scheduler = inject(DragSchedulerService);
  readonly #ngZone = inject(NgZone);
  readonly #envInjector = inject(EnvironmentInjector);
  readonly #parentGroup = inject(VDND_GROUP_TOKEN, { optional: true });

  /** Unique identifier for this draggable */
  vdndDraggable = input.required<string>();

  /**
   * Drag-and-drop group name.
   * Optional when a parent `vdndGroup` directive provides the group context.
   */
  vdndDraggableGroup = input<string>();

  /**
   * Resolved group name - uses explicit input or falls back to parent group.
   * Returns null (and disables drag) if neither is available.
   */
  readonly #effectiveGroup = createEffectiveGroupSignal({
    explicitGroup: this.vdndDraggableGroup,
    parentGroup: this.#parentGroup,
    elementId: this.vdndDraggable,
    elementType: 'draggable',
  });

  /** Optional data associated with this draggable */
  vdndDraggableData = input<unknown>();

  /** Whether this draggable is disabled */
  disabled = input<boolean>(false);

  /** CSS selector for drag handle (if not provided, entire element is draggable) */
  dragHandle = input<string>();

  /** Minimum distance to move before drag starts (prevents accidental drags) */
  dragThreshold = input<number>(5);

  /**
   * Delay in milliseconds before drag starts after pointer down.
   * User must hold without moving for this duration.
   * Set to 0 for immediate drag (default behavior).
   */
  dragDelay = input<number>(0);

  /**
   * Lock dragging by freezing one axis. The value names the axis that stays
   * fixed: `'x'` freezes the X coordinate (vertical-only movement), `'y'`
   * freezes the Y coordinate (horizontal-only movement). `null` allows free
   * movement. Note: this is the opposite of Angular CDK's `cdkDragLockAxis`.
   */
  lockAxis = input<'x' | 'y' | null>(null);

  /** Emits when drag starts */
  dragStart = output<DragStartEvent>();

  /** Emits when drag ends */
  dragEnd = output<DragEndEvent>();

  /** Whether this element is in the "ready to drag" state (delay has passed) */
  #isPending = signal(false);
  readonly isPending = this.#isPending.asReadonly();

  /** Whether this element is currently being dragged (based on global drag state) */
  readonly isDragging = computed(() => {
    const draggedItem = this.#dragState.draggedItem();
    return draggedItem?.draggableId === this.vdndDraggable();
  });

  #keyboardHandler!: KeyboardDragHandler;
  #pointerHandler!: PointerDragHandler;

  /** Set by ngOnInit, which creates the handlers */
  #initialized = false;

  /** Cached constraint flag from source droppable */
  #constrainToContainer = false;

  /** Element whose rect is used for clamping (scroll container or droppable itself) */
  #constraintElement: HTMLElement | null = null;

  /** Last raw pointer position from pointer move events (not clamped) */
  #lastRawPosition: CursorPosition | null = null;

  /**
   * Update the pending state and emit the change event.
   */
  #setPending(pending: boolean): void {
    if (this.#isPending() !== pending) {
      this.#isPending.set(pending);
    }
  }

  /**
   * Find the element to use for container constraint clamping.
   * If the droppable is inside a scrollable container, use that container's rect
   * (which represents the visible viewport) instead of the droppable's rect
   * (which may extend far beyond the viewport in virtual scroll scenarios).
   */
  #findConstraintElement(droppableElement: HTMLElement | null): HTMLElement | null {
    if (!droppableElement) return null;
    const scrollable = droppableElement.closest('.vdnd-scrollable');
    return (scrollable as HTMLElement) ?? droppableElement;
  }

  ngOnInit(): void {
    this.#keyboardHandler = new KeyboardDragHandler({
      dragState: this.#dragState,
      keyboardDrag: this.#keyboardDrag,
      positionCalculator: this.#positionCalculator,
      dragIndexCalculator: this.#dragIndexCalculator,
      elementClone: this.#elementClone,
      overlayContainer: this.#overlayContainer,
      ngZone: this.#ngZone,
      envInjector: this.#envInjector,
      callbacks: {
        onDragStart: (event) => this.dragStart.emit(event),
        onDragEnd: (event) => this.dragEnd.emit(event),
        getParentDroppableId: () => this.#getParentDroppableId(),
        calculateSourceIndex: (el, droppable) => this.#calculateSourceIndex(el, droppable),
      },
      getContext: () => ({
        element: this.#elementRef.nativeElement,
        draggableId: this.vdndDraggable(),
        groupName: this.#effectiveGroup(),
        data: this.vdndDraggableData(),
      }),
    });

    this.#pointerHandler = new PointerDragHandler({
      ngZone: this.#ngZone,
      callbacks: {
        onDragStart: (position) => this.#startDrag(position),
        onDragMove: (position) => {
          // Record raw position synchronously (needed for autoscroll cursor override)
          // then queue into the scheduler's RAF loop for coalesced frame-rate processing.
          this.#lastRawPosition = position;
          this.#scheduler.queueCursorUpdate(position);
        },
        onDragEnd: (cancelled) => this.#endDrag(cancelled),
        onPendingChange: (pending) => this.#setPending(pending),
        isDragging: () => this.isDragging(),
      },
      getContext: () => ({
        element: this.#elementRef.nativeElement,
        groupName: this.#effectiveGroup(),
        disabled: this.disabled(),
        dragHandle: this.dragHandle(),
        dragThreshold: this.dragThreshold(),
        dragDelay: this.dragDelay(),
      }),
    });

    this.#initialized = true;
  }

  ngOnDestroy(): void {
    // Destroyed before its first change detection: there are no handlers yet, and its inputs
    // have no values (reading a bound ID would throw).
    if (!this.#initialized) {
      return;
    }

    // If destroyed mid-drag, cancel to avoid stale global state / ongoing RAF loops.
    if (this.isDragging()) {
      this.#endDrag(true);
    }
    this.#pointerHandler.destroy();
    this.#keyboardHandler.destroy();
  }

  /**
   * Handle pointer down (mouse or touch).
   */
  protected onPointerDown(event: MouseEvent | TouchEvent, isTouch: boolean): void {
    this.#pointerHandler.onPointerDown(event, isTouch);
  }

  /**
   * Handle keyboard activation (space key).
   * Starts a keyboard drag if not dragging, or drops if already in keyboard drag mode.
   */
  protected onKeyboardActivate(event: Event): void {
    if (this.disabled()) {
      return;
    }

    // Space on a control inside the item types into it or clicks it, just as a press on
    // one never starts a pointer drag.
    if (this.#isFromNestedControl(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation(); // Prevent document listener from receiving this event

    // If we're in a keyboard drag, Space drops the item
    if (this.#keyboardHandler.isActive()) {
      this.#keyboardHandler.complete();
      return;
    }

    // If we're in a pointer drag, ignore
    if (this.isDragging()) {
      return;
    }

    // Start keyboard drag
    this.#keyboardHandler.activate();
  }

  /**
   * Whether the event comes from a control (or a `no-drag` element) nested inside this
   * draggable. Neither the draggable itself nor a control around it counts, so a
   * `<button vdndDraggable>` still picks up with Space, and neither does a control that is the
   * drag handle, such as a button handle. Controls inside the handle do count.
   */
  #isFromNestedControl(event: Event): boolean {
    const host = this.#elementRef.nativeElement;
    const target = event.target;
    if (!(target instanceof Element) || target === host) {
      return false;
    }

    return (
      target.classList.contains(NO_DRAG_CLASS) ||
      isPressOnNestedControl(event, host, this.dragHandle())
    );
  }

  /**
   * Handle Enter key (alternative to Space for dropping during keyboard drag).
   */
  protected onEnterKey(event: Event): void {
    if (this.#keyboardHandler.isActive()) {
      event.preventDefault();
      this.#keyboardHandler.complete();
    }
  }

  /**
   * Handle arrow keys during keyboard drag.
   */
  protected onArrowKey(event: Event): void {
    if (this.#keyboardHandler.isActive()) {
      this.#keyboardHandler.handleKey(event as KeyboardEvent);
    }
  }

  /**
   * Handle escape key to cancel drag (host binding, fires before element is hidden).
   */
  protected onEscape(): boolean {
    if (this.#keyboardHandler.isActive()) {
      this.#keyboardHandler.cancel();
      return false;
    }
    if (this.isDragging()) {
      this.#endDrag(true);
      this.#pointerHandler.cleanup();
      return false; // Prevents default
    }
    return true;
  }

  /**
   * Start the drag operation.
   */
  #startDrag(position: CursorPosition): void {
    // Clear pending state - drag is now active
    this.#setPending(false);

    const element = this.#elementRef.nativeElement;
    const rect = element.getBoundingClientRect();

    // Calculate grab offset using the START position (where user initially pressed down)
    // NOT the current position (where drag threshold was exceeded)
    // This ensures the preview maintains its position relative to where the user grabbed it
    const startPos = this.#pointerHandler.getStartPosition() ?? position;
    const grabOffset: GrabOffset = {
      x: startPos.x - rect.left,
      y: startPos.y - rect.top,
    };

    // Clone element BEFORE updating drag state (which triggers display:none via host binding).
    // Template-first: skip the costly getComputedStyle deep-walk when a template-based
    // preview is mounted, since that clone would never be rendered.
    const clonedElement = this.#overlayContainer.hasTemplatePreview()
      ? undefined
      : this.#elementClone.cloneElement(element);

    // Find droppable and calculate initial placeholder position
    // This fixes the UI glitch by ensuring placeholder is set before the element is hidden
    const groupName = this.#effectiveGroup();
    if (!groupName) {
      // Misconfigured - cancel tracking and don't start drag.
      this.#pointerHandler.cleanup();
      return;
    }

    const parentDroppableElement = this.#positionCalculator.getDroppableParent(element, groupName);
    const parentDroppableId = parentDroppableElement
      ? this.#positionCalculator.getDroppableId(parentDroppableElement)
      : null;

    // Snapshot droppable rects for this drag session so subsequent hit-testing is
    // pure geometry (no elementFromPoint layout flush per pointermove).
    this.#positionCalculator.beginDragSession(groupName);

    const droppableElement = this.#positionCalculator.findDroppableAtPoint(
      position.x,
      position.y,
      element,
      groupName,
    );

    // Cache constraint flag and element for clamping during drag
    this.#constrainToContainer =
      droppableElement?.hasAttribute('data-constrain-to-container') ?? false;
    this.#constraintElement = this.#constrainToContainer
      ? this.#findConstraintElement(droppableElement)
      : null;

    const activeDroppableId = droppableElement
      ? this.#positionCalculator.getDroppableId(droppableElement)
      : parentDroppableId;

    // Calculate source index BEFORE the element is hidden (display: none)
    // This is critical because getBoundingClientRect() returns all zeros for hidden elements
    const sourceIndex = this.#calculateSourceIndex(element, parentDroppableElement);

    let initialPlaceholderId: string | null = null;
    let initialPlaceholderIndex: number | null = null;

    if (droppableElement) {
      const indexResult = this.#dragIndexCalculator.calculatePlaceholderIndex({
        droppableElement,
        position,
        previousPosition: null,
        grabOffset,
        draggedItemHeight: rect.height,
        sourceDroppableId: parentDroppableId,
        sourceIndex,
      });
      initialPlaceholderIndex = indexResult.index;
      initialPlaceholderId = indexResult.placeholderId;
    }

    const lockAxis = this.lockAxis();

    // Register with drag state service - this triggers isDragging computed to become true
    // which will apply display:none via host binding
    // No ngZone.run() needed - signals work outside zone and effects react automatically
    this.#dragState.startDrag(
      {
        draggableId: this.vdndDraggable(),
        droppableId: parentDroppableId ?? '',
        element,
        clonedElement,
        height: rect.height,
        width: rect.width,
        data: this.vdndDraggableData(),
      },
      position,
      grabOffset,
      lockAxis,
      activeDroppableId,
      initialPlaceholderId,
      initialPlaceholderIndex,
      sourceIndex,
      undefined,
      lockAxis ? startPos : undefined,
    );

    // Start the scheduler RAF loop (drives pointer-move updates + autoscroll participant).
    // onTick is called each frame: when cursor is dirty, run full #updateDrag.
    this.#scheduler.start((cursor, cursorDirty) => {
      if (cursorDirty && cursor && this.isDragging()) {
        this.#updateDrag(cursor);
      }
    });

    // Start auto-scroll monitoring — registers as a scheduler participant.
    this.#autoScroll.startMonitoring(() => this.#recalculatePlaceholder());

    // Emit drag start event
    this.dragStart.emit({
      draggableId: this.vdndDraggable(),
      droppableId: parentDroppableId ?? '',
      data: this.vdndDraggableData(),
      position,
      sourceIndex,
    });
  }

  /**
   * Calculate the source index of the dragged element BEFORE it's hidden.
   * This must be called before startDrag updates the state (which triggers display:none).
   * Uses strategy-based lookup when available for accurate handling of variable heights.
   */
  #calculateSourceIndex(element: HTMLElement, droppableElement: HTMLElement | null): number {
    if (!droppableElement) {
      return 0;
    }

    const rect = element.getBoundingClientRect();
    // The same measurement that places the placeholder: it knows each container's scroll
    // element and subtracts space reserved above the rows (contentOffset, page headers).
    const geometry = this.#dragIndexCalculator.getScrollGeometry(droppableElement, rect.height);
    const relativeY = rect.top - geometry.rect.top + geometry.scrollTop;

    // Try to use registered strategy for accurate offset-based lookup
    const droppableId = this.#positionCalculator.getDroppableId(droppableElement);
    if (droppableId) {
      const strategy = this.#dragIndexCalculator.getStrategyForDroppable(droppableId);
      if (strategy) {
        return strategy.findIndexAtOffset(relativeY);
      }
    }

    // Preserve the geometry fallback for a virtual container whose strategy is unavailable.
    if (geometry.isVirtual) {
      const itemHeight = rect.height || 50;
      return Math.round(relativeY / itemHeight);
    }

    // Non-virtual fallback: derive the logical index from preceding draggable siblings.
    // Geometry-based division is incorrect when the list has padding, gaps, margins,
    // or variable-height items.
    let sourceIndex = 0;
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.matches('[data-draggable-id]')) {
        sourceIndex++;
      }
      sibling = sibling.previousElementSibling;
    }
    return sourceIndex;
  }

  /**
   * Recalculate placeholder position (called during auto-scroll).
   *
   * Scroll-only fast path: the cursor has not moved — only `scrollTop` changed.
   * When the active droppable is already known, skip hit-testing entirely and
   * recalculate only the placeholder index within that droppable. This avoids the
   * `findDroppableAtPoint` geometry scan + the `invalidateDroppableRects` DOM round-trip
   * on every autoscroll frame while still recomputing the correct insertion index.
   *
   * Falls back to the full `#updateDrag` pipeline when no droppable is active (e.g.
   * cursor drifted outside all droppables before the scroll tick fired).
   */
  #recalculatePlaceholder(): void {
    const cursorPosition = this.#dragState.cursorPosition();
    if (!cursorPosition || !this.isDragging()) {
      return;
    }

    const activeDroppableId = this.#dragState.activeDroppableId();
    if (activeDroppableId) {
      const droppableElement = this.#positionCalculator.getDroppableById(activeDroppableId);
      if (droppableElement) {
        const draggedItemHeight = this.#dragState.draggedItem()?.height ?? 50;
        const indexResult = this.#dragIndexCalculator.calculatePlaceholderIndex({
          droppableElement,
          position: cursorPosition,
          previousPosition: cursorPosition,
          grabOffset: this.#dragState.grabOffset(),
          draggedItemHeight,
          sourceDroppableId: this.#dragState.sourceDroppableId(),
          sourceIndex: this.#dragState.sourceIndex(),
        });
        this.#dragState.updateScrollOnlyPlaceholder(indexResult.placeholderId, indexResult.index);
        return;
      }
    }

    // Fallback: full recalculation when no active droppable is known.
    // Mark rects dirty first since autoscroll moved the container before the scroll event fires.
    this.#positionCalculator.invalidateDroppableRects();
    this.#updateDrag(cursorPosition);
  }

  /**
   * Clamp cursor position to source container boundaries when constrainToContainer is enabled.
   */
  #clampToContainer(position: CursorPosition): CursorPosition {
    if (!this.#constrainToContainer || !this.#constraintElement) {
      return position;
    }

    const containerRect = this.#constraintElement.getBoundingClientRect();
    const grabOffset = this.#dragState.grabOffset();
    if (!grabOffset) {
      return position;
    }

    const draggedItem = this.#dragState.draggedItem();
    const itemHeight = draggedItem?.height ?? 0;
    const itemWidth = draggedItem?.width ?? 0;

    const minY = containerRect.top + grabOffset.y + 1;
    const maxY = containerRect.bottom - (itemHeight - grabOffset.y) - 1;
    const minX = containerRect.left + grabOffset.x + 1;
    const maxX = containerRect.right - (itemWidth - grabOffset.x) - 1;

    return {
      x: Math.max(minX, Math.min(position.x, maxX)),
      y: Math.max(minY, Math.min(position.y, maxY)),
    };
  }

  /**
   * Update the drag position.
   * @param position Current cursor position
   */
  #updateDrag(position: CursorPosition): void {
    const element = this.#elementRef.nativeElement;
    const groupName = this.#effectiveGroup();
    if (!groupName) {
      // Group became unavailable mid-drag; cancel to avoid inconsistent state.
      this.#endDrag(true);
      this.#pointerHandler.cleanup();
      return;
    }

    // Apply axis locking to effective position for droppable detection
    // When axis is locked, use the start position for the locked axis
    const axisLock = this.lockAxis();
    const startPos = this.#pointerHandler.getStartPosition();
    let effectivePosition = position;

    if (axisLock && startPos) {
      effectivePosition = {
        x: axisLock === 'x' ? startPos.x : position.x,
        y: axisLock === 'y' ? startPos.y : position.y,
      };
    }

    // Apply container clamping after axis locking
    effectivePosition = this.#clampToContainer(effectivePosition);

    // Update autoscroll cursor: use raw pointer position clamped to container
    // edges (without grabOffset) so autoscroll threshold is reachable regardless
    // of where the user grabbed the item.
    if (this.#constrainToContainer && this.#constraintElement && this.#lastRawPosition) {
      const rect = this.#constraintElement.getBoundingClientRect();
      let scrollCursor: CursorPosition = this.#lastRawPosition;
      if (axisLock && startPos) {
        scrollCursor = {
          x: axisLock === 'x' ? startPos.x : scrollCursor.x,
          y: axisLock === 'y' ? startPos.y : scrollCursor.y,
        };
      }
      this.#autoScroll.setCursorOverride({
        x: Math.max(rect.left, Math.min(scrollCursor.x, rect.right)),
        y: Math.max(rect.top, Math.min(scrollCursor.y, rect.bottom)),
      });
    }

    // Find droppable at effective position (respects axis locking and clamping)
    const droppableElement = this.#positionCalculator.findDroppableAtPoint(
      effectivePosition.x,
      effectivePosition.y,
      element,
      groupName,
    );

    const activeDroppableId = droppableElement
      ? this.#positionCalculator.getDroppableId(droppableElement)
      : null;

    let placeholderId: string | null = null;
    let placeholderIndex: number | null = null;

    if (droppableElement) {
      // Calculate placeholder index based on effective position using mathematical approach
      // This is more stable than DOM-based detection because it doesn't get affected
      // by the placeholder insertion shifting elements around
      const draggedItemHeight = this.#dragState.draggedItem()?.height ?? 50;
      const indexResult = this.#dragIndexCalculator.calculatePlaceholderIndex({
        droppableElement,
        position: effectivePosition,
        previousPosition: this.#dragState.cursorPosition(),
        grabOffset: this.#dragState.grabOffset(),
        draggedItemHeight,
        sourceDroppableId: this.#dragState.sourceDroppableId(),
        sourceIndex: this.#dragState.sourceIndex(),
      });
      placeholderIndex = indexResult.index;
      placeholderId = indexResult.placeholderId;
    }

    // Update drag state with effective position (respects axis locking and container clamping)
    // No ngZone.run() needed - signals work outside zone and effects react automatically
    this.#dragState.updateDragPosition({
      cursorPosition: effectivePosition,
      activeDroppableId,
      placeholderId,
      placeholderIndex,
    });
  }

  /**
   * End the drag operation.
   */
  #endDrag(cancelled: boolean): void {
    // Flush the final pointer position for a real drop. Pointer moves only QUEUE a cursor
    // for the next RAF tick; on release the scheduler is stopped below and any un-processed
    // cursor is discarded, so without this the drop would resolve against the last
    // RAF-PROCESSED position — a release that just entered a different (e.g. newly disabled)
    // droppable could otherwise land on the previously-targeted one. Guarded on group
    // presence so it never re-enters #endDrag via #updateDrag's group-lost cancel path.
    // Cancels skip this: their destination is intentionally null.
    if (!cancelled && this.#lastRawPosition && this.isDragging() && this.#effectiveGroup()) {
      this.#updateDrag(this.#lastRawPosition);
    }

    // Stop the scheduler RAF loop first, then remove the autoscroll participant.
    this.#scheduler.stop();
    this.#autoScroll.stopMonitoring();

    // Tear down the geometric hit-testing snapshot + its viewport listeners
    this.#positionCalculator.endDragSession();

    // Clear droppable metadata cache from this drag session
    this.#dragIndexCalculator.clearCache();

    // Reset cached constraint state
    this.#constrainToContainer = false;
    this.#constraintElement = null;
    this.#lastRawPosition = null;

    const sourceIndex = this.#dragState.sourceIndex() ?? 0;
    const destinationIndex = cancelled
      ? null
      : normalizeDropDestinationIndex({
          sourceIndex,
          placeholderIndex: this.#dragState.placeholderIndex(),
          sourceDroppableId: this.#dragState.sourceDroppableId(),
          activeDroppableId: this.#dragState.activeDroppableId(),
        });

    // Emit drag end event
    this.dragEnd.emit({
      draggableId: this.vdndDraggable(),
      droppableId: this.#getParentDroppableId() ?? '',
      cancelled,
      data: this.vdndDraggableData(),
      sourceIndex,
      destinationIndex,
    });

    // Clear drag state - this triggers isDragging computed to become false
    if (cancelled) {
      this.#dragState.cancelDrag();
    } else {
      this.#dragState.endDrag();
    }
  }

  /**
   * Get the parent droppable ID.
   */
  #getParentDroppableId(): string | null {
    const groupName = this.#effectiveGroup();
    if (!groupName) {
      return null;
    }

    const droppable = this.#positionCalculator.getDroppableParent(
      this.#elementRef.nativeElement,
      groupName,
    );

    return droppable ? this.#positionCalculator.getDroppableId(droppable) : null;
  }
}
