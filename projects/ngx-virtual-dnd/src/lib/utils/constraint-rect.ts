import { closestAcrossShadow } from './composed-dom';
import { visibleRect } from './scroll-insets';

/**
 * The element a constrained drag over `droppable` stays in: the `vdndScrollable` around it (or
 * itself), whose rect is the part of the page its rows scroll in, or else the droppable itself
 * (whose rect a virtual list may stretch far beyond what shows).
 */
export function constraintElementOf(droppable: HTMLElement): HTMLElement {
  return closestAcrossShadow<HTMLElement>(droppable, '.vdnd-scrollable') ?? droppable;
}

/**
 * The rect a constrained drag stays in: the part of `element` (see `constraintElementOf`) that
 * shows. When nothing of it shows (scrolled out of view, or all behind sticky content), the whole
 * element, as without scroll insets: autoscroll at its edge brings it back into view.
 */
export function constraintRectOf(element: HTMLElement): DOMRect {
  return visibleRect(element) ?? element.getBoundingClientRect();
}
