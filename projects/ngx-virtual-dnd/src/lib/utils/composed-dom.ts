/**
 * DOM walks that cross open shadow-root boundaries.
 *
 * `Element.closest()`, `parentElement` and `compareDocumentPosition()` stop at a shadow root (or,
 * for the latter, treat its tree as disconnected from the page). These helpers continue from a
 * shadow root to its host, so lists and items rendered inside open shadow roots (for example in a
 * component with `ViewEncapsulation.ShadowDom`) are found like any other. Only
 * `elementFromPointAcrossShadow` looks into a shadow root from outside, and only into open ones.
 */

/** The host of the shadow root `node` belongs to, or null when it is not in a shadow tree. */
export function shadowHostOf(node: Node): Element | null {
  const root = node.getRootNode();
  return typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? root.host : null;
}

/**
 * Like `element.closest(selector)`, but when nothing matches inside a shadow root the search
 * continues from its host, up to the page.
 */
export function closestAcrossShadow<T extends Element = Element>(
  element: Element,
  selector: string,
): T | null {
  for (let current: Element | null = element; current; current = shadowHostOf(current)) {
    const match = current.closest<T>(selector);
    if (match) {
      return match;
    }
  }
  return null;
}

/** The parent element of `element`, or its shadow host when it is at the top of a shadow tree. */
export function parentAcrossShadow(element: Element): Element | null {
  return element.parentElement ?? shadowHostOf(element);
}

/**
 * The innermost element at a viewport point, looking into open shadow roots:
 * `document.elementFromPoint()` returns the host of a shadow tree, not the element inside it.
 */
export function elementFromPointAcrossShadow(x: number, y: number): Element | null {
  let element = document.elementFromPoint(x, y);
  // Stop at an element already visited, so shadow roots whose hit-tests point back at each
  // other cannot loop
  const visited = new Set<Element>();
  // A shadow root may lack `elementFromPoint` in environments without layout (jsdom)
  while (element?.shadowRoot && typeof element.shadowRoot.elementFromPoint === 'function') {
    visited.add(element);
    const inner = element.shadowRoot.elementFromPoint(x, y);
    if (!inner || visited.has(inner)) {
      break;
    }
    element = inner;
  }
  return element;
}

/** The number of ancestors of `element`, counting shadow hosts as ancestors of their shadow tree. */
export function depthAcrossShadow(element: Element): number {
  let depth = 0;
  for (let parent = parentAcrossShadow(element); parent; parent = parentAcrossShadow(parent)) {
    depth++;
  }
  return depth;
}

/** `node` followed by the host of each shadow tree it is nested in, innermost first. */
function hostChain(node: Node): Node[] {
  const chain = [node];
  for (let host = shadowHostOf(node); host; host = shadowHostOf(host)) {
    chain.push(host);
  }
  return chain;
}

/**
 * Negative when `a` comes before `b` in the page, positive when after (an ancestor, or the host
 * of a shadow tree, comes before what it contains). The elements of a shadow tree come right
 * after its host, before the host's own children. Nodes in unrelated trees (one not in the page)
 * get a stable but implementation-defined order.
 */
export function compareAcrossShadow(a: Node, b: Node): number {
  if (a === b) {
    return 0;
  }
  const chainA = hostChain(a);
  const chainB = hostChain(b);
  // The first pair in one tree is in their innermost common tree (each chain climbs one tree
  // per step)
  for (let i = 0; i < chainA.length; i++) {
    const root = chainA[i].getRootNode();
    for (const nodeB of chainB) {
      if (nodeB.getRootNode() !== root) {
        continue;
      }
      if (chainA[i] === nodeB) {
        // One is the host of a shadow tree the other is in: the host comes first
        return i === 0 ? -1 : 1;
      }
      return compareInTree(chainA[i], nodeB);
    }
  }
  return compareInTree(a, b);
}

/** `compareDocumentPosition` as a sort comparator, for two distinct nodes. */
function compareInTree(a: Node, b: Node): number {
  const position = a.compareDocumentPosition(b);
  return position & Node.DOCUMENT_POSITION_FOLLOWING ||
    position & Node.DOCUMENT_POSITION_CONTAINED_BY
    ? -1
    : 1;
}
