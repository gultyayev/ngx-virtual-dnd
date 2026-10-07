import {
  computed,
  Directive,
  ElementRef,
  EnvironmentInjector,
  ErrorHandler,
  inject,
  input,
  NgZone,
  OnChanges,
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
import { closestAcrossShadow } from '../utils/composed-dom';
import { KeyboardDragHandler } from '../handlers/keyboard-drag.handler';
import { PointerDragHandler } from '../handlers/pointer-drag.handler';
import { normalizeDropDestinationIndex } from '../utils/drop-index-normalization';
import { listDraggables } from '../utils/list-draggables';
import { visibleRect } from '../utils/scroll-insets';
import {
  findNestedControl,
  findNoDragElement,
  isInTextEntryDraggable,
} from '../utils/interactive-elements';

/** Key names as Angular's `keydown.<key>` bindings spell them, for the `event.key` values that differ */
const KEY_NAMES: Record<string, string> = {
  ' ': 'space',
  Esc: 'escape',
  '\x1B': 'escape',
  Up: 'arrowup',
  Down: 'arrowdown',
  Left: 'arrowleft',
  Right: 'arrowright',
};

/** The keys an item handles */
const HANDLED_KEYS = new Set([
  'space',
  'enter',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'escape',
]);

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
  },
})
export class DraggableDirective implements OnChanges, OnInit, OnDestroy {
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

  /** The item whose press is ready to drag (its delay has passed) */
  readonly #pendingId = signal<string | null>(null);

  /**
   * Whether this element is in the "ready to drag" state (delay has passed). Tied to the pressed
   * item: a recycled row that renders another item is not ready to drag.
   */
  readonly isPending = computed(() => {
    const pendingId = this.#pendingId();
    return pendingId !== null && pendingId === this.vdndDraggable();
  });

  /** Whether this element is currently being dragged (based on global drag state) */
  readonly isDragging = computed(() => {
    const draggedItem = this.#dragState.draggedItem();
    return draggedItem?.draggableId === this.vdndDraggable();
  });

  #keyboardHandler!: KeyboardDragHandler;
  #pointerHandler!: PointerDragHandler;

  /** Set by ngOnInit, which creates the handlers */
  #initialized = false;

