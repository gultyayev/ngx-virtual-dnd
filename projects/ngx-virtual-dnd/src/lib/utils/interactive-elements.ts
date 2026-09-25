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
 * too. Neither the draggable itself (its own shadow tree included) nor anything around it counts,
 * and neither does a control inside the drag handle: pressing one picks the item up.
 *
 * The composed path only exists while the event is dispatched, so call this from a listener.
 */
export function isPressOnNestedControl(
  event: Event,
  host: Element,
  dragHandle: string | undefined,
): boolean {
  const elements = elementsInside(event, host);
  const controlIndex = elements.findIndex((element) =>
    element.matches(INTERACTIVE_ELEMENT_SELECTOR),
  );
  if (controlIndex === -1) {
    return false;
  }
  return (
    !dragHandle || !elements.slice(controlIndex).some((element) => element.matches(dragHandle))
  );
}

/**
 * The elements an event went through inside `host`, from its target up. Content slotted into the
 * host's own shadow tree passes through that tree before reaching the host; that part belongs to
 * the draggable itself, so the walk stops there too.
 */
function elementsInside(event: Event, host: Element): Element[] {
  const path = event.composedPath();
  const hostIndex = path.indexOf(host);
  const ownShadowRoot = host.shadowRoot;
  const elements: Element[] = [];
  for (const node of path.slice(0, Math.max(hostIndex, 0))) {
    if (ownShadowRoot !== null && node instanceof Node && node.getRootNode() === ownShadowRoot) {
      break;
    }
    if (node instanceof Element) {
      elements.push(node);
    }
  }
  return elements;
}
