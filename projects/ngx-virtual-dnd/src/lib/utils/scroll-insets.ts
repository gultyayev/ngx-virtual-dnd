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
 * minus its own scroll insets and those of a `vdnd-virtual-scroll` child (the droppable of
 * `vdnd-sortable-list` wraps the one that scrolls its rows). The rect itself without any, null
 * when they cover all of it.
 */
export function ownUncoveredRect(
  element: Element,
  rect?: DOMRect,
  read: RectReader = readRect,
): DOMRect | null {
  let uncovered = uncoveredRect(element, rect ?? read(element));
  for (const child of Array.from(element.children)) {
    if (child.tagName === 'VDND-VIRTUAL-SCROLL' && hasScrollInsets(child)) {
      uncovered = intersectRects(uncovered, uncoveredRect(child, read(child)));
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
  const { overflowY } = getComputedStyle(element);
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
}

/**
 * Scroll the containers around `element` (itself included), nearest first and the page last, so
 * the vertical range `top`..`bottom` (viewport px) shows in the part of each nothing pinned over
 * its edges covers (see `uncoveredRect`), clipped to the uncovered part of the scroll containers
 * around it when the range fits there. A container whose uncovered part is shorter than the range
 * is left as it is.
 */
export function revealRange(element: Element, top: number, bottom: number): void {
  const page = element.ownerDocument.scrollingElement;
  for (
    let container: Element | null = element;
    container;
    container = parentAcrossShadow(container)
  ) {
    const isPage = container === page;
    if (isPage ? container.scrollHeight <= container.clientHeight : !scrollsVertically(container)) {
      continue;
    }
    // The page's rect is its whole content; what shows of it is the viewport
    const own = uncoveredRect(
      container,
      isPage
        ? new DOMRect(0, 0, container.clientWidth, container.clientHeight)
        : container.getBoundingClientRect(),
    );
    // Clear of what the scroll containers around it cover too (one that can't scroll would leave
    // it covered), unless too little of it shows there: those scroll it into view next
    const clipped = clipToScrollContainers(own, scrollAncestors(container));
    const shown = clipped && clipped.height >= bottom - top ? clipped : own;
    if (!shown || shown.height < bottom - top) {
      continue;
    }
    const delta =
      top < shown.top ? top - shown.top : bottom > shown.bottom ? bottom - shown.bottom : 0;
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
