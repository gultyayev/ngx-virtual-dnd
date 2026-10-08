import { closestAcrossShadow, parentAcrossShadow } from './composed-dom';

/**
 * The space (px) content pinned over a scroll container's top and bottom edges covers, such as a
 * sticky header or footer inside it. `vdndScrollable`, `vdnd-virtual-scroll` and
 * `vdnd-virtual-viewport` mark their element with their `scrollInsetTop` and `scrollInsetBottom`
 * inputs while they are not 0.
 */
export const SCROLL_INSET_TOP_ATTR = 'data-scroll-inset-top';
export const SCROLL_INSET_BOTTOM_ATTR = 'data-scroll-inset-bottom';

/**
 * The scroll containers a drag clips lists to: `vdndScrollable` elements, and any element with
 * scroll insets (a `vdnd-virtual-scroll` or `vdnd-virtual-viewport` that sets them).
 */
const SCROLL_CONTAINER_SELECTOR = `.vdnd-scrollable, [${SCROLL_INSET_TOP_ATTR}], [${SCROLL_INSET_BOTTOM_ATTR}]`;

/** Reads an element's viewport rect (lets a caller read each element once per pass). */
export type RectReader = (element: Element) => DOMRect;

const readRect: RectReader = (element) => element.getBoundingClientRect();

