/**
 * The draggables of a list in page order: its descendants carrying `data-draggable-id`, however
 * deeply each is wrapped (row markup, a component rendering the draggable inside its host), but
 * not those of a list nested inside it.
 */
export function listDraggables(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>('[data-draggable-id]')).filter(
    // A row is most often the list's child: no walk up for it (a drag counts rows every frame)
    (draggable) =>
      draggable.parentElement === list ||
      draggable.parentElement?.closest('[data-droppable-id]') === list,
  );
}

/**
 * The `vdnd-virtual-scroll` that scrolls a list's rows: the first one inside it, however deeply
 * wrapped (layout markup around it, the droppable of `vdnd-sortable-list`), that is not a list
 * nested inside it, nor in one, nor in one of its rows. Null when it has none, and for an
 * element that is no list (no `data-droppable-id`).
 */
export function listVirtualScroll(list: Element): HTMLElement | null {
  for (const scroller of Array.from(list.querySelectorAll<HTMLElement>('vdnd-virtual-scroll'))) {
    if (scroller.closest('[data-droppable-id], [data-draggable-id]') === list) {
      return scroller;
    }
  }
  return null;
}
