import {
  afterNextRender,
  computed,
  Directive,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  untracked,
} from '@angular/core';
import { DragStateService } from '../services/drag-state.service';
import { AutoScrollConfig, AutoScrollService } from '../services/auto-scroll.service';
import { PositionCalculatorService } from '../services/position-calculator.service';
import {
  DraggedItem,
  DragState,
  DropEvent,
  END_OF_LIST,
  PlaceholderMoveEvent,
} from '../models/drag-drop.models';
import { VDND_GROUP_TOKEN } from './droppable-group.directive';
import { createEffectiveGroupSignal } from '../utils/group-resolution';
import { createAutoScrollRegistration } from '../utils/auto-scroll-registration';
import { queryByAttribute } from '../utils/attribute-selectors';
import { normalizeDropDestinationIndex } from '../utils/drop-index-normalization';

/**
 * Marks an element as a valid drop target within the virtual scroll drag-and-drop system.
 *
 * @example
 * ```html
 * <!-- With explicit group -->
 * <div
 *   vdndDroppable="list-1"
 *   vdndDroppableGroup="my-group"
 *   (drop)="onDrop($event)">
 *   <!-- Draggable items here -->
 * </div>
 *
 * <!-- With inherited group from parent vdndGroup directive -->
 * <div vdndGroup="my-group">
 *   <div vdndDroppable="list-1" (drop)="onDrop($event)">
 *     <!-- Draggable items here -->
 *   </div>
 * </div>
 * ```
 */
@Directive({
  selector: '[vdndDroppable]',
  host: {
    '[attr.data-droppable-id]': 'vdndDroppable()',
    '[attr.data-droppable-group]': 'effectiveGroup()',
    '[attr.data-droppable-disabled]': 'disabled() || null',
    '[attr.data-constrain-to-container]': 'constrainToContainer() || null',
    '[attr.aria-dropeffect]': '"move"',
    '[class.vdnd-droppable]': 'true',
    '[class.vdnd-droppable-active]': 'isActive()',
    '[class.vdnd-droppable-disabled]': 'disabled()',
  },
})
export class DroppableDirective implements OnDestroy {
  readonly #elementRef = inject(ElementRef<HTMLElement>);
  readonly #dragState = inject(DragStateService);
  readonly #autoScroll = inject(AutoScrollService);
  readonly #positionCalculator = inject(PositionCalculatorService);
  readonly #parentGroup = inject(VDND_GROUP_TOKEN, { optional: true });

  /** Unique identifier for this droppable */
  vdndDroppable = input.required<string>();

  /**
   * Drag-and-drop group name.
   * Optional when a parent `vdndGroup` directive provides the group context.
   */
  vdndDroppableGroup = input<string>();

  /**
   * Resolved group name - uses explicit input or falls back to parent group.
   * Returns null (and disables dropping) if neither is available.
   */
  readonly effectiveGroup = createEffectiveGroupSignal({
    explicitGroup: this.vdndDroppableGroup,
    parentGroup: this.#parentGroup,
    elementId: this.vdndDroppable,
    elementType: 'droppable',
  });

  /** Optional data associated with this droppable */
  vdndDroppableData = input<unknown>();

  /** Whether this droppable is disabled */
  disabled = input<boolean>(false);

  /** Enable auto-scroll when dragging near edges */
  autoScrollEnabled = input<boolean>(true);

  /** Auto-scroll configuration */
  autoScrollConfig = input<Partial<AutoScrollConfig>>({});

  /** Constrain drag preview and placeholder to container boundaries */
  constrainToContainer = input<boolean>(false);

  /** Emits when an item is dropped on this droppable */
  // eslint-disable-next-line @angular-eslint/no-output-native
  drop = output<DropEvent>();

  /**
   * Emits each time the placeholder moves within this droppable during a drag
   * (every item displacement) — e.g. to trigger haptic feedback.
   */
  placeholderMove = output<PlaceholderMoveEvent>();

  /** Whether this droppable is currently being targeted */
  readonly isActive = computed(() => {
    const activeId = this.#dragState.activeDroppableId();
    return activeId === this.vdndDroppable() && !this.disabled();
  });

  /** The current placeholder ID when this droppable is active */
  readonly placeholderId = computed(() => {
    if (!this.isActive()) {
      return null;
    }
    return this.#dragState.placeholderId();
  });

