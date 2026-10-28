import { EmbeddedViewRef, isDevMode, TemplateRef, ViewContainerRef } from '@angular/core';
import type { DraggedItem } from '../models/drag-drop.models';
import type { VirtualScrollItemContext } from '../components/virtual-scroll-container.component';
import type { ShiftAnimator } from '../utils/shift-animator';
import { revealDropTargetIn } from '../utils/drop-animator';

/** An entry of the rendered list: an item's row, or the placeholder. */
export interface RenderedEntry<T> {
  type: 'item' | 'placeholder';
  data: T | null;
  index: number;
  isSticky: boolean;
  isDragging: boolean;
}

/** A rendered row: the item template's view and the track key it was created for. */
export interface RowView<T> {
  key: unknown;
  view: EmbeddedViewRef<VirtualScrollItemContext<T>>;
}

/** What the renderer asks of the `vdnd-virtual-scroll` that owns it. */
export interface ComponentRowRendererHost<T> {
  /** The track key of an item (the component's `trackEntry`, which a subclass can override) */
  trackItem(index: number, item: T): unknown;
  /** The item's ID (`itemIdFn`) */
  itemId(item: T): string;
  /** The item being dragged, if any */
  draggedItem(): DraggedItem | null;
  /** Slides displaced rows; a pooled row's animation is cancelled */
  readonly shiftAnimator: ShiftAnimator | null;
}

/**
 * How many views of rows that left a list stay pooled for rows that come in (recycleRows). A
 * scroll step reuses the views it pools right away; the pool keeps the rest, for example when
 * fewer rows render after the list shrinks.
 */
const MAX_POOLED_ROWS = 10;

/** `Node.DOCUMENT_POSITION_FOLLOWING`, without the `Node` global (servers have none) */
const DOCUMENT_POSITION_FOLLOWING = 4;

/**
 * The node that comes first in the DOM. A view's `rootNodes` list a control flow block's anchor
 * before the nodes rendered in it, which the DOM puts before the anchor.
 */
function firstInDocumentOrder(nodes: Node[]): Node | null {
  let first: Node | null = null;
  for (const node of nodes) {
    if (first === null || node.compareDocumentPosition(first) & DOCUMENT_POSITION_FOLLOWING) {
      first = node;
    }
  }
  return first;
}

/**
 * Which values belong to a longest increasing subsequence of `values` (negative values never
 * do). For rows: the views that can stay where they are while the others move around them, as
 * few as possible. A moved row loses focus and restarts its CSS transitions.
 */
