/** `Node.DOCUMENT_POSITION_FOLLOWING`, without the `Node` global (servers have none) */
const DOCUMENT_POSITION_FOLLOWING = 4;

/**
 * The node that comes first in the DOM. A view's `rootNodes` list a control flow block's (or an
 * `<ng-container>`'s) anchor before the nodes rendered in it, which the DOM puts before the anchor.
 */
export function firstInDocumentOrder(nodes: Node[]): Node | null {
  let first: Node | null = null;
  for (const node of nodes) {
    if (first === null || node.compareDocumentPosition(first) & DOCUMENT_POSITION_FOLLOWING) {
      first = node;
    }
  }
  return first;
}

/**
 * Move a row's nodes (a view's `rootNodes`) in `parent` right before `before`, in their DOM order,
 * unless they are there already.
 *
 * Virtual lists reorder their rows with this instead of `ViewContainerRef.move()`, so a row's view
 * keeps its place in the `ViewContainerRef` and only the DOM order follows the items. `move()`
 * detaches the view, and Angular removes a detached element once its leave animation
 * (`animate.leave`) ends, even when the view is back in the container by then (only `@for`
 * cancels that). Insert a view before the next row with `insert(view, indexOf(next))`: Angular
 * puts its nodes before those of the view that follows it in the container.
 */
export function moveNodesBefore(nodes: Node[], parent: Node, before: Node): void {
  const inParent = nodes.filter((node) => node.parentNode === parent);
  if (inParent.length === 0) return;
  if (inParent.length > 1) {
    inParent.sort((a, b) => (a.compareDocumentPosition(b) & DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }
  if (inParent[inParent.length - 1].nextSibling === before) return;
  for (const node of inParent) {
    parent.insertBefore(node, before);
  }
}

/**
 * Which values belong to a longest increasing subsequence of `values` (negative values never
 * do). For rows: the ones that can stay where they are while the others move around them, as
 * few as possible. A moved row loses focus and restarts its CSS transitions.
 */
export function longestIncreasingRun(values: number[]): boolean[] {
  // tails[k]: the index of the smallest value that ends an increasing run of length k + 1
  const tails: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value < 0) continue;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]] < value) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    previous[i] = low > 0 ? tails[low - 1] : -1;
    tails[low] = i;
  }

  const inRun = new Array<boolean>(values.length).fill(false);
  for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i >= 0; i = previous[i]) {
    inRun[i] = true;
  }
  return inRun;
}
