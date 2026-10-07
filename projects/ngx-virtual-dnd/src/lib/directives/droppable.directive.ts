import {
  afterNextRender,
  computed,
  Directive,
  effect,
  ElementRef,
  inject,
  input,
  NgZone,
  OnDestroy,
  output,
  untracked,
} from '@angular/core';
import { DragStateService } from '../services/drag-state.service';
import { AutoScrollConfig, AutoScrollService } from '../services/auto-scroll.service';
import { DroppableRegistryService } from '../services/droppable-registry.service';
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
import { normalizeDropDestinationIndex } from '../utils/drop-index-normalization';
import { listDraggables } from '../utils/list-draggables';

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
  readonly #registry = inject(DroppableRegistryService);
  readonly #ngZone = inject(NgZone);
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

  /** Emits when an item is dropped on this droppable: at release, right after its `dragEnd` */
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

  /**
   * `END_OF_LIST` while this droppable is active, otherwise null.
   * @deprecated It never identifies an item. For the position, use the `placeholderMove` output
   * (and `DropEvent.destination.index` on drop). Will be removed in the next major version.
   */
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

  /** Whether this droppable has rendered, so its inputs have values */
  #rendered = false;

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

    afterNextRender(() => (this.#rendered = true));

    // Register with the droppable registry, and again under the new key when the ID or group
    // changes. Drag code finds drop targets through the registry instead of querying the
    // document; a registration during an active drag makes this droppable a target from the
    // next hit-test. The registry also calls #handleDrop when a drag ends on this droppable.
    // The cleanup unregisters it, including on destroy.
    //
    // Not deferred to afterNextRender: this runs in the change detection that creates the
    // droppable (inputs are set by then), so afterNextRender hooks of that same render (drop
    // animation, keyboard focus restore) already find it, and so does a view refreshed only
    // by its own detectChanges(). Nothing reads the registry before change detection ends.
    effect((onCleanup) => {
      const group = this.effectiveGroup();
      if (!group) {
        return;
      }
      onCleanup(
        this.#registry.register(
          this.#elementRef.nativeElement,
          this.vdndDroppable(),
          group,
          (endedState) => this.#handleDrop(endedState),
        ),
      );
    });

    effect(() => {
      const currentIndex = this.#placeholderInsertionIndex();
      untracked(() => this.#handlePlaceholderMove(currentIndex));
    });
  }

  ngOnDestroy(): void {
    // Destroyed before it rendered: its inputs may have no values yet and it never became the
    // active drop target. (Not an ngOnInit flag: a subclass with its own ngOnInit would skip
    // it.) A registry registration, if any, is removed by its effect's cleanup.
    if (!this.#rendered) {
      return;
    }

    // Clean up if this droppable is destroyed while being active
    if (this.isActive()) {
      this.#dragState.setActiveDroppable(null);
    }

    // Auto-scroll and the droppable registry unregister through their effects' cleanup.
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
   * Emit `drop` for a drag that ended on this droppable. Called by the registry from
   * `DragStateService.endDrag()`, with the state captured just before the reset. Returns
   * whether it emitted.
   */
  #handleDrop(state: DragState): boolean {
    // A target disabled at release is not a valid drop (dragEnd reports no destination).
    if (this.disabled() || !state.draggedItem || state.activeDroppableId !== this.vdndDroppable()) {
      return false;
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

    const event: DropEvent = {
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
    };
    // Delivered from the pointer/keyboard listener, which runs outside Angular's zone. With
    // zone.js a template listener marks its view dirty without scheduling a render, so emit
    // inside the zone for the consumer's handler (and async work it starts) to render. A
    // no-op when zoneless.
    this.#ngZone.run(() => this.drop.emit(event));
    return true;
  }

  /**
   * Get the index of an item in a droppable.
   * This is a simplified implementation - in practice, the consumer would track this.
   */
  #getItemIndex(draggableId: string, droppableId: string): number {
    // Find all draggables in the source droppable
    const droppable = this.#registry.getById(droppableId);
    if (!droppable) {
      return 0;
    }

    const index = listDraggables(droppable).findIndex(
      (draggable) => draggable.getAttribute('data-draggable-id') === draggableId,
    );
    return Math.max(index, 0);
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