  /**
   * The placeholder's insertion index in this droppable (DropEvent convention),
   * or null when the placeholder is not here.
   */
  readonly #placeholderInsertionIndex = computed(() => {
    if (!this.isActive() || !this.#dragState.isDragging()) {
      return null;
    }
    const sourceIndex = this.#dragState.sourceIndex();
    return normalizeDropDestinationIndex({
      sourceIndex: sourceIndex ?? -1,
      placeholderIndex: this.#dragState.placeholderIndex(),
      // Without a known source index there is no hidden-source adjustment to undo
      sourceDroppableId: sourceIndex === null ? null : this.#dragState.sourceDroppableId(),
      activeDroppableId: this.vdndDroppable(),
    });
  });

  /** Last insertion index reported via placeholderMove (null when not here) */
  #lastPlaceholderIndex: number | null = null;

  /** Drag whose initial placeholder position has already been seen by this droppable */
  #placeholderTrackedDrag: DraggedItem | null = null;

  /** Track previous active state to detect the drag-end transition */
  #wasActive = false;

  /**
   * The terminal drag snapshot this droppable has already processed. `endedDragState`
   * persists until the next drag starts, so this guards against replaying the same drop
   * when the effect re-runs (e.g. `disabled()` toggling) after the drag has ended.
   */
  #handledEndedState: DragState | null = null;

  constructor() {
    createAutoScrollRegistration({
      autoScrollService: this.#autoScroll,
      getElement: () => this.#elementRef.nativeElement,
      getId: () => this.vdndDroppable(),
      enabled: () => this.autoScrollEnabled(),
      config: () => this.autoScrollConfig(),
      // Register whenever a group is resolved; do NOT gate on scrollability. DOM size is
      // not reactive, so a list that becomes scrollable after init (async data, resize)
      // would never register. AutoScrollService filters by live scroll geometry per drag.
      canRegister: () => Boolean(this.effectiveGroup()),
    });

    // Notify the calculator once this droppable is rendered (host data attributes applied).
    // Matters when it mounts DURING an active drag — the candidate snapshot was frozen at
    // drag start, so without this a conditionally rendered list would never become a target.
    afterNextRender(() => {
      const group = this.effectiveGroup();
      if (group) {
        this.#positionCalculator.notifyCandidatesChanged(group);
      }
    });

    effect(() => {
      const currentIndex = this.#placeholderInsertionIndex();
      untracked(() => this.#handlePlaceholderMove(currentIndex));
    });

    // React to state changes and handle drop events.
    //
    // Keyed only on the low-frequency fields (isActive/isDragging/draggedItem). The final
    // placeholder/index values #handleDrop needs are captured by DragStateService.endDrag()
    // into endedDragState() at the drag-end boundary, so this effect never has to poll the
    // high-frequency cursor/placeholder signals — reading them here would make it re-run and
    // re-allocate a snapshot on every 60fps frame, defeating the service's signal splitting.
    effect(() => {
      const active = this.isActive();
      const draggedItem = this.#dragState.draggedItem();
      const isDragging = this.#dragState.isDragging();

      // Handle drag end (drop). This droppable is the release target when it was either
      // observed active during the drag (#wasActive) OR named as the target in the ended
      // drag snapshot. The snapshot path covers the pointer-up flush, where the final
      // position is processed and the state cleared in the same synchronous task, so this
      // effect never observes isActive() === true mid-drag and #wasActive stays false.
      const endedState = untracked(() => this.#dragState.endedDragState());
      const endedTargetedThis = endedState?.activeDroppableId === this.vdndDroppable();

      if (!isDragging && draggedItem === null && (this.#wasActive || endedTargetedThis)) {
        // Consume each terminal snapshot exactly once. endedDragState persists until the
        // next drag starts and disabled()/other inputs re-run this effect, so without a
        // per-snapshot guard a later state change would replay the same historical drop.
        if (endedState !== this.#handledEndedState) {
          this.#handledEndedState = endedState;
          // Emit only for an enabled target that ended normally. A target disabled at
          // release still consumes the snapshot (so re-enabling can't resurrect the drop)
          // but emits nothing, keeping dragEnd and drop consistent.
          if (!this.disabled() && !this.#dragState.wasCancelled()) {
            this.#handleDrop();
          }
        }
      }

      this.#wasActive = active;
    });
  }

  ngOnDestroy(): void {
    // Clean up if this droppable is destroyed while being active
    if (this.isActive()) {
      this.#dragState.setActiveDroppable(null);
    }

    // Unregister from auto-scroll
    this.#autoScroll.unregisterContainer(this.vdndDroppable());

    // If this droppable unmounts mid-drag, tell the calculator so it drops it from the
    // frozen candidate list (deferred re-query runs once the element has left the DOM).
    const group = untracked(() => this.effectiveGroup());
    if (group) {
      this.#positionCalculator.notifyCandidatesChanged(group);
    }
  }

  /**
   * Emit placeholderMove when the placeholder moved within (or entered) this droppable.
   */
  #handlePlaceholderMove(currentIndex: number | null): void {
    let previousIndex = this.#lastPlaceholderIndex;
    this.#lastPlaceholderIndex = currentIndex;

    const draggedItem = this.#dragState.draggedItem();
    if (currentIndex === null || currentIndex === previousIndex || !draggedItem) {
      return;
    }

    // The drag's first placement in the source list starts from the item's own slot:
    // nothing is displaced when the placeholder simply takes the hidden item's place.
    const isFirstPlacement = this.#placeholderTrackedDrag !== draggedItem;
    this.#placeholderTrackedDrag = draggedItem;
    const sourceDroppableId = this.#dragState.sourceDroppableId();
    const sourceIndex = this.#dragState.sourceIndex();
    if (isFirstPlacement && sourceDroppableId === this.vdndDroppable() && sourceIndex !== null) {
      if (currentIndex === sourceIndex) {
        return;
      }
      previousIndex = sourceIndex;
    }

    this.placeholderMove.emit({
      draggableId: draggedItem.draggableId,
      sourceDroppableId: sourceDroppableId ?? '',
      droppableId: this.vdndDroppable(),
      previousIndex,
      currentIndex,
      data: draggedItem.data,
    });
  }

  /**
   * Handle a drop on this droppable.
   */
  #handleDrop(): void {
    // The live state is cleared before this effect fires, so read the terminal snapshot
    // captured by endDrag()/cancelDrag() immediately before the reset.
    const state = untracked(() => this.#dragState.endedDragState());

    if (!state?.draggedItem || state.activeDroppableId !== this.vdndDroppable()) {
      return;
    }

    const sourceDroppableId = state.sourceDroppableId ?? '';
    const placeholderId = state.placeholderId ?? END_OF_LIST;

    // Use the stored source index from drag state
    // This is critical for virtual scrolling where the original element may no longer
    // be in the DOM after autoscroll (it gets virtualized out of view)
    const sourceIndex =
      state.sourceIndex ?? this.#getItemIndex(state.draggedItem.draggableId, sourceDroppableId);

    // Use the pre-calculated placeholderIndex if available (more reliable)
    // Fall back to DOM-based calculation if not. Then normalize to the same
    // consumer-facing insertion index emitted by DragEndEvent.
    const placeholderIndex =
      state.placeholderIndex !== null && state.placeholderIndex !== undefined
        ? state.placeholderIndex
        : this.#getDestinationIndex(placeholderId);
    const destinationIndex = normalizeDropDestinationIndex({
      sourceIndex,
      placeholderIndex,
      sourceDroppableId,
      activeDroppableId: this.vdndDroppable(),
    });

    this.drop.emit({
      source: {
        draggableId: state.draggedItem.draggableId,
        droppableId: sourceDroppableId,
        index: sourceIndex,
        data: state.draggedItem.data,
      },
      destination: {
        droppableId: this.vdndDroppable(),
        placeholderId,
        index: destinationIndex,
        data: this.vdndDroppableData(),
      },
    });
  }

  /**
   * Get the index of an item in a droppable.
   * This is a simplified implementation - in practice, the consumer would track this.
   */
  #getItemIndex(draggableId: string, droppableId: string): number {
    // Find all draggables in the source droppable
    const droppable = queryByAttribute<HTMLElement>(document, 'data-droppable-id', droppableId);
    if (!droppable) {
      return 0;
    }

    const draggables = droppable.querySelectorAll('[data-draggable-id]');
    for (let i = 0; i < draggables.length; i++) {
      if (draggables[i].getAttribute('data-draggable-id') === draggableId) {
        return i;
      }
    }

    return 0;
  }

  /**
   * Get the destination index based on the placeholder.
   */
  #getDestinationIndex(placeholderId: string): number {
    // Exclude placeholder elements from the count
    const draggables = this.#elementRef.nativeElement.querySelectorAll(
      '[data-draggable-id]:not([data-draggable-id="placeholder"])',
    );

    if (placeholderId === END_OF_LIST) {
      return draggables.length;
    }

    // Find the index of the placeholder item
    for (let i = 0; i < draggables.length; i++) {
      if (draggables[i].getAttribute('data-draggable-id') === placeholderId) {
        return i;
      }
    }

    return 0;
  }

  /**
   * Get the element reference (for external use).
   */
  getElement(): HTMLElement {
    return this.#elementRef.nativeElement;
  }

  /**
   * Manually scroll this droppable.
   */
  scrollBy(delta: number): void {
    this.#elementRef.nativeElement.scrollTop += delta;
  }

  /**
   * Get the current scroll position.
   */
  getScrollTop(): number {
    return this.#elementRef.nativeElement.scrollTop;
  }

  /**
   * Get the scroll height.
   */
  getScrollHeight(): number {
    return this.#elementRef.nativeElement.scrollHeight;
  }
}