/** The space covered at an edge of a scroll container, or 0 (unmarked, negative or invalid). */
export function readScrollInset(element: Element, edge: 'top' | 'bottom'): number {
  const value = parseFloat(
    element.getAttribute(edge === 'top' ? SCROLL_INSET_TOP_ATTR : SCROLL_INSET_BOTTOM_ATTR) ?? '',
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Whether content pinned over either edge of a scroll container covers part of it. */
export function hasScrollInsets(element: Element): boolean {
  return readScrollInset(element, 'top') > 0 || readScrollInset(element, 'bottom') > 0;
}

/**
 * Rect results here are null when no area is left. A rect with a negative height would not do:
 * DOMRect normalizes it (its `top` is the lesser of `y` and `y + height`), so it would cover the
 * gap between the two rects it came from.
 */

/**
 * The part of a scroll container nothing pinned over its edges covers: its rect (`rect`, read
 * when not given) shrunk by its scroll insets. The rect itself when it has none; null when they
 * cover all of it.
 */
export function uncoveredRect(
  element: Element,
  rect = element.getBoundingClientRect(),
): DOMRect | null {
  const top = readScrollInset(element, 'top');
  const bottom = readScrollInset(element, 'bottom');
  if (top === 0 && bottom === 0) {
    return rect;
  }
  const uncoveredTop = rect.top + top;
  const uncoveredBottom = rect.bottom - bottom;
  if (uncoveredBottom <= uncoveredTop) {
    return null;
  }
  return new DOMRect(
    rect.left,
    uncoveredTop,
    rect.right - rect.left,
    uncoveredBottom - uncoveredTop,
  );
}

/** The overlap of two rects, or null when they don't overlap (or either is null). */
export function intersectRects(a: DOMRect | null, b: DOMRect | null): DOMRect | null {
  if (!a || !b) {
    return null;
  }
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) {
    return null;
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * The scroll containers around `element` (not itself), nearest first, looking past shadow roots
 * (see `SCROLL_CONTAINER_SELECTOR`).
 */
export function scrollAncestors(element: Element): Element[] {
  const containers: Element[] = [];
  let parent = parentAcrossShadow(element);
  while (parent) {
    const container = closestAcrossShadow(parent, SCROLL_CONTAINER_SELECTOR);
    if (!container) {
      break;
    }
    containers.push(container);
    parent = parentAcrossShadow(container);
  }
  return containers;
}

/**
 * `rect` clipped to the uncovered part of each of `containers`: `rect` itself without any, null
 * when they hide all of it.
 */
export function clipToScrollContainers(
  rect: DOMRect | null,
  containers: readonly Element[],
  read: RectReader = readRect,
): DOMRect | null {
  let clipped = rect;
  for (const container of containers) {
    if (!clipped) {
      return null;
    }
    clipped = intersectRects(clipped, uncoveredRect(container, read(container)));
  }
  return clipped;
}

/**
 * The part of `element` the space covered in it leaves: its rect (`rect`, read when not given)
 * minus its own scroll insets and those of a `vdnd-virtual-scroll` inside it, through any layout
 * wrappers (the droppable of `vdnd-sortable-list` wraps the one that scrolls its rows), but not
 * one in a list nested inside it. The rect itself without any, null when they cover all of it.
 */
export function ownUncoveredRect(
  element: Element,
  rect?: DOMRect,
  read: RectReader = readRect,
): DOMRect | null {
  let uncovered = uncoveredRect(element, rect ?? read(element));
  for (const scroller of Array.from(element.querySelectorAll('vdnd-virtual-scroll'))) {
    const owner = scroller.closest('[data-droppable-id]');
    const nestedList = owner !== null && owner !== element && element.contains(owner);
    if (!nestedList && hasScrollInsets(scroller)) {
      uncovered = intersectRects(uncovered, uncoveredRect(scroller, read(scroller)));
    }
  }
  return uncovered;
}

/**
 * The part of `element` that shows: its own uncovered part (see `ownUncoveredRect`), clipped to
 * the uncovered part of every scroll container around it. The rect itself when nothing clips or
 * covers it, null when nothing of it shows.
 */
export function visibleRect(
  element: Element,
  rect?: DOMRect,
  read: RectReader = readRect,
): DOMRect | null {
  return clipToScrollContainers(
    ownUncoveredRect(element, rect, read),
    scrollAncestors(element),
    read,
  );
}

/** Whether `element` scrolls its content vertically (an overflow that scrolls, and content to). */
function scrollsVertically(element: Element): boolean {
  if (element.scrollHeight <= element.clientHeight) {
    return false;
  }
  if (element === element.ownerDocument.scrollingElement) {
    return true;
  }
  const { overflowY } = getComputedStyle(element);
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
}

/** `uncoveredRect` of what shows of a scroll container: for the page, the viewport. */
function shownUncoveredRect(container: Element): DOMRect | null {
  return uncoveredRect(
    container,
    container === container.ownerDocument.scrollingElement
      ? new DOMRect(0, 0, container.clientWidth, container.clientHeight)
      : container.getBoundingClientRect(),
  );
}

/**
 * Scroll the containers around `element` (itself included), nearest first and the page last, so
 * the vertical range `top`..`bottom` (viewport px) shows in the part of each nothing pinned over
 * its edges covers (see `uncoveredRect`), and of the scroll containers around it as far as they
 * can't scroll it there themselves (a header over it in one that doesn't scroll). A container
 * whose uncovered part is shorter than the range is left as it is.
 */
export function revealRange(element: Element, top: number, bottom: number): void {
  for (
    let container: Element | null = element;
    container;
    container = parentAcrossShadow(container)
  ) {
    if (!scrollsVertically(container)) {
      continue;
    }
    const own = shownUncoveredRect(container);
    if (!own || own.height < bottom - top) {
      continue;
    }
    // Clear of what each scroll container around it covers, as far as that one can't scroll the
    // range out from under it on its own pass (top and bottom only: this scrolls vertically)
    let shownTop = own.top;
    let shownBottom = own.bottom;
    for (const ancestor of scrollAncestors(container)) {
      const uncovered = shownUncoveredRect(ancestor);
      if (!uncovered) {
        continue;
      }
      const scrolls = scrollsVertically(ancestor);
      const roomUp = scrolls ? ancestor.scrollTop : 0;
      const roomDown = scrolls
        ? ancestor.scrollHeight - ancestor.clientHeight - ancestor.scrollTop
        : 0;
      shownTop = Math.max(shownTop, uncovered.top - roomUp);
      shownBottom = Math.min(shownBottom, uncovered.bottom + roomDown);
    }
    // Too little of it left: reveal it in its own uncovered part
    if (shownBottom - shownTop < bottom - top) {
      shownTop = own.top;
      shownBottom = own.bottom;
    }
    const delta = top < shownTop ? top - shownTop : bottom > shownBottom ? bottom - shownBottom : 0;
    if (delta === 0) {
      continue;
    }
    const before = container.scrollTop;
    container.scrollTop = before + delta;
    const moved = container.scrollTop - before;
    top -= moved;
    bottom -= moved;
  }
}