  /**
   * Keys pressed on the item: one listener, added outside Angular's zone, instead of a
   * `(keydown.<key>)` host binding per key, as Angular adds a listener to every row for each.
   * Like those bindings, it ignores a key pressed with Shift, Ctrl, Alt or Meta, runs the handler
   * of a key it handles in the zone (so zone.js apps still render after it), prevents the key's
   * default action when the handler returns false, and reports what the handler throws to the
   * ErrorHandler. Added in the constructor, so it runs before the element's template listeners,
   * as host listeners do.
   */
  readonly #onKeydown = (event: KeyboardEvent): void => {
    if (!this.#initialized || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    const key = event.key ? (KEY_NAMES[event.key] ?? event.key.toLowerCase()) : '';
    if (!HANDLED_KEYS.has(key)) {
      return;
    }
    this.#ngZone.run(() => {
      try {
        if (this.#handleKey(key, event) === false) {
          event.preventDefault();
        }
      } catch (error) {
        this.#envInjector.get(ErrorHandler).handleError(error);
      }
    });
  };

  /**
   * Touch presses on the item. Added programmatically, not as a host binding (which Angular adds
   * without options, so non-passive): a swipe that starts on an element with a non-passive
   * touchstart listener can't scroll until the main thread has run it. With a drag delay the press
   * never cancels the scroll (the page must scroll when the user swipes before the delay passes),
   * so the listener is passive; without one it prevents the default action and is non-passive.
   * Like the keydown listener, it runs the handler in the zone (as the mousedown host binding
   * does) and reports what it throws to the ErrorHandler. Added once the inputs are set, so unlike
   * a host listener it runs after the element's template listeners.
   */
  readonly #onTouchStart = (event: TouchEvent): void => {
    if (!this.#initialized) {
      return;
    }
    this.#ngZone.run(() => {
      try {
        this.onPointerDown(event, true);
      } catch (error) {
        this.#envInjector.get(ErrorHandler).handleError(error);
      }
    });
  };

  /** Whether the touchstart listener is passive, or null while it isn't added */
  #touchStartPassive: boolean | null = null;

  constructor() {
    this.#ngZone.runOutsideAngular(() =>
      this.#elementRef.nativeElement.addEventListener('keydown', this.#onKeydown),
    );
  }

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
    this.#pendingId.set(pending ? this.vdndDraggable() : null);
  }

  /**
   * Find the element to use for container constraint clamping.
   * If the droppable is inside a scrollable container, use that container's rect
   * (which represents the visible viewport) instead of the droppable's rect
   * (which may extend far beyond the viewport in virtual scroll scenarios).
   */
  #findConstraintElement(droppableElement: HTMLElement | null): HTMLElement | null {
    if (!droppableElement) return null;
    const scrollable = closestAcrossShadow(droppableElement, '.vdnd-scrollable');
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
        onDragStart: (event) => this.#ngZone.run(() => this.dragStart.emit(event)),
        // The keyboard handler ends the drag inside the zone (dragEnd, drop, focus restore)
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
        isOtherDragActive: () => this.#dragState.isDragging() && !this.isDragging(),
      },
      getContext: () => ({
        element: this.#elementRef.nativeElement,
        draggableId: this.vdndDraggable(),
        groupName: this.#effectiveGroup(),
        disabled: this.disabled(),
        dragHandle: this.dragHandle(),
        dragThreshold: this.dragThreshold(),
        dragDelay: this.dragDelay(),
      }),
    });

    this.#initialized = true;
    this.#listenForTouchStart();
  }

  ngOnChanges(): void {
    this.#listenForTouchStart();
  }

  ngOnDestroy(): void {
    this.#elementRef.nativeElement.removeEventListener('keydown', this.#onKeydown);
    this.#elementRef.nativeElement.removeEventListener('touchstart', this.#onTouchStart);

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
   * Add the touchstart listener, or re-add it when the drag delay changes whether it can be
   * passive. Lifecycle hooks, not an effect: creating a view effect schedules a change detection
   * that visits every ancestor, and a virtual list creates rows on each scroll step.
   */
  #listenForTouchStart(): void {
    // The handler cancels the scroll of a touch press only when there is no delay
    const passive = this.dragDelay() !== 0;
    if (passive === this.#touchStartPassive) {
      return;
    }
    const element: HTMLElement = this.#elementRef.nativeElement;
    element.removeEventListener('touchstart', this.#onTouchStart);
    this.#ngZone.runOutsideAngular(() =>
      element.addEventListener('touchstart', this.#onTouchStart, { passive }),
    );
    this.#touchStartPassive = passive;
  }

  /** Run the handler of a key the item handles (see HANDLED_KEYS), returning what it returns. */
  #handleKey(key: string, event: KeyboardEvent): unknown {
    switch (key) {
      case 'space':
        return this.onKeyboardActivate(event);
      case 'enter':
        return this.onEnterKey(event);
      case 'escape':
        return this.onEscape();
      default:
        return this.onArrowKey(event);
    }
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

    // Space in a draggable that is itself a text field, select or editable element types into
    // it (or toggles or opens it); such an item picks up with Space on a drag handle inside it.
    // While this item's keyboard drag runs, Space still drops it.
    if (!this.#keyboardHandler.isActive() && this.#isInTextEntryHost(event)) {
      return;
    }

    // Space on a control inside the item types into it or clicks it, just as a press on
    // one never starts a pointer drag.
    if (this.#isFromNestedControl(event)) {
      return;
    }

    event.preventDefault();

    // If we're in a keyboard drag, Space drops the item
    if (this.#keyboardHandler.isActive()) {
      event.stopPropagation(); // Prevent document listener from receiving this event
      this.#keyboardHandler.complete();
      return;
    }

    // Another drag is in progress: don't replace it. The key goes on to the document, where a
    // keyboard drag of another item drops with it.
    if (this.#dragState.isDragging()) {
      return;
    }

    // Start keyboard drag. The document listener it adds must not receive this event.
    event.stopPropagation();
    this.#keyboardHandler.activate();
  }

  /** Whether the event goes to this draggable being a text-entry control (see isInTextEntryDraggable) */
  #isInTextEntryHost(event: Event): boolean {
    const target = event.target;
    return (
      target instanceof Element &&
      isInTextEntryDraggable(target, this.#elementRef.nativeElement, this.dragHandle())
    );
  }

  /**
   * Whether the event comes from a control (or from inside a `no-drag` element) nested inside this
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

    if (findNoDragElement(target, host) !== null) {
      return true;
    }

    const control = findNestedControl(target, host);
    if (control === null) {
      return false;
    }

    const handleSelector = this.dragHandle();
    return !handleSelector || !control.matches(handleSelector);
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

    // Cache constraint flag and element for clamping during drag. The item's own list decides:
    // the move that starts the drag can already be outside it, or over content pinned over its
    // scroll container's edge, which is not part of any list.
    const constraintSource = parentDroppableElement ?? droppableElement;
    this.#constrainToContainer =
      constraintSource?.hasAttribute('data-constrain-to-container') ?? false;
    this.#constraintElement = this.#constrainToContainer
      ? this.#findConstraintElement(constraintSource)
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
      this.#pointerHandler.isTouchPress(),
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
    // Pointer listeners run outside Angular's zone. With zone.js a template listener marks
    // its view dirty but schedules no render, so emit inside the zone (a no-op when zoneless).
    const event: DragStartEvent = {
      draggableId: this.vdndDraggable(),
      droppableId: parentDroppableId ?? '',
      data: this.vdndDraggableData(),
      position,
      sourceIndex,
    };
    this.#ngZone.run(() => this.dragStart.emit(event));
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

    // Non-virtual fallback: derive the logical index from the list's draggables in page order.
    // Geometry-based division is incorrect when the list has padding, gaps, margins,
    // or variable-height items.
    const index = listDraggables(droppableElement).indexOf(element);
    if (index !== -1) {
      return index;
    }

    // An item in a shadow tree inside the list is not among them: count its preceding siblings
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
   * The boundaries are those of the part of the container that shows: content pinned over its
   * edges (scroll insets) and the scroll containers around it can hide part of it.
   */
  #clampToContainer(position: CursorPosition): CursorPosition {
    if (!this.#constrainToContainer || !this.#constraintElement) {
      return position;
    }

    const containerRect = this.#constraintRect(this.#constraintElement);
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
   * The rect a constrained drag stays in: the part of the container that shows. When nothing of
   * it shows (scrolled out of view, or all behind sticky content), the whole container, as
   * without scroll insets: autoscroll at its edge brings it back into view.
   */
  #constraintRect(element: HTMLElement): DOMRect {
    return visibleRect(element) ?? element.getBoundingClientRect();
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
    // of where the user grabbed the item. Like the preview, it stays in the part of the
    // container that shows.
    if (this.#constrainToContainer && this.#constraintElement && this.#lastRawPosition) {
      const rect = this.#constraintRect(this.#constraintElement);
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

    const event: DragEndEvent = {
      draggableId: this.vdndDraggable(),
      // The source list as the drag started from it. Not a DOM lookup first: a draggable
      // destroyed mid-drag (its row removed) is already detached from the list here.
      droppableId: this.#dragState.sourceDroppableId() || this.#getParentDroppableId() || '',
      cancelled,
      data: this.vdndDraggableData(),
      sourceIndex,
      destinationIndex,
    };

    // dragEnd, then the state reset that delivers drop, in ONE zone entry: listeners run
    // outside Angular's zone, and with zone.js each entry renders when it is left, so
    // separate entries would render the drag end twice. A no-op when zoneless.
    this.#ngZone.run(() => {
      this.dragEnd.emit(event);

      // Clear drag state - this triggers isDragging computed to become false
      if (cancelled) {
        this.#dragState.cancelDrag();
      } else {
        this.#dragState.endDrag();
      }
    });
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
