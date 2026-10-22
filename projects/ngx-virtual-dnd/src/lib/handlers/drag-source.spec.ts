import {
  createDraggedItem,
  createDragStartEvent,
  type DragSourceDeps,
  measureDragSource,
} from './drag-source';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';

describe('drag source', () => {
  const rectAt = (top: number, height = 40): DOMRect =>
    ({ top, left: 10, height, width: 200, bottom: top + height, right: 210 }) as DOMRect;

  let list: HTMLElement;
  let rows: HTMLElement[];
  let strategy: VirtualScrollStrategy | undefined;
  let isVirtual: boolean;
  let hasTemplatePreview: boolean;
  let clone: HTMLElement;
  let deps: DragSourceDeps;

  beforeEach(() => {
    list = document.createElement('div');
    list.setAttribute('data-droppable-id', 'list');
    rows = ['a', 'b', 'c'].map((id, index) => {
      const row = document.createElement('div');
      row.setAttribute('data-draggable-id', id);
      row.getBoundingClientRect = () => rectAt(100 + index * 40);
      list.appendChild(row);
      return row;
    });
    strategy = undefined;
    isVirtual = false;
    hasTemplatePreview = false;
    clone = document.createElement('div');

    deps = {
      positionCalculator: {
        getDroppableParent: (element: HTMLElement) =>
          element.closest<HTMLElement>('[data-droppable-id]'),
        getDroppableId: (element: HTMLElement) => element.getAttribute('data-droppable-id'),
      },
      dragIndexCalculator: {
        // The list's rows start at 100 and it is scrolled by 400
        getScrollGeometry: () => ({ rect: rectAt(100, 120), scrollTop: 400, isVirtual }),
        getStrategyForDroppable: () => strategy,
      },
      elementClone: { cloneElement: () => clone },
      overlayContainer: { hasTemplatePreview: () => hasTemplatePreview },
    } as unknown as DragSourceDeps;
  });

  describe('measureDragSource', () => {
    it("finds the item's list and its index among the list's rows", () => {
      const source = measureDragSource(deps, rows[2], 'group');

      expect(source.droppableElement).toBe(list);
      expect(source.droppableId).toBe('list');
      expect(source.sourceIndex).toBe(2);
      expect(source.rect.top).toBe(180);
    });

    it("asks the list's strategy at the item's row offset", () => {
      const findIndexAtOffset = jest.fn().mockReturnValue(11);
      strategy = { findIndexAtOffset } as unknown as VirtualScrollStrategy;

      const source = measureDragSource(deps, rows[1], 'group');

      // Row top 140, list top 100, scrolled by 400
      expect(findIndexAtOffset).toHaveBeenCalledWith(440);
      expect(source.sourceIndex).toBe(11);
    });

    it('divides the row offset by the item height in a virtual list without a strategy', () => {
      isVirtual = true;

      // (140 - 100 + 400) / 40
      expect(measureDragSource(deps, rows[1], 'group').sourceIndex).toBe(11);
    });

    it('starts from index 0 and no list for an item outside any list', () => {
      const loose = document.createElement('div');
      loose.getBoundingClientRect = () => rectAt(0);

      const source = measureDragSource(deps, loose, 'group');

      expect(source.droppableElement).toBeNull();
      expect(source.droppableId).toBeNull();
      expect(source.sourceIndex).toBe(0);
    });
  });

  describe('createDraggedItem', () => {
    const context = () => ({ element: rows[0], draggableId: 'a', data: { name: 'A' } });

    it('records the item with its size, list, data and preview clone', () => {
      const item = createDraggedItem(deps, context(), measureDragSource(deps, rows[0], 'group'));

      expect(item).toEqual({
        draggableId: 'a',
        droppableId: 'list',
        element: rows[0],
        clonedElement: clone,
        height: 40,
        width: 200,
        data: { name: 'A' },
      });
    });

    it('clones nothing when a template preview renders the drag', () => {
      hasTemplatePreview = true;
      const cloneElement = jest.spyOn(deps.elementClone, 'cloneElement');

      const item = createDraggedItem(deps, context(), measureDragSource(deps, rows[0], 'group'));

      expect(item.clonedElement).toBeUndefined();
      expect(cloneElement).not.toHaveBeenCalled();
    });

    it('records an empty list ID for an item outside any list, as dragStart reports it', () => {
      const loose = document.createElement('div');
      loose.getBoundingClientRect = () => rectAt(0);
      const source = measureDragSource(deps, loose, 'group');

      const item = createDraggedItem(deps, { element: loose, draggableId: 'x', data: 1 }, source);

      expect(item.droppableId).toBe('');
      expect(createDragStartEvent(item, source.sourceIndex, { x: 1, y: 2 })).toEqual({
        draggableId: 'x',
        droppableId: '',
        data: 1,
        position: { x: 1, y: 2 },
        sourceIndex: 0,
      });
    });
  });
});
