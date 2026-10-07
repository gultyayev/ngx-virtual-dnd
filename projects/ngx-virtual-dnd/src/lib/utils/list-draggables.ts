/**
 * The draggables of a list in page order: its descendants carrying `data-draggable-id`, however
 * deeply each is wrapped (row markup, a component rendering the draggable inside its host), but
 * not those of a list nested inside it.
 */
export function listDraggables(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>('[data-draggable-id]')).filter(
    (draggable) => draggable.parentElement?.closest('[data-droppable-id]') === list,
  );
}
