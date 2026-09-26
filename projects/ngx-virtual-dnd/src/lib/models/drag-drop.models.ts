/**
 * Represents the item currently being dragged.
 */
export interface DraggedItem {
  /** Unique identifier for the draggable item */
  draggableId: string;
  /** ID of the droppable container the item originated from */
  droppableId: string;
  /** Reference to the dragged element */
  element: HTMLElement;
  /** Cloned element for use in drag preview (auto-generated) */
  clonedElement?: HTMLElement;
  /** Height of the dragged element in pixels */
  height: number;
  /** Width of the dragged element in pixels */
  width: number;
  /** Optional user-provided data associated with the item */
  data?: unknown;
}

/**
 * Current position of the cursor during drag.
 */
export interface CursorPosition {
  x: number;
  y: number;
}

/**
 * Offset from cursor to the top-left corner of the dragged element.
 * Used to maintain grab position during drag.
 */
export interface GrabOffset {
  x: number;
  y: number;
}

/**
 * Complete state of the drag-and-drop system.
 */
export interface DragState {
  /** Whether a drag operation is currently in progress */
  isDragging: boolean;
  /** Information about the item being dragged */
  draggedItem: DraggedItem | null;
  /** ID of the droppable where the drag started */
  sourceDroppableId: string | null;
  /** Original index of the dragged item in the source list */
  sourceIndex: number | null;
  /** ID of the droppable currently being hovered over */
  activeDroppableId: string | null;
  /**
   * `END_OF_LIST` while a droppable is targeted, otherwise null.
   * @deprecated It never identifies an item. Use `placeholderIndex`. Will be removed in the next
   * major version.
   */
  placeholderId: string | null;
  /** Index where the placeholder should be inserted */
  placeholderIndex: number | null;
  /** Current cursor position */
  cursorPosition: CursorPosition | null;
  /** Offset from cursor to element top-left (for maintaining grab position) */
  grabOffset: GrabOffset | null;
  /** Position when drag started (for axis locking) */
  initialPosition: CursorPosition | null;
  /** Axis to freeze ('x' = X frozen → vertical-only, 'y' = Y frozen → horizontal-only) */
  lockAxis: 'x' | 'y' | null;
  /** Whether this is a keyboard-initiated drag */
  isKeyboardDrag: boolean;
  /** Target index during keyboard navigation */
  keyboardTargetIndex: number | null;
}

/**
 * Event emitted when a drag operation starts.
 */
export interface DragStartEvent {
  /** Unique identifier for the draggable item */
  draggableId: string;
  /** ID of the droppable container the item originated from */
  droppableId: string;
  /** Optional user-provided data associated with the item */
  data?: unknown;
  /** Position where the drag started */
  position: CursorPosition;
  /** 0-indexed position in the source list (for screen reader announcements) */
  sourceIndex: number;
}

/**
 * Source information for a drop event.
 */
export interface DropSource {
  /** Unique identifier for the draggable item */
  draggableId: string;
  /** ID of the droppable container the item originated from */
  droppableId: string;
  /** Original index in the source list */
  index: number;
  /** Optional user-provided data associated with the item */
  data?: unknown;
}

/**
 * Destination information for a drop event.
 */
export interface DropDestination {
  /** ID of the droppable container receiving the item */
  droppableId: string;
  /**
   * The library always sets `END_OF_LIST`.
   * @deprecated It never identifies an item. Use `index` for the insertion position. Will be
   * removed in the next major version.
   */
  placeholderId: string;
  /** Target index in the destination list */
  index: number;
  /** Optional user-provided data associated with the droppable */
  data?: unknown;
}

/**
 * Event emitted when an item is dropped.
 */
export interface DropEvent {
  /** Information about where the item came from */
  source: DropSource;
  /** Information about where the item is going */
  destination: DropDestination;
}

/**
 * Event emitted by a droppable each time the placeholder moves within it during a drag,
 * i.e. whenever items are displaced. Useful for haptic feedback on every step.
 *
 * Indexes use the same convention as `DropEvent.destination.index` (the insertion index
 * the item would get if dropped now). Not emitted for the placeholder's initial position
 * at drag start, nor when the placeholder leaves this droppable.
 */
export interface PlaceholderMoveEvent {
  /** Unique identifier for the dragged item */
  draggableId: string;
  /** ID of the droppable container the item originated from */
  sourceDroppableId: string;
  /** ID of the droppable the placeholder moved within */
  droppableId: string;
  /**
   * Previous insertion index in this droppable, or `null` when the placeholder just entered
   * it from elsewhere. For the first move in the source list this is the item's own index.
   */
  previousIndex: number | null;
  /** New insertion index in this droppable */
  currentIndex: number;
  /** Optional user-provided data associated with the dragged item */
  data?: unknown;
}

/**
 * Event emitted when a drag operation ends (including cancel).
 */
export interface DragEndEvent {
  /** Unique identifier for the draggable item */
  draggableId: string;
  /** ID of the droppable container the item originated from */
  droppableId: string;
  /**
   * Whether the drag was actively cancelled (Escape key). Releasing over no valid
   * target (outside any droppable, or over a disabled droppable) is NOT a cancel —
   * it reports `cancelled: false` with `destinationIndex: null`. Branch on
   * `destinationIndex === null` to detect "no drop occurred".
   */
  cancelled: boolean;
  /** Optional user-provided data associated with the item */
  data?: unknown;
  /** Original 0-indexed position in source list (for cancel announcements) */
  sourceIndex: number;
  /**
   * Final 0-indexed insertion position, or `null` when there is no valid drop target —
   * a cancelled drag, a release outside every droppable, or a release over a disabled
   * droppable. A non-null value pairs with a `DropEvent` on the destination.
   */
  destinationIndex: number | null;
}

/**
 * Initial state for the drag state service.
 */
export const INITIAL_DRAG_STATE: DragState = {
  isDragging: false,
  draggedItem: null,
  sourceDroppableId: null,
  sourceIndex: null,
  activeDroppableId: null,
  placeholderId: null,
  placeholderIndex: null,
  cursorPosition: null,
  grabOffset: null,
  initialPosition: null,
  lockAxis: null,
  isKeyboardDrag: false,
  keyboardTargetIndex: null,
};

/**
 * The value of every `placeholderId` the library sets. Positions are reported as indexes
 * (`placeholderIndex`, `DropDestination.index`).
 * @deprecated Goes with the deprecated `placeholderId` fields. Use the indexes. Will be removed in
 * the next major version.
 */
export const END_OF_LIST = 'END_OF_LIST';
