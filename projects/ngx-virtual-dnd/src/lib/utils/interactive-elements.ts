/**
 * Elements inside a draggable that keep their own interaction: pressing one never starts a
 * pointer drag, and Space pressed on one never starts a keyboard drag.
 */
export const INTERACTIVE_ELEMENT_SELECTOR = 'button, input, textarea, select, [contenteditable]';

/** Class that excludes the element carrying it, and everything inside it, from starting a drag. */
export const NO_DRAG_CLASS = 'no-drag';

/**
 * The `no-drag` element inside `draggable` (the draggable itself included) that contains
 * `target`, or null. A `no-drag` ancestor of the draggable does not count.
 */
export function findNoDragElement(target: Element, draggable: Element): Element | null {
  const noDrag = target.closest(`.${NO_DRAG_CLASS}`);
  return noDrag !== null && draggable.contains(noDrag) ? noDrag : null;
}
