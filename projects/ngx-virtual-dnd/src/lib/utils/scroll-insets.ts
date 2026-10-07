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
 * The part of a scroll container nothing pinned over its edges covers: its rect (`rect`, read
 * when not given) shrunk by its scroll insets. The rect itself when it has none. Empty (a
 * negative height) when the insets cover all of it.
 */
export function uncoveredRect(element: Element, rect = element.getBoundingClientRect()): DOMRect {
  const top = readScrollInset(element, 'top');
  const bottom = readScrollInset(element, 'bottom');
  if (top === 0 && bottom === 0) {
    return rect;
  }
  const uncoveredTop = rect.top + top;
  return new DOMRect(
    rect.left,
    uncoveredTop,
    rect.right - rect.left,
    rect.bottom - bottom - uncoveredTop,
  );
}

/** The overlap of two rects: empty (a negative width or height) when they don't overlap. */
export function intersectRects(a: DOMRect, b: DOMRect): DOMRect {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  return new DOMRect(
    left,
    top,
    Math.min(a.right, b.right) - left,
    Math.min(a.bottom, b.bottom) - top,
  );
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

/** `rect` clipped to the uncovered part of each of `containers`. `rect` itself without any. */
export function clipToScrollContainers(
  rect: DOMRect,
  containers: readonly Element[],
  read: RectReader = readRect,
): DOMRect {
  let clipped = rect;
  for (const container of containers) {
    clipped = intersectRects(clipped, uncoveredRect(container, read(container)));
  }
  return clipped;
}

/**
 * The part of `element` the space covered in it leaves: its rect (`rect`, read when not given)
 * minus its own scroll insets and those of a `vdnd-virtual-scroll` child (the droppable of
 * `vdnd-sortable-list` wraps the one that scrolls its rows). The rect itself without any.
 */
export function ownUncoveredRect(
  element: Element,
  rect?: DOMRect,
  read: RectReader = readRect,
): DOMRect {
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
 * covers it.
 */
export function visibleRect(
  element: Element,
  rect?: DOMRect,
  read: RectReader = readRect,
): DOMRect {
  return clipToScrollContainers(
    ownUncoveredRect(element, rect, read),
    scrollAncestors(element),
    read,
  );
}
