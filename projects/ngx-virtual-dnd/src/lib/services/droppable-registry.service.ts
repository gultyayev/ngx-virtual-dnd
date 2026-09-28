import { Injectable } from '@angular/core';
import { DragState } from '../models/drag-drop.models';

/**
 * Receives the ended drag state when a drag is dropped on the droppable. Returns whether it
 * took the drop (false when it declines, e.g. because it is disabled).
 */
export type DropHandler = (endedState: DragState) => boolean;

interface DroppableRegistration {
  readonly element: HTMLElement;
  readonly id: string;
  readonly group: string;
  readonly onDrop: DropHandler | null;
}

/**
 * Registry of the rendered droppables, keyed by group and by ID.
 *
 * `DroppableDirective` registers its element once rendered and unregisters on destroy, so drag
 * code reads the droppables of one group instead of querying the whole document for
 * `data-droppable-*` attributes. That keeps lookups proportional to the group, not the page,
 * and finds droppables a document query cannot reach (inside shadow roots). It also delivers
 * a drop to its target the moment the drag ends (`DragStateService.endDrag`).
 * @internal
 */
@Injectable({
  providedIn: 'root',
})
export class DroppableRegistryService {
  readonly #byGroup = new Map<string, DroppableRegistration[]>();

  readonly #byId = new Map<string, DroppableRegistration[]>();

  readonly #listeners = new Set<(group: string) => void>();

  /**
   * Register a droppable, with the handler that receives drops on it. Returns the function
   * that unregisters it; calling that more than once is a no-op.
   */
  register(
    element: HTMLElement,
    id: string,
    group: string,
    onDrop: DropHandler | null = null,
  ): () => void {
    const registration: DroppableRegistration = { element, id, group, onDrop };

    this.#add(this.#byGroup, group, registration);
    if (id) {
      this.#add(this.#byId, id, registration);
    }
    this.#notify(group);

    let registered = true;
    return () => {
      if (!registered) {
        return;
      }
      registered = false;
      this.#remove(this.#byGroup, group, registration);
      if (id) {
        this.#remove(this.#byId, id, registration);
      }
      this.#notify(group);
    };
  }

  /**
   * The group's droppables that are in the document, in document order (the order they are
   * painted in, which hit-testing relies on). Returns a new array.
   *
   * Sorted on every call rather than cached: a list moved in the DOM keeps its registration.
   * Callers read it at drag start and on candidate changes, not per frame.
   */
  getGroup(group: string): HTMLElement[] {
    const registrations = this.#byGroup.get(group);
    if (!registrations) {
      return [];
    }

    const elements: HTMLElement[] = [];
    for (const { element } of registrations) {
      if (element.isConnected) {
        elements.push(element);
      }
    }
    return elements.sort(compareElements);
  }

  /**
   * The droppable with this ID that is in the document, or null. If a re-render briefly
   * leaves two with the same ID, returns the first in document order.
   */
  getById(id: string): HTMLElement | null {
    return this.#firstById(id)?.element ?? null;
  }

  /**
   * Hand an ended drag to the drop handler of its target (`activeDroppableId`), so a drop
   * reaches exactly one droppable. IDs should be unique; if several connected droppables share
   * it (briefly, while re-rendering), those in the source list's group come first, then
   * document order, and the first that takes the drop gets it. Does nothing when the drag had
   * no target or item, or the target is no longer registered.
   */
  deliverDrop(endedState: DragState): void {
    const targetId = endedState.activeDroppableId;
    const registrations = targetId ? this.#byId.get(targetId) : undefined;
    if (!registrations || !endedState.draggedItem) {
      return;
    }

    const sourceId = endedState.sourceDroppableId;
    const dragGroup = sourceId ? this.#firstById(sourceId)?.group : undefined;
    const candidates = registrations
      .filter((registration) => registration.onDrop && registration.element.isConnected)
      .sort(
        (a, b) =>
          Number(b.group === dragGroup) - Number(a.group === dragGroup) ||
          compareElements(a.element, b.element),
      );

    for (const { onDrop } of candidates) {
      if (onDrop?.(endedState)) {
        return;
      }
    }
  }

  /**
   * Call `listener` with the group whenever a droppable of that group registers or
   * unregisters. Returns the function that removes the listener.
   */
  onChange(listener: (group: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The registration with this ID that is in the document and first in document order. */
  #firstById(id: string): DroppableRegistration | null {
    const registrations = this.#byId.get(id);
    if (!registrations) {
      return null;
    }

    let match: DroppableRegistration | null = null;
    for (const registration of registrations) {
      if (
        registration.element.isConnected &&
        (!match || compareElements(registration.element, match.element) < 0)
      ) {
        match = registration;
      }
    }
    return match;
  }

  #add(
    map: Map<string, DroppableRegistration[]>,
    key: string,
    registration: DroppableRegistration,
  ): void {
    const list = map.get(key);
    if (list) {
      list.push(registration);
    } else {
      map.set(key, [registration]);
    }
  }

  #remove(
    map: Map<string, DroppableRegistration[]>,
    key: string,
    registration: DroppableRegistration,
  ): void {
    const list = map.get(key);
    const index = list?.indexOf(registration) ?? -1;
    if (!list || index === -1) {
      return;
    }
    list.splice(index, 1);
    if (list.length === 0) {
      map.delete(key);
    }
  }

  #notify(group: string): void {
    for (const listener of this.#listeners) {
      listener(group);
    }
  }
}

/**
 * Negative when `a` comes before `b` in the document (an ancestor comes before its
 * descendants). Across shadow roots the order is stable but implementation-defined.
 */
function compareElements(a: Node, b: Node): number {
  if (a === b) {
    return 0;
  }
  const position = a.compareDocumentPosition(b);
  return position & Node.DOCUMENT_POSITION_FOLLOWING ||
    position & Node.DOCUMENT_POSITION_CONTAINED_BY
    ? -1
    : 1;
}
