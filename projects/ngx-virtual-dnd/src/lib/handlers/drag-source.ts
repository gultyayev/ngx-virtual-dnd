import type { DraggedItem, DragStartEvent, CursorPosition } from '../models/drag-drop.models';
import type { DragIndexCalculatorService } from '../services/drag-index-calculator.service';
import type { ElementCloneService } from '../services/element-clone.service';
import type { OverlayContainerService } from '../services/overlay-container.service';
import type { PositionCalculatorService } from '../services/position-calculator.service';
import { listDraggables } from '../utils/list-draggables';
import type { ItemIndex } from '../utils/index-semantics';
import { shiftOffsetY } from '../utils/shift-animator';

/**
 * Picking an item up, shared by the pointer and keyboard drags: where the item is (measured before
 * the drag state hides it with `display: none`, which zeroes its rect), the preview clone, and the
 * item and event the drag starts with. What differs between the two (pointer thresholds, the grab
 * offset, hit-testing, keyboard navigation) stays in their handlers.
 */

export interface DragSourceDeps {
  positionCalculator: PositionCalculatorService;
  dragIndexCalculator: DragIndexCalculatorService;
  elementClone: ElementCloneService;
  overlayContainer: OverlayContainerService;
}

/** The item a drag picks up, as the draggable renders it when the drag starts */
export interface DragSourceContext {
  element: HTMLElement;
  draggableId: string;
  data: unknown;
}

/** Where the picked-up item is, read before it is hidden */
export interface DragSource {
  /** The item's rect */
  rect: DOMRect;
  /** The list the item is in (of its group), if any */
  droppableElement: HTMLElement | null;
  /** That list's ID, if any */
  droppableId: string | null;
  /** The item's index in that list (0 without a list) */
  sourceIndex: ItemIndex;
}

/** Measure where `element` is: its rect, its list and its index in it. Call before hiding it. */
export function measureDragSource(
  deps: DragSourceDeps,
  element: HTMLElement,
  groupName: string,
): DragSource {
  const rect = element.getBoundingClientRect();
  const droppableElement = deps.positionCalculator.getDroppableParent(element, groupName);
  const droppableId = droppableElement
    ? deps.positionCalculator.getDroppableId(droppableElement)
    : null;
  return {
    rect,
    droppableElement,
    droppableId,
    sourceIndex: measureSourceIndex(deps, element, rect, droppableElement),
  };
}

/**
 * The item the drag state records: the source, its preview clone and the draggable's data. Call
 * before the drag state hides the element. Template-first: no clone (a costly computed-style walk)
 * when a template preview is mounted, as that clone would never render.
 */
export function createDraggedItem(
  deps: DragSourceDeps,
  context: DragSourceContext,
  source: DragSource,
): DraggedItem {
  const clonedElement = deps.overlayContainer.hasTemplatePreview()
    ? undefined
    : deps.elementClone.cloneElement(context.element);
  return {
    draggableId: context.draggableId,
    droppableId: source.droppableId ?? '',
    element: context.element,
    clonedElement,
    height: source.rect.height,
    width: source.rect.width,
    data: context.data,
  };
}

/** The `dragStart` event of a drag that picked up `item` at `position` */
export function createDragStartEvent(
  item: DraggedItem,
  sourceIndex: ItemIndex,
  position: CursorPosition,
): DragStartEvent {
  return {
    draggableId: item.draggableId,
    droppableId: item.droppableId,
    data: item.data,
    position,
    sourceIndex,
  };
}

/**
 * The index of `element` (measured at `rect`) in `droppableElement` (0 without a list). Uses the list's strategy when it
 * registered one, for exact lookups with variable heights.
 */
function measureSourceIndex(
  deps: DragSourceDeps,
  element: HTMLElement,
  rect: DOMRect,
  droppableElement: HTMLElement | null,
): ItemIndex {
  if (!droppableElement) {
    return 0;
  }

  // The same measurement that places the placeholder: it knows each container's scroll
  // element and subtracts space reserved above the rows (contentOffset, page headers).
  const geometry = deps.dragIndexCalculator.getScrollGeometry(droppableElement, rect.height);
  // A row still sliding into its slot (shift animation) is drawn away from it: measure the slot
  const relativeY =
    rect.top - slideOffsetY(element, droppableElement) - geometry.rect.top + geometry.scrollTop;

  // Try to use registered strategy for accurate offset-based lookup
  const droppableId = deps.positionCalculator.getDroppableId(droppableElement);
  if (droppableId) {
    const strategy = deps.dragIndexCalculator.getStrategyForDroppable(droppableId);
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

/** How far running slides draw `element` (or the row around it) from its slot in `list` */
function slideOffsetY(element: HTMLElement, list: HTMLElement): number {
  let offset = 0;
  for (let node: HTMLElement | null = element; node && node !== list; node = node.parentElement) {
    offset += shiftOffsetY(node);
  }
  return offset;
}
