/**
 * Elements inside a draggable that keep their own interaction: pressing one never starts a
 * pointer drag, and Space pressed on one never starts a keyboard drag. Besides the native
 * controls, this covers `<summary>` and the ARIA widgets whose press or Space has a meaning of its
 * own. Links and composite widget items (options, tabs, menu items) are left out: rows are often
 * made of them, and must stay draggable.
 */
export const INTERACTIVE_ELEMENT_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'summary',
  '[contenteditable]',
  ...[
    'button',
    'checkbox',
    'combobox',
    'radio',
    'searchbox',
    'slider',
    'spinbutton',
    'switch',
    'textbox',
  ].map((role) => `[role~="${role}"]`),
].join(', ');

/** Class that excludes the exact element carrying it from starting a drag. */
export const NO_DRAG_CLASS = 'no-drag';

/**
 * Whether a press (pointer or key) comes from a control nested inside the draggable `host`: an
 * element matching INTERACTIVE_ELEMENT_SELECTOR between the event's target and the host. It
 * walks the event's composed path, so a control inside a web component's open shadow root counts
 * too. Neither the draggable itself nor anything around it counts, and neither does anything the
 * draggable renders in its own shadow tree. A control that is the drag handle doesn't count
 * either (pressing it picks the item up), nor one that a web component handle renders in its
 * shadow tree. Controls inside the handle's content do count, like controls anywhere else.
 *
 * The composed path only exists while the event is dispatched, so call this from a listener.
 */
export function isPressOnNestedControl(
  event: Event,
  host: Element,
  dragHandle: string | undefined,
): boolean {
  const elements = elementsInside(event, host);
  const control = elements.find((element) => element.matches(INTERACTIVE_ELEMENT_SELECTOR));
  if (control === undefined) {
    return false;
  }
  return !dragHandle || !isPartOfHandle(control, dragHandle, elements);
}

/**
 * The elements an event went through inside `host`, from its target up. The walk stops at the
 * host's own shadow tree: content slotted into it passes through it before reaching the host, and
 * that tree, with any web component rendered in it, belongs to the draggable itself.
 */
function elementsInside(event: Event, host: Element): Element[] {
  const path = event.composedPath();
  const hostIndex = path.indexOf(host);
  const elements: Element[] = [];
  for (const node of path.slice(0, Math.max(hostIndex, 0))) {
    if (!(node instanceof Element)) {
      continue;
    }
    if (isRenderedByShadowTreeOf(node, host)) {
      break;
    }
    elements.push(node);
  }
  return elements;
}

/**
 * Whether `control` is the drag handle, or part of a web component that is the handle (rendered
 * in its shadow tree, like the button of an ion-button). `elements` bounds the walk to the
 * draggable.
 */
function isPartOfHandle(control: Element, dragHandle: string, elements: Element[]): boolean {
  let element = control;
  while (!element.matches(dragHandle)) {
    const root = element.getRootNode();
    if (!(root instanceof ShadowRoot) || !elements.includes(root.host)) {
      return false;
    }
    element = root.host;
  }
  return true;
}

/** Whether `element` is in `host`'s shadow tree, or in a web component rendered there. */
function isRenderedByShadowTreeOf(element: Element, host: Element): boolean {
  const shadowRoot = host.shadowRoot;
  if (shadowRoot === null) {
    return false;
  }
  let root = element.getRootNode();
  while (root instanceof ShadowRoot) {
    if (root === shadowRoot) {
      return true;
    }
    root = root.host.getRootNode();
  }
  return false;
}
