import { isPlatformBrowser } from '@angular/common';
import { DOCUMENT, effect, inject, PLATFORM_ID } from '@angular/core';

const CURSOR_STYLE_ID = 'vdnd-cursor-styles';

/**
 * Show the grabbing cursor over lists and items while a drag runs: the body gets `vdnd-dragging`
 * (and `vdnd-dragging-touch` for a touch drag, which shows no cursor) and a style element, added
 * once, styles the lists and items under it. Call from `DragStateService`'s constructor, which
 * every drag creates. Nothing on the server.
 *
 * Takes getters, not the service's signals: a provider subclass can override `isDragging` with a
 * field, which it initializes only after the base constructor has run, so the effect must read
 * the property when it runs.
 * @internal
 */
export function bindDragCursor(isDragging: () => boolean, isTouchDrag: () => boolean): void {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return;
  }
  const document = inject(DOCUMENT);

  // The rules target lists and items only: a rule matching every element (`body.vdnd-dragging *`,
  // or a `*` anywhere right of the body class) restyles the whole document each time the body
  // class changes, at drag start and at drop. Touch drags show no cursor, so they skip it.
  if (!document.getElementById(CURSOR_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = CURSOR_STYLE_ID;
    style.textContent = `
          body.vdnd-dragging:not(.vdnd-dragging-touch) .vdnd-droppable,
          body.vdnd-dragging:not(.vdnd-dragging-touch) .vdnd-draggable {
            cursor: grabbing !important;
          }
        `;
    document.head.appendChild(style);
  }

  effect(() => {
    const dragging = isDragging();
    const classList = document.body.classList;
    classList.toggle('vdnd-dragging', dragging);
    classList.toggle('vdnd-dragging-touch', dragging && isTouchDrag());
  });
}
