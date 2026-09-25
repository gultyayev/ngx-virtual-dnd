import { signal } from '@angular/core';
import { DropEvent, END_OF_LIST } from '../models/drag-drop.models';
import { moveItem, reorderItems } from './drop-helpers';

const dropEvent = (sourceIndex: number, destinationIndex: number): DropEvent => ({
  source: { draggableId: 'dragged', droppableId: 'list', index: sourceIndex },
  destination: { droppableId: 'list', placeholderId: END_OF_LIST, index: destinationIndex },
});

describe('drop helpers', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('reorderItems', () => {
    it('should move the item to the destination index', () => {
      const list = signal(['a', 'b', 'c', 'd']);

      reorderItems(dropEvent(0, 2), list);

      expect(list()).toEqual(['b', 'c', 'a', 'd']);
    });

    it('should leave the list untouched when the source index is out of range', () => {
      // e.g. the list shrank while the item was being dragged
      const list = signal(['a', 'b']);
      const before = list();

      reorderItems(dropEvent(5, 0), list);

      expect(list()).toBe(before);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('index 5'));
    });
  });

  describe('moveItem', () => {
    it('should leave a same-list reorder untouched when the source index is out of range', () => {
      const list = signal(['a', 'b']);
      const before = list();

      moveItem(dropEvent(5, 0), { list });

      expect(list()).toBe(before);
    });
  });
});
