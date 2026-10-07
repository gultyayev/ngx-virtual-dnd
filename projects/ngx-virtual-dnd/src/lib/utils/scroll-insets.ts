/**
 * The space (px) content pinned over a scroll container's top and bottom edges covers, such as a
 * sticky header or footer inside it. `vdndScrollable` marks its element with its
 * `scrollInsetTop` and `scrollInsetBottom` inputs while they are not 0.
 */
export const SCROLL_INSET_TOP_ATTR = 'data-scroll-inset-top';
export const SCROLL_INSET_BOTTOM_ATTR = 'data-scroll-inset-bottom';

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
