import { TestBed } from '@angular/core/testing';
import { DroppableRegistryService } from './droppable-registry.service';
import { DragState, INITIAL_DRAG_STATE } from '../models/drag-drop.models';

describe('DroppableRegistryService', () => {
  let registry: DroppableRegistryService;
  const created: HTMLElement[] = [];

  function makeElement(parent: Node = document.body): HTMLElement {
    const el = document.createElement('div');
    parent.appendChild(el);
    created.push(el);
    return el;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(DroppableRegistryService);
  });

  afterEach(() => {
    created.forEach((el) => el.remove());
    created.length = 0;
  });

  describe('getGroup', () => {
    it('returns only the droppables registered in that group', () => {
      const a = makeElement();
      const b = makeElement();
      const other = makeElement();
      registry.register(a, 'a', 'g');
      registry.register(b, 'b', 'g');
      registry.register(other, 'other', 'h');

      expect(registry.getGroup('g')).toEqual([a, b]);
      expect(registry.getGroup('h')).toEqual([other]);
    });

    it('returns an empty list for an unknown group', () => {
      expect(registry.getGroup('nope')).toEqual([]);
    });

    it('orders droppables by document position, not registration order', () => {
      const first = makeElement();
      const second = makeElement();
      // Register in reverse: the nested/later element must still come last (paint order).
      registry.register(second, 'second', 'g');
      registry.register(first, 'first', 'g');

      expect(registry.getGroup('g')).toEqual([first, second]);
    });

    it('orders a nested droppable after its ancestor', () => {
      const outer = makeElement();
      const inner = makeElement(outer);
      registry.register(inner, 'inner', 'g');
      registry.register(outer, 'outer', 'g');

      expect(registry.getGroup('g')).toEqual([outer, inner]);
    });

    it('skips droppables that are no longer connected to the document', () => {
      const a = makeElement();
      const b = makeElement();
      registry.register(a, 'a', 'g');
      registry.register(b, 'b', 'g');

      a.remove();

      expect(registry.getGroup('g')).toEqual([b]);
    });

    it('finds droppables inside a shadow root (no document query involved)', () => {
      const host = makeElement();
      const shadow = host.attachShadow({ mode: 'open' });
      const inShadow = document.createElement('div');
      shadow.appendChild(inShadow);
      registry.register(inShadow, 'shadow-list', 'g');

      expect(registry.getGroup('g')).toEqual([inShadow]);
    });

    it('returns a copy callers cannot use to corrupt the registry', () => {
      const a = makeElement();
      registry.register(a, 'a', 'g');

      const result = registry.getGroup('g') as HTMLElement[];
      result.length = 0;

      expect(registry.getGroup('g')).toEqual([a]);
    });
  });

  describe('unregister', () => {
    it('removes the droppable from its group and id lookups', () => {
      const a = makeElement();
      const unregister = registry.register(a, 'a', 'g');

      unregister();

      expect(registry.getGroup('g')).toEqual([]);
      expect(registry.getById('a')).toBeNull();
    });

    it('is safe to call twice', () => {
      const a = makeElement();
      const b = makeElement();
      const unregister = registry.register(a, 'a', 'g');
      registry.register(b, 'b', 'g');

      unregister();
      unregister();

      expect(registry.getGroup('g')).toEqual([b]);
    });
  });

  describe('getById', () => {
    it('returns the registered droppable with that id', () => {
      const a = makeElement();
      registry.register(a, 'a', 'g');

      expect(registry.getById('a')).toBe(a);
    });

    it('finds ids containing selector-sensitive characters', () => {
      const a = makeElement();
      const unsafeId = 'list-"quoted"\\[one]';
      registry.register(a, unsafeId, 'g');

      expect(registry.getById(unsafeId)).toBe(a);
    });

    it('returns null for an unknown or empty id', () => {
      const a = makeElement();
      registry.register(a, '', 'g');

      expect(registry.getById('missing')).toBeNull();
      expect(registry.getById('')).toBeNull();
    });

    it('returns null when the only droppable with that id is disconnected', () => {
      const a = makeElement();
      registry.register(a, 'a', 'g');
      a.remove();

      expect(registry.getById('a')).toBeNull();
    });

    it('prefers the first droppable in document order when an id is registered twice', () => {
      // A re-rendered list can briefly have two elements with the same id.
      const first = makeElement();
      const second = makeElement();
      registry.register(second, 'dup', 'g');
      registry.register(first, 'dup', 'g');

      expect(registry.getById('dup')).toBe(first);
    });

    it('keeps the other element when one of two duplicates unregisters', () => {
      const first = makeElement();
      const second = makeElement();
      const unregisterFirst = registry.register(first, 'dup', 'g');
      registry.register(second, 'dup', 'g');

      unregisterFirst();

      expect(registry.getById('dup')).toBe(second);
    });
  });

  describe('deliverDrop', () => {
    const endedOn = (activeDroppableId: string | null): DragState => ({
      ...INITIAL_DRAG_STATE,
      isDragging: true,
      draggedItem: {
        draggableId: 'item',
        droppableId: 'source',
        element: document.createElement('div'),
        height: 10,
        width: 10,
      },
      activeDroppableId,
    });

    it('calls the drop handler of the target with the ended state', () => {
      const onDrop = jest.fn(() => true);
      const other = jest.fn(() => true);
      registry.register(makeElement(), 'target', 'g', onDrop);
      registry.register(makeElement(), 'other', 'g', other);
      const state = endedOn('target');

      registry.deliverDrop(state);

      expect(onDrop).toHaveBeenCalledTimes(1);
      expect(onDrop).toHaveBeenCalledWith(state);
      expect(other).not.toHaveBeenCalled();
    });

    it('delivers to one droppable, the first in document order, when an id is duplicated', () => {
      const first = jest.fn(() => true);
      const second = jest.fn(() => true);
      const firstEl = makeElement();
      const secondEl = makeElement();
      registry.register(secondEl, 'dup', 'g', second);
      registry.register(firstEl, 'dup', 'g', first);

      registry.deliverDrop(endedOn('dup'));

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).not.toHaveBeenCalled();
    });

    it('offers the drop to the next droppable with the id when one declines it', () => {
      // A disabled droppable declines; pointer hit-testing targeted the enabled one
      const disabled = jest.fn(() => false);
      const enabled = jest.fn(() => true);
      registry.register(makeElement(), 'dup', 'g', disabled);
      registry.register(makeElement(), 'dup', 'g', enabled);

      registry.deliverDrop(endedOn('dup'));

      expect(disabled).toHaveBeenCalledTimes(1);
      expect(enabled).toHaveBeenCalledTimes(1);
    });

    it('stops at the first droppable that takes the drop', () => {
      const first = jest.fn(() => true);
      const second = jest.fn(() => true);
      registry.register(makeElement(), 'dup', 'g', first);
      registry.register(makeElement(), 'dup', 'g', second);

      registry.deliverDrop(endedOn('dup'));

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).not.toHaveBeenCalled();
    });

    it("prefers the droppable with the id in the source list's group", () => {
      const inOtherGroup = jest.fn(() => true);
      const inDragGroup = jest.fn(() => true);
      registry.register(makeElement(), 'todo', 'board-a', inOtherGroup);
      registry.register(makeElement(), 'todo', 'board-b', inDragGroup);
      registry.register(makeElement(), 'source', 'board-b');

      registry.deliverDrop({ ...endedOn('todo'), sourceDroppableId: 'source' });

      expect(inDragGroup).toHaveBeenCalledTimes(1);
      expect(inOtherGroup).not.toHaveBeenCalled();
    });

    it('skips a disconnected droppable with the target id', () => {
      const detached = jest.fn(() => true);
      const connected = jest.fn(() => true);
      const detachedEl = makeElement();
      registry.register(detachedEl, 'dup', 'g', detached);
      registry.register(makeElement(), 'dup', 'g', connected);
      detachedEl.remove();

      registry.deliverDrop(endedOn('dup'));

      expect(detached).not.toHaveBeenCalled();
      expect(connected).toHaveBeenCalledTimes(1);
    });

    it('does nothing without a target, an item, or a registered target', () => {
      const onDrop = jest.fn(() => true);
      const unregister = registry.register(makeElement(), 'target', 'g', onDrop);

      registry.deliverDrop(endedOn(null));
      registry.deliverDrop({ ...endedOn('target'), draggedItem: null });
      unregister();
      registry.deliverDrop(endedOn('target'));

      expect(onDrop).not.toHaveBeenCalled();
    });

    it('tolerates a target registered without a drop handler', () => {
      registry.register(makeElement(), 'target', 'g');

      expect(() => registry.deliverDrop(endedOn('target'))).not.toThrow();
    });
  });

  describe('change listeners', () => {
    it('notifies with the group on register and unregister', () => {
      const listener = jest.fn();
      registry.onChange(listener);
      const a = makeElement();

      const unregister = registry.register(a, 'a', 'g');
      expect(listener).toHaveBeenLastCalledWith('g');

      listener.mockClear();
      unregister();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('g');
    });

    it('does not notify for a second unregister of the same droppable', () => {
      const listener = jest.fn();
      const a = makeElement();
      const unregister = registry.register(a, 'a', 'g');
      registry.onChange(listener);

      unregister();
      unregister();

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('stops notifying after the listener is removed', () => {
      const listener = jest.fn();
      const removeListener = registry.onChange(listener);
      removeListener();

      registry.register(makeElement(), 'a', 'g');

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
