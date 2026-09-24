import { TestBed } from '@angular/core/testing';
import { DragStateService } from './drag-state.service';
import {
  DraggedItem,
  CursorPosition,
  GrabOffset,
  INITIAL_DRAG_STATE,
} from '../models/drag-drop.models';

describe('DragStateService', () => {
  let service: DragStateService;

  const createMockDraggedItem = (overrides?: Partial<DraggedItem>): DraggedItem => ({
    draggableId: 'item-1',
    droppableId: 'list-1',
    element: document.createElement('div'),
    height: 50,
    width: 200,
    data: { name: 'Test Item' },
    ...overrides,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DragStateService);
  });

  afterEach(() => {
    // Ensure clean state for next test
    service.endDrag();
  });

  /** Every public signal reads its idle value. */
  const expectIdle = (): void => {
    expect(service.getStateSnapshot()).toEqual(INITIAL_DRAG_STATE);
    expect(service.isDragging()).toBe(false);
    expect(service.draggedItem()).toBeNull();
    expect(service.draggedItemId()).toBeNull();
    expect(service.sourceDroppableId()).toBeNull();
    expect(service.sourceIndex()).toBeNull();
    expect(service.activeDroppableId()).toBeNull();
    expect(service.placeholderId()).toBeNull();
    expect(service.placeholderIndex()).toBeNull();
    expect(service.cursorPosition()).toBeNull();
    expect(service.grabOffset()).toBeNull();
    expect(service.initialPosition()).toBeNull();
    expect(service.lockAxis()).toBeNull();
    expect(service.isKeyboardDrag()).toBe(false);
    expect(service.keyboardTargetIndex()).toBeNull();
  };

  it('should start idle', () => {
    expectIdle();
  });

  describe('startDrag', () => {
    it('should set isDragging to true', () => {
      const item = createMockDraggedItem();
      service.startDrag(item);
      expect(service.isDragging()).toBe(true);
    });

    it('should set draggedItem', () => {
      const item = createMockDraggedItem();
      service.startDrag(item);
      expect(service.draggedItem()).toBe(item);
    });

    it('should set draggedItemId from item', () => {
      const item = createMockDraggedItem({ draggableId: 'test-id' });
      service.startDrag(item);
      expect(service.draggedItemId()).toBe('test-id');
    });

    it('should set sourceDroppableId from item.droppableId', () => {
      const item = createMockDraggedItem({ droppableId: 'source-list' });
      service.startDrag(item);
      expect(service.sourceDroppableId()).toBe('source-list');
    });

    it('should set initialPosition when provided', () => {
      const item = createMockDraggedItem();
      const position: CursorPosition = { x: 100, y: 200 };
      service.startDrag(item, position);
      expect(service.initialPosition()).toEqual(position);
      expect(service.cursorPosition()).toEqual(position);
    });

    it('should set grabOffset when provided', () => {
      const item = createMockDraggedItem();
      const offset: GrabOffset = { x: 10, y: 20 };
      service.startDrag(item, undefined, offset);
      expect(service.grabOffset()).toEqual(offset);
    });

    it('should set lockAxis when provided', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, undefined, undefined, 'y');
      expect(service.lockAxis()).toBe('y');
    });

    it('should set activeDroppableId when provided', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, undefined, undefined, null, 'target-list');
      expect(service.activeDroppableId()).toBe('target-list');
    });

    it('should set placeholderId when provided', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, undefined, undefined, null, null, 'placeholder-id');
      expect(service.placeholderId()).toBe('placeholder-id');
    });

    it('should set placeholderIndex when provided', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, undefined, undefined, null, null, null, 5);
      expect(service.placeholderIndex()).toBe(5);
    });

    it('should set sourceIndex when provided', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, undefined, undefined, null, null, null, null, 3);
      expect(service.sourceIndex()).toBe(3);
    });

    it('should use axisLockPosition as initialPosition when provided', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, { x: 100, y: 200 }, undefined, 'x', null, null, null, null, false, {
        x: 90,
        y: 190,
      });

      expect(service.initialPosition()).toEqual({ x: 90, y: 190 });
      expect(service.cursorPosition()).toEqual({ x: 100, y: 200 });
    });

    it('should start a keyboard drag with the target index at the source index', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, undefined, undefined, null, 'list-1', null, 4, 3, true);

      expect(service.isKeyboardDrag()).toBe(true);
      expect(service.keyboardTargetIndex()).toBe(3);
    });

    it('should not set a keyboard target index for a pointer drag', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, undefined, undefined, null, 'list-1', null, 4, 3);

      expect(service.isKeyboardDrag()).toBe(false);
      expect(service.keyboardTargetIndex()).toBeNull();
    });

    it('should set all optional parameters at once', () => {
      const item = createMockDraggedItem();
      const position: CursorPosition = { x: 100, y: 200 };
      const offset: GrabOffset = { x: 10, y: 20 };

      service.startDrag(item, position, offset, 'x', 'list-2', 'item-5', 4, 2);

      expect(service.isDragging()).toBe(true);
      expect(service.draggedItem()).toBe(item);
      expect(service.cursorPosition()).toEqual(position);
      expect(service.initialPosition()).toEqual(position);
      expect(service.grabOffset()).toEqual(offset);
      expect(service.lockAxis()).toBe('x');
      expect(service.activeDroppableId()).toBe('list-2');
      expect(service.placeholderId()).toBe('item-5');
      expect(service.placeholderIndex()).toBe(4);
      expect(service.sourceIndex()).toBe(2);
    });
  });

  describe('updateDragPosition', () => {
    it('should not update if not dragging', () => {
      const update = {
        cursorPosition: { x: 100, y: 200 },
        activeDroppableId: 'list-1',
        placeholderId: 'item-1',
        placeholderIndex: 5,
      };

      service.updateDragPosition(update);

      expect(service.cursorPosition()).toBeNull();
      expect(service.activeDroppableId()).toBeNull();
    });

    it('should update cursorPosition when dragging', () => {
      const item = createMockDraggedItem();
      service.startDrag(item);

      const newPosition = { x: 150, y: 250 };
      service.updateDragPosition({
        cursorPosition: newPosition,
        activeDroppableId: null,
        placeholderId: null,
        placeholderIndex: null,
      });

      expect(service.cursorPosition()).toEqual(newPosition);
    });

    it('should update activeDroppableId when dragging', () => {
      const item = createMockDraggedItem();
      service.startDrag(item);

      service.updateDragPosition({
        cursorPosition: { x: 100, y: 200 },
        activeDroppableId: 'new-list',
        placeholderId: null,
        placeholderIndex: null,
      });

      expect(service.activeDroppableId()).toBe('new-list');
    });

    it('should update placeholderId when dragging', () => {
      const item = createMockDraggedItem();
      service.startDrag(item);

      service.updateDragPosition({
        cursorPosition: { x: 100, y: 200 },
        activeDroppableId: 'list-1',
        placeholderId: 'target-item',
        placeholderIndex: null,
      });

      expect(service.placeholderId()).toBe('target-item');
    });

    it('should update placeholderIndex when dragging', () => {
      const item = createMockDraggedItem();
      service.startDrag(item);

      service.updateDragPosition({
        cursorPosition: { x: 100, y: 200 },
        activeDroppableId: 'list-1',
        placeholderId: 'item-1',
        placeholderIndex: 7,
      });

      expect(service.placeholderIndex()).toBe(7);
    });

    it('should preserve other state when updating position', () => {
      const item = createMockDraggedItem();
      const offset: GrabOffset = { x: 10, y: 20 };
      service.startDrag(item, { x: 50, y: 50 }, offset, 'y', null, null, null, 3);

      service.updateDragPosition({
        cursorPosition: { x: 100, y: 200 },
        activeDroppableId: 'list-2',
        placeholderId: 'item-5',
        placeholderIndex: 5,
      });

      // These should be preserved
      expect(service.draggedItem()).toBe(item);
      expect(service.grabOffset()).toEqual(offset);
      expect(service.lockAxis()).toBe('y');
      expect(service.sourceIndex()).toBe(3);
      expect(service.initialPosition()).toEqual({ x: 50, y: 50 });
    });
  });

  describe('setActiveDroppable', () => {
    it('should not update if not dragging', () => {
      service.setActiveDroppable('new-list');
      expect(service.activeDroppableId()).toBeNull();
    });

    it('should update activeDroppableId when dragging', () => {
      const item = createMockDraggedItem();
      service.startDrag(item);

      service.setActiveDroppable('new-list');
      expect(service.activeDroppableId()).toBe('new-list');
    });

    it('should allow setting to null', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, undefined, undefined, null, 'initial-list');

      service.setActiveDroppable(null);
      expect(service.activeDroppableId()).toBeNull();
    });
  });

  describe('setPlaceholder', () => {
    it('should not update if not dragging', () => {
      service.setPlaceholder('item-1');
      expect(service.placeholderId()).toBeNull();
    });

    it('should update placeholderId when dragging', () => {
      const item = createMockDraggedItem();
      service.startDrag(item);

      service.setPlaceholder('target-item');
      expect(service.placeholderId()).toBe('target-item');
    });

    it('should allow setting to null', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, undefined, undefined, null, null, 'initial-placeholder');

      service.setPlaceholder(null);
      expect(service.placeholderId()).toBeNull();
    });
  });

  describe('endDrag', () => {
    it('should reset every signal to its idle value', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, { x: 100, y: 200 }, { x: 10, y: 20 }, 'x', 'list-1', 'item-5', 5, 2);

      service.endDrag();

      expectIdle();
    });

    it('should capture the final state in endedDragState and mark it as not cancelled', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, { x: 100, y: 200 }, undefined, null, 'list-1', 'item-5', 5, 2);
      service.updateDragPosition({
        cursorPosition: { x: 110, y: 260 },
        activeDroppableId: 'list-2',
        placeholderId: 'item-7',
        placeholderIndex: 7,
      });

      service.endDrag();

      expect(service.wasCancelled()).toBe(false);
      expect(service.endedDragState()).toEqual(
        expect.objectContaining({
          isDragging: true,
          draggedItem: item,
          sourceIndex: 2,
          activeDroppableId: 'list-2',
          placeholderId: 'item-7',
          placeholderIndex: 7,
          cursorPosition: { x: 110, y: 260 },
        }),
      );
    });
  });

  describe('cancelDrag', () => {
    it('should reset every signal to its idle value', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, { x: 100, y: 200 }, { x: 10, y: 20 }, 'x', 'list-1', 'item-5', 5, 2);

      service.cancelDrag();

      expectIdle();
    });

    it('should mark the drag as cancelled and keep its final state', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, undefined, undefined, null, 'list-1', null, 3);

      service.cancelDrag();

      expect(service.wasCancelled()).toBe(true);
      expect(service.endedDragState()).toEqual(
        expect.objectContaining({ draggedItem: item, placeholderIndex: 3 }),
      );
    });

    it('should clear the ended state and cancelled flag when the next drag starts', () => {
      service.startDrag(createMockDraggedItem());
      service.cancelDrag();

      service.startDrag(createMockDraggedItem({ draggableId: 'item-2' }));

      expect(service.wasCancelled()).toBe(false);
      expect(service.endedDragState()).toBeNull();
    });
  });

  describe('body dragging class', () => {
    it('should add vdnd-dragging to body only while a drag is active', () => {
      service.startDrag(createMockDraggedItem());
      TestBed.tick();
      expect(document.body.classList.contains('vdnd-dragging')).toBe(true);

      service.endDrag();
      TestBed.tick();
      expect(document.body.classList.contains('vdnd-dragging')).toBe(false);
    });
  });

  describe('isDroppableActive', () => {
    it('should return false when not dragging', () => {
      expect(service.isDroppableActive('list-1')).toBe(false);
    });

    it('should return false when droppable is not active', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, undefined, undefined, null, 'list-1');

      expect(service.isDroppableActive('list-2')).toBe(false);
    });

    it('should return true when droppable is active', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, undefined, undefined, null, 'list-1');

      expect(service.isDroppableActive('list-1')).toBe(true);
    });

    it('should track active droppable changes', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, undefined, undefined, null, 'list-1');

      expect(service.isDroppableActive('list-1')).toBe(true);
      expect(service.isDroppableActive('list-2')).toBe(false);

      service.setActiveDroppable('list-2');

      expect(service.isDroppableActive('list-1')).toBe(false);
      expect(service.isDroppableActive('list-2')).toBe(true);
    });
  });

  describe('updateScrollOnlyPlaceholder', () => {
    it('updates placeholderId and placeholderIndex when dragging', () => {
      const item = createMockDraggedItem();
      service.startDrag(item, { x: 50, y: 50 }, undefined, null, 'list-1', 'item-0', 0);

      service.updateScrollOnlyPlaceholder('item-3', 3);

      expect(service.placeholderId()).toBe('item-3');
      expect(service.placeholderIndex()).toBe(3);
    });

    it('does not change cursorPosition or activeDroppableId', () => {
      const item = createMockDraggedItem();
      const cursor: CursorPosition = { x: 50, y: 50 };
      service.startDrag(item, cursor, undefined, null, 'list-1', 'item-0', 0);

      service.updateScrollOnlyPlaceholder('item-5', 5);

      expect(service.cursorPosition()).toEqual(cursor);
      expect(service.activeDroppableId()).toBe('list-1');
    });

    it('is a no-op when not dragging', () => {
      service.updateScrollOnlyPlaceholder('item-1', 1);

      expect(service.placeholderId()).toBeNull();
      expect(service.placeholderIndex()).toBeNull();
    });
  });

  describe('getStateSnapshot', () => {
    it('should return complete state when dragging', () => {
      const item = createMockDraggedItem();
      const position: CursorPosition = { x: 100, y: 200 };
      const offset: GrabOffset = { x: 10, y: 20 };

      service.startDrag(item, position, offset, 'y', 'list-1', 'item-3', 3, 1);

      const snapshot = service.getStateSnapshot();

      expect(snapshot.isDragging).toBe(true);
      expect(snapshot.draggedItem).toBe(item);
      expect(snapshot.sourceDroppableId).toBe('list-1');
      expect(snapshot.sourceIndex).toBe(1);
      expect(snapshot.activeDroppableId).toBe('list-1');
      expect(snapshot.placeholderId).toBe('item-3');
      expect(snapshot.placeholderIndex).toBe(3);
      expect(snapshot.cursorPosition).toEqual(position);
      expect(snapshot.grabOffset).toEqual(offset);
      expect(snapshot.initialPosition).toEqual(position);
      expect(snapshot.lockAxis).toBe('y');
    });
  });

  describe('keyboard target index', () => {
    const startKeyboardDrag = (sourceIndex: number): void => {
      service.startDrag(
        createMockDraggedItem({ droppableId: 'list-1' }),
        undefined,
        undefined,
        null,
        'list-1',
        null,
        sourceIndex + 1,
        sourceIndex,
        true,
      );
    };

    it('should add the hidden-source offset to the placeholder at or after the source', () => {
      startKeyboardDrag(2);

      service.setKeyboardTargetIndex(2);
      expect(service.placeholderIndex()).toBe(3);

      service.setKeyboardTargetIndex(5);
      expect(service.keyboardTargetIndex()).toBe(5);
      expect(service.placeholderIndex()).toBe(6);
    });

    it('should not offset the placeholder above the source', () => {
      startKeyboardDrag(2);

      service.setKeyboardTargetIndex(1);

      expect(service.placeholderIndex()).toBe(1);
    });

    it('should ignore keyboard target updates during a pointer drag', () => {
      service.startDrag(createMockDraggedItem(), undefined, undefined, null, 'list-1', null, 4, 3);

      service.setKeyboardTargetIndex(1);
      service.setKeyboardActiveDroppable('list-2', 1);

      expect(service.keyboardTargetIndex()).toBeNull();
      expect(service.placeholderIndex()).toBe(4);
      expect(service.activeDroppableId()).toBe('list-1');
    });

    it('should not offset the placeholder in another list', () => {
      startKeyboardDrag(2);

      service.setKeyboardActiveDroppable('list-2', 4);

      expect(service.activeDroppableId()).toBe('list-2');
      expect(service.keyboardTargetIndex()).toBe(4);
      expect(service.placeholderIndex()).toBe(4);
    });

    it('should offset the placeholder again on returning to the source list', () => {
      startKeyboardDrag(2);
      service.setKeyboardActiveDroppable('list-2', 4);

      service.setKeyboardActiveDroppable('list-1', 4);

      expect(service.placeholderIndex()).toBe(5);
    });
  });
});
