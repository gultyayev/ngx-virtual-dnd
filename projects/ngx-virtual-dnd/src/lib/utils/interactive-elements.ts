/**
 * Editable elements. `contenteditable="false"` (in any letter case) marks an element as not
 * editable, so it doesn't count.
 */
const EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false" i])';

/**
 * Elements inside a draggable that keep their own interaction: pressing one never starts a
 * pointer drag, and Space pressed on one never starts a keyboard drag.
 */
export const INTERACTIVE_ELEMENT_SELECTOR = `button, input, textarea, select, ${EDITABLE_SELECTOR}`;

/**
 * Controls that a press focuses, opens, toggles or places the caret in: every control above but
 * buttons and the inputs that are buttons.
 */
const TEXT_ENTRY_SELECTOR =
  'input:not([type="button" i], [type="submit" i], [type="reset" i], [type="image" i]), ' +
  `textarea, select, ${EDITABLE_SELECTOR}`;

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
 * because the draggable itself is a text field, a select, a checkbox or an editable element (a
 * press focuses it, opens it, toggles it or places the caret). A `<button vdndDraggable>` or an
 * `<input type="button">` is not one: it drags.
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
