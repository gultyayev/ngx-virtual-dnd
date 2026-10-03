/**
 * Controls that take text or a choice from a press: it focuses them, opens them or places the
 * caret. `contenteditable="false"` (in any letter case) marks an element as not editable, so it
 * doesn't count.
 */
const TEXT_ENTRY_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false" i])';

/**
 * Elements inside a draggable that keep their own interaction: pressing one never starts a
 * pointer drag, and Space pressed on one never starts a keyboard drag.
 */
export const INTERACTIVE_ELEMENT_SELECTOR = `button, ${TEXT_ENTRY_SELECTOR}`;

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

/**
 * Whether a press on `draggable` must keep its default action instead of starting a pointer drag
 * because the draggable itself is a text field, a select or an editable element (a press focuses
 * it, opens it or places the caret). A `<button vdndDraggable>` is not one: it drags.
 */
export function isTextEntryControl(draggable: Element): boolean {
  return draggable.matches(TEXT_ENTRY_SELECTOR);
}

/**
 * The control (see `INTERACTIVE_ELEMENT_SELECTOR`) nested inside `draggable` that contains
 * `target`, or null. Neither the draggable itself nor a control around it counts, so a row inside
 * a `[contenteditable]` editor still drags.
 */
export function findNestedControl(target: Element, draggable: Element): Element | null {
  const control = target.closest(INTERACTIVE_ELEMENT_SELECTOR);
  return control !== null && control !== draggable && draggable.contains(control) ? control : null;
}

/**
 * The element matching `handleSelector` inside `draggable` (the draggable itself included) that
 * contains `target`, or null. An ancestor of the draggable that matches does not count, so it
 * can't turn the whole row into a handle.
 */
export function findDragHandle(
  target: Element,
  draggable: Element,
  handleSelector: string,
): Element | null {
  const handle = target.closest(handleSelector);
  return handle !== null && draggable.contains(handle) ? handle : null;
}
