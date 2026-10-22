import type { NgZone } from '@angular/core';
import type { DraggedItem } from '../models/drag-drop.models';
import type { DragStateService } from '../services/drag-state.service';
import { createDragEndEvent, type DragEndArgs, endDragInZone } from './drag-end';

describe('drag end', () => {
  // [A, B, C, D] in 'list', B (source 1) dragged; the placeholder is at the end of 'list'
  const dragState = (activeDroppableId: string | null = 'list') =>
    ({
      sourceIndex: () => 1,
      sourceDroppableId: () => 'list',
      activeDroppableId: () => activeDroppableId,
      placeholderIndex: () => (activeDroppableId === null ? null : 4),
    }) as unknown as DragStateService;

  const pickedUp = { draggableId: 'b', data: { name: 'B' } } as DraggedItem;

  const args = (overrides: Partial<DragEndArgs> = {}): DragEndArgs => ({
    pickedUp,
    live: { draggableId: 'b', data: { name: 'B, renamed' } },
    parentDroppableId: () => 'list-in-dom',
    cancelled: false,
    hasTarget: true,
    ...overrides,
  });

  describe('createDragEndEvent', () => {
    it("reports a drop's insertion index and the draggable's live data", () => {
      expect(createDragEndEvent(dragState(), args())).toEqual({
        draggableId: 'b',
        droppableId: 'list',
        cancelled: false,
        data: { name: 'B, renamed' },
        sourceIndex: 1,
        destinationIndex: 3,
      });
    });

    it('reports the item it picked up once the draggable renders another one', () => {
      const event = createDragEndEvent(
        dragState(),
        args({ live: { draggableId: 'x', data: { name: 'X' } } }),
      );

      expect(event.draggableId).toBe('b');
      expect(event.data).toBe(pickedUp.data);
    });

    it('reports no destination for a cancelled drag', () => {
      expect(createDragEndEvent(dragState(), args({ cancelled: true })).destinationIndex).toBe(
        null,
      );
    });

    it('reports no destination without a target that takes the drop', () => {
      expect(createDragEndEvent(dragState(), args({ hasTarget: false })).destinationIndex).toBe(
        null,
      );
    });

    it('reports the list from the DOM only when the drag state has none', () => {
      const noSource = {
        ...dragState(),
        sourceDroppableId: () => '',
      } as unknown as DragStateService;

      expect(createDragEndEvent(dragState(), args()).droppableId).toBe('list');
      expect(createDragEndEvent(noSource, args()).droppableId).toBe('list-in-dom');
    });
  });

  describe('endDragInZone', () => {
    it('emits dragEnd, ends the drag state, then runs the rest, in one zone entry', () => {
      const calls: string[] = [];
      const ngZone = {
        run: (fn: () => void) => {
          calls.push('enter');
          fn();
          calls.push('leave');
        },
      } as unknown as NgZone;

      endDragInZone(
        ngZone,
        () => calls.push('dragEnd'),
        () => calls.push('end state'),
        () => calls.push('after'),
      );

      expect(calls).toEqual(['enter', 'dragEnd', 'end state', 'after', 'leave']);
    });
  });
});