function longestIncreasingRun(values: number[]): boolean[] {
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

/**
 * The rows of a `vdnd-virtual-scroll`: a view of the item template per rendered entry, keyed by
 * track key. Its rules:
 * - Identity: a row keeps its view (and the components in it) while its track key stays
 *   rendered, as with `@for`. A new template renders every row anew; a new track function gives
 *   the rendered rows new keys, and they keep their views.
 * - Duplicate keys: every entry renders, a view each (an entry takes the first view left for its
 *   key), with a dev-mode warning: drag and drop needs unique IDs.
 * - Order: only the rows out of order move, around a longest increasing run that stays in place.
 * - Checks: only new, pooled and changed rows are checked, with `detectChanges()`, and none
 *   while the owner's own view is about to be checked (that check renders every row). A pooled
 *   view is checked before it goes back in the outlet (see `render`).
 * - Recycling (opt-in): a row that leaves is destroyed, or pooled for a row that comes in. Never
 *   the dragged item's (destroying it cancels the drag) or one a leave animation keeps in the DOM.
 */
export class ComponentRowRenderer<T> {
  readonly #host: ComponentRowRendererHost<T>;

  /** Rendered rows, in DOM order */
  #rows: RowView<T>[] = [];

  /** The entries the rendered rows show */
  #rowEntries: RenderedEntry<T>[] | null = null;

  /** The template the rendered rows were created from */
  #rowTemplate: TemplateRef<VirtualScrollItemContext<T>> | null = null;

  /** The track function that gave the rendered rows their keys */
  #rowTrackBy: unknown = null;

  /** Views of rows that left, detached, to render rows that come in (recycleRows) */
  #rowPool: EmbeddedViewRef<VirtualScrollItemContext<T>>[] = [];

  /** Whether duplicate track keys were reported (once per list) */
  #warnedDuplicateKeys = false;

  /** The row keys last checked for duplicates (checked again when the rows change) */
  #rowKeysChecked: unknown[] | null = null;

  constructor(host: ComponentRowRendererHost<T>) {
    this.#host = host;
  }

  /** Rendered rows, in DOM order */
  get rows(): readonly RowView<T>[] {
    return this.#rows;
  }

  /**
   * Give each entry a view of the item template, in order. As with `@for`, a row keeps its view
   * (and the components in it) while its track key stays rendered, and only the rows out of order
   * move. The view of a row that leaves is destroyed, or with `recycle` pooled and given to a row
   * that comes in. Only new, pooled and changed views are checked, with `detectChanges()`:
   * `markForCheck()` would mark every ancestor view up to the root too. None is checked while
   * `viewCheckPending`: the owner's own view is checked later in this pass, and that renders every
   * row.
   *
   * A pooled view is checked before it goes back in the outlet. Angular tracks the signals a row
   * checked on its own reads with a consumer that refreshes the component view the row is in
   * (the owner's, which checks every row) as soon as one of them is notified, without checking
   * whether its value changed. A pooled view's check notifies some itself: its directives get the
   * new item, and their host bindings read values computed from it (as `vdndDraggable`'s
   * `isDragging()`). Out of the outlet the view is in no other view, so that refreshes nothing.
   * What its check throws is rethrown once every row is in place.
   */
  render(
    outlet: ViewContainerRef,
    template: TemplateRef<VirtualScrollItemContext<T>> | null,
    entries: RenderedEntry<T>[],
    keys: unknown[],
    trackBy: unknown,
    recycle: boolean,
    viewCheckPending: boolean,
  ): void {
    if (!recycle) {
      this.destroyPool();
    }

    // Nothing to do, as on a placeholder move
    if (
      entries === this.#rowEntries &&
      template === this.#rowTemplate &&
      trackBy === this.#rowTrackBy
    ) {
      return;
    }

    // A new template renders every row anew; without one there is no row (as ngTemplateOutlet)
    if (template !== this.#rowTemplate) {
      for (const row of this.#rows) {
        row.view.destroy();
      }
      this.#rows = [];
      this.destroyPool();
      this.#rowTemplate = template;
    }
    if (!template) return;

    // A new track function gives the rendered rows new keys; they keep their views (as with @for)
    if (trackBy !== this.#rowTrackBy) {
      for (const row of this.#rows) {
        const { $implicit, index } = row.view.context;
        row.key = this.#host.trackItem(index, $implicit);
      }
      this.#rowTrackBy = trackBy;
    }

    // The last render's views by key, in order: an entry takes the first view left for its key
    const previous = new Map<unknown, RowView<T>[]>();
    for (const row of this.#rows) {
      if (row.view.destroyed) continue;
      const views = previous.get(row.key);
      if (views) {
        views.push(row);
      } else {
        previous.set(row.key, [row]);
      }
    }
    const kept = keys.map((key) => previous.get(key)?.shift());
    this.#warnDuplicateKeys(keys);

    // Remove the rows that left, then keep in place the longest run of kept views that is
    // already in order (their positions in the outlet, which now holds only kept views)
    const dragged = this.#host.draggedItem();
    for (const views of previous.values()) {
      for (const row of views) {
        // The dragged item's view is destroyed, as without recycling: that cancels the drag
        // instead of handing it to another item
        if (recycle && !this.#rendersDraggedItem(row.view, dragged)) {
          this.#poolRow(outlet, row.view);
        } else {
          row.view.destroy();
        }
      }
    }
    const positions = new Map<unknown, number>();
    for (let i = 0; i < outlet.length; i++) {
      positions.set(outlet.get(i), i);
    }
    const inPlace = longestIncreasingRun(kept.map((row) => (row ? positions.get(row.view)! : -1)));

    // From the first row down, so each row goes right after the previous one, already in place.
    // Top down because hydration gives each view the outlet creates the first server-rendered
    // row left: created bottom up, the last row would take the first one's nodes.
    const rows: RowView<T>[] = new Array(entries.length);
    const toCheck: EmbeddedViewRef<VirtualScrollItemContext<T>>[] = [];
    let pooledViewError: { error: unknown } | null = null;
    let previousView: EmbeddedViewRef<VirtualScrollItemContext<T>> | null = null;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      let row = kept[i];
      if (row) {
        if (!inPlace[i]) {
          this.#moveAfter(outlet, row.view, previousView);
        }
        if (this.#updateContext(row.view.context, entry)) {
          toCheck.push(row.view);
        }
      } else {
        const index: number = previousView ? outlet.indexOf(previousView) + 1 : 0;
        // A pooled view is checked whatever its context (nothing checked it while detached), and
        // before it goes back in the outlet (see above)
        let view = this.#rowPool.pop();
        if (view) {
          this.#updateContext(view.context, entry);
          if (!viewCheckPending) {
            try {
              view.detectChanges();
            } catch (error) {
              pooledViewError ??= { error };
            }
          }
          outlet.insert(view, index);
        } else {
          const context: VirtualScrollItemContext<T> = {
            $implicit: entry.data as T,
            index: entry.index,
            isSticky: entry.isSticky,
          };
          view = outlet.createEmbeddedView(template, context, index);
          toCheck.push(view);
        }
        row = { key: keys[i], view };
      }
      rows[i] = row;
      previousView = row.view;
    }
    this.#rows = rows;
    while (this.#rowPool.length > MAX_POOLED_ROWS) {
      this.#rowPool.pop()!.destroy();
    }

    // When the owner's own view is checked later in this pass, that check renders every row
    if (!viewCheckPending) {
      // The new and changed rows, top to bottom (the pooled ones were checked above)
      for (const view of toCheck) {
        view.detectChanges();
      }
    }
    this.#rowEntries = entries;

    // Thrown only now, so the rows and the outlet stay in step for the next render
    if (pooledViewError) {
      throw pooledViewError.error;
    }
  }

  /** The first node in `parent` of the rows from `index` on (null when none has one). */
  firstNodeOfRows(index: number, parent: Node): Node | null {
    for (let i = index; i < this.#rows.length; i++) {
      const nodes = this.#rows[i].view.rootNodes.filter((node) => node.parentNode === parent);
      const node = firstInDocumentOrder(nodes);
      if (node) return node;
    }
    return null;
  }

  /** Destroy the pooled views: they are detached, so not destroyed with the outlet. */
  destroyPool(): void {
    for (const view of this.#rowPool) {
      view.destroy();
    }
    this.#rowPool = [];
  }

  /**
   * Whether a row's view renders the dragged item: its item has the dragged ID, or the view holds
   * the dragged element (its draggable ID need not be the item's ID).
   */
  #rendersDraggedItem(
    view: EmbeddedViewRef<VirtualScrollItemContext<T>>,
    dragged: DraggedItem | null,
  ): boolean {
    if (!dragged) return false;
    return (
      this.#host.itemId(view.context.$implicit) === dragged.draggableId ||
      view.rootNodes.some((node: Node) => node.contains(dragged.element))
    );
  }

  /**
   * Take a row's view out of the outlet and pool it. It keeps its element, so its shift
   * animation is cancelled (the item it renders next must not slide from this one's position),
   * and a drop animation that hides it shows it again.
   */
  #poolRow(outlet: ViewContainerRef, view: EmbeddedViewRef<VirtualScrollItemContext<T>>): void {
    outlet.detach(outlet.indexOf(view));
    const nodes = view.rootNodes;
    // A leave animation (`animate.leave`) keeps the row in the DOM, and Angular removes it when
    // the animation ends: in the row of another item by then, if the view were reused
    if (nodes.some((node) => node.parentNode !== null)) {
      view.destroy();
      return;
    }
    for (const node of nodes) {
      if (node instanceof HTMLElement) {
        this.#host.shiftAnimator?.cancel(node);
      }
    }
    revealDropTargetIn(nodes);
    this.#rowPool.push(view);
  }

  /** Move a row's view right after `previous` (first without one), unless it is there already. */
  #moveAfter(
    outlet: ViewContainerRef,
    view: EmbeddedViewRef<VirtualScrollItemContext<T>>,
    previous: EmbeddedViewRef<VirtualScrollItemContext<T>> | null,
  ): void {
    const target = previous ? outlet.indexOf(previous) + 1 : 0;
    const current = outlet.indexOf(view);
    if (current === target) return;
    // move() takes the view out before inserting it, which shifts the views after it
    outlet.move(view, current < target ? target - 1 : target);
  }

  /** Copy an entry into a row's context. Returns whether the context changed. */
  #updateContext(context: VirtualScrollItemContext<T>, entry: RenderedEntry<T>): boolean {
    if (
      Object.is(context.$implicit, entry.data) &&
      context.index === entry.index &&
      context.isSticky === entry.isSticky
    ) {
      return false;
    }
    context.$implicit = entry.data as T;
    context.index = entry.index;
    context.isSticky = entry.isSticky;
    return true;
  }

  /** Items sharing a track key still render (a view each), but drag and drop needs unique IDs. */
  #warnDuplicateKeys(keys: unknown[]): void {
    if (this.#warnedDuplicateKeys || keys === this.#rowKeysChecked || !isDevMode()) return;
    this.#rowKeysChecked = keys;
    const seen = new Set<unknown>();
    for (const key of keys) {
      if (seen.has(key)) {
        this.#warnedDuplicateKeys = true;
        console.warn(
          `[ngx-virtual-dnd] vdnd-virtual-scroll rendered two items with the track key ` +
            `${String(key)}. Give every item a unique ID (itemIdFn, or trackByFn).`,
        );
        return;
      }
      seen.add(key);
    }
  }
}
