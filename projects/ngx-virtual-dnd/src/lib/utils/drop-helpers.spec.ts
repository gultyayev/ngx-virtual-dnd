import { effect, Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DropEvent, END_OF_LIST } from '../models/drag-drop.models';
import { moveItem, reorderItems } from './drop-helpers';

const dropEvent = (sourceIndex: number, destinationIndex: number): DropEvent => ({
  source: { draggableId: 'dragged', droppableId: 'list', index: sourceIndex },
  destination: { droppableId: 'list', placeholderId: END_OF_LIST, index: destinationIndex },
});

/**
 * Runs `apply` from an effect, as an app does when it applies a drop once a signal allows it
 * (for example after a confirmation). Returns how many times the effect ran.
 */
function applyFromEffect(apply: () => void): number {
  const ready = signal(false);
  let runs = 0;
  effect(
    () => {
      if (!ready()) return;
      runs++;
      // Stop an effect that keeps re-triggering itself, so a failure can't hang the test
      if (runs > 5) return;
      apply();
    },
    { injector: TestBed.inject(Injector) },
  );
  ready.set(true);
  TestBed.tick();
  return runs;
}

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

    it('should not make an effect that applies the drop depend on the list', () => {
      const list = signal(['a', 'b', 'c', 'd']);

      const runs = applyFromEffect(() => reorderItems(dropEvent(0, 2), list));

      expect(runs).toBe(1);
      expect(list()).toEqual(['b', 'c', 'a', 'd']);
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
