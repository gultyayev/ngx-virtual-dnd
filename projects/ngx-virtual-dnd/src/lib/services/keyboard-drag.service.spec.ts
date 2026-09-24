import { TestBed } from '@angular/core/testing';
import { KeyboardDragService } from './keyboard-drag.service';
import { DragStateService } from './drag-state.service';
import { DraggedItem, END_OF_LIST } from '../models/drag-drop.models';

describe('KeyboardDragService', () => {
  let service: KeyboardDragService;
  let dragState: DragStateService;

  const createMockElement = (): HTMLElement => {
    const el = document.createElement('div');
    // Mock getBoundingClientRect for startKeyboardDrag
    jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 200,
      right: 300,
      bottom: 250,
      width: 200,
      height: 50,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    });
    return el;
  };

  const createMockItem = (overrides?: Partial<DraggedItem>): DraggedItem => ({
    draggableId: 'item-1',
    droppableId: 'list-1',
    element: createMockElement(),
    height: 50,
    width: 200,
    data: { name: 'Test Item' },
    ...overrides,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(KeyboardDragService);
    dragState = TestBed.inject(DragStateService);
  });

  afterEach(() => {
    dragState.endDrag();
  });

  /** A pointer (non-keyboard) drag, which keyboard-only operations must leave alone. */
  const startPointerDrag = (): void => {
    dragState.startDrag(
      createMockItem(),
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      null,
      'list-1',
      null,
      3,
      2,
    );
  };

  describe('computed signals (initial state)', () => {
    it('should have isActive as false initially', () => {
      expect(service.isActive()).toBe(false);
    });

    it('should have targetIndex as null initially', () => {
      expect(service.targetIndex()).toBeNull();
    });

    it('should have sourceIndex as null initially', () => {
      expect(service.sourceIndex()).toBeNull();
    });

    it('should have activeDroppableId as null initially', () => {
      expect(service.activeDroppableId()).toBeNull();
    });
  });

  describe('startKeyboardDrag', () => {
    it('should activate keyboard drag', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      expect(service.isActive()).toBe(true);
    });

    it('should set sourceIndex', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 3, 10, 'list-1');

      expect(service.sourceIndex()).toBe(3);
    });

    it('should set activeDroppableId', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 0, 10, 'my-list');

      expect(service.activeDroppableId()).toBe('my-list');
    });

    it('should set targetIndex to sourceIndex', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 5, 10, 'list-1');

      expect(service.targetIndex()).toBe(5);
    });

    it('should set isKeyboardDrag on DragStateService', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      expect(dragState.isKeyboardDrag()).toBe(true);
    });

    it('should set isDragging on DragStateService', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      expect(dragState.isDragging()).toBe(true);
    });

    it('should set placeholderId to END_OF_LIST', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      expect(dragState.placeholderId()).toBe(END_OF_LIST);
    });

    it('should set placeholderIndex with same-list +1 adjustment', () => {
      const item = createMockItem();
      // sourceIndex=2, same list => initialPlaceholderIndex = 2 + 1 = 3
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      expect(dragState.placeholderIndex()).toBe(3);
    });

    it('should set cursor position from element bounding rect', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 0, 10, 'list-1');

      expect(dragState.cursorPosition()).toEqual({ x: 100, y: 200 });
    });

    it('should set grab offset to 0,0', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 0, 10, 'list-1');

      expect(dragState.grabOffset()).toEqual({ x: 0, y: 0 });
    });
  });

  describe('moveToIndex', () => {
    it('should return the target index unchanged and not touch a pointer drag', () => {
      startPointerDrag();

      expect(service.moveToIndex(5)).toBe(5);
      expect(dragState.placeholderIndex()).toBe(3);
      expect(dragState.keyboardTargetIndex()).toBeNull();
    });

    it('should update targetIndex when active', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 0, 10, 'list-1');

      service.moveToIndex(3);

      expect(service.targetIndex()).toBe(3);
    });

    it('should clamp to 0 when target is negative', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 0, 10, 'list-1');

      const result = service.moveToIndex(-5);

      expect(result).toBe(0);
      expect(service.targetIndex()).toBe(0);
    });

    it('should clamp to the last slot of the source list when target exceeds it', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 0, 5, 'list-1');

      const result = service.moveToIndex(10);

      expect(result).toBe(4);
      expect(service.targetIndex()).toBe(4);
    });

    it('should end the source list at totalItemCount - 1 (the dragged item leaves its slot)', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 0, 5, 'list-1');

      // Target indexes use the drop convention: the final index after removal from the source
      expect(service.moveToIndex(5)).toBe(4);
      expect(service.moveToIndex(4)).toBe(4);
    });

    it('should allow moving to totalItemCount (append) in another list', () => {
      const item = createMockItem({ droppableId: 'list-1' });
      service.startKeyboardDrag(item, 0, 5, 'list-1');
      service.moveToDroppable('list-2', 0, 3);

      expect(service.moveToIndex(10)).toBe(3);
    });

    it('should apply same-list +1 adjustment to placeholderIndex when target >= sourceIndex', () => {
      const item = createMockItem();
      // sourceIndex=2 in list-1 (same list), totalItems=10
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      // Move to index 3 (>= sourceIndex 2), placeholder should be 3+1=4
      service.moveToIndex(3);
      expect(dragState.placeholderIndex()).toBe(4);

      // Move to index 2 (== sourceIndex 2), placeholder should be 2+1=3
      service.moveToIndex(2);
      expect(dragState.placeholderIndex()).toBe(3);
    });

    it('should not apply same-list adjustment when target < sourceIndex', () => {
      const item = createMockItem();
      // sourceIndex=2 in list-1 (same list)
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      // Move to index 1 (< sourceIndex 2), placeholder should be 1 (no adjustment)
      service.moveToIndex(1);
      expect(dragState.placeholderIndex()).toBe(1);
    });
  });

  describe('moveUp', () => {
    it('should decrement target index by 1', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 5, 10, 'list-1');

      service.moveUp();

      expect(service.targetIndex()).toBe(4);
    });

    it('should clamp at 0', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 0, 10, 'list-1');

      const result = service.moveUp();

      expect(result).toBe(0);
      expect(service.targetIndex()).toBe(0);
    });

    it('should return the new target index', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 3, 10, 'list-1');

      expect(service.moveUp()).toBe(2);
    });

    it('should decrement consecutively', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 5, 10, 'list-1');

      service.moveUp(); // 4
      service.moveUp(); // 3
      const result = service.moveUp(); // 2

      expect(result).toBe(2);
      expect(service.targetIndex()).toBe(2);
    });
  });

  describe('moveDown', () => {
    it('should increment target index by 1', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 0, 10, 'list-1');

      service.moveDown();

      expect(service.targetIndex()).toBe(1);
    });

    it('should clamp at the last slot of the source list', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 3, 5, 'list-1');

      // Move to end
      service.moveDown(); // 4
      const result = service.moveDown(); // clamped at 4 (5 items, one of them dragged)

      expect(result).toBe(4);
      expect(service.targetIndex()).toBe(4);
    });

    it('should return the new target index', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      expect(service.moveDown()).toBe(3);
    });

    it('should increment consecutively', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 0, 10, 'list-1');

      service.moveDown(); // 1
      service.moveDown(); // 2
      const result = service.moveDown(); // 3

      expect(result).toBe(3);
      expect(service.targetIndex()).toBe(3);
    });
  });

  describe('moveToDroppable', () => {
    it('should not move a pointer drag to another droppable', () => {
      startPointerDrag();

      service.moveToDroppable('list-2', 0, 5);

      expect(service.activeDroppableId()).toBe('list-1');
      expect(dragState.placeholderIndex()).toBe(3);
    });

    it('should update activeDroppableId', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      service.moveToDroppable('list-2', 0, 5);

      expect(service.activeDroppableId()).toBe('list-2');
    });

    it('should update targetIndex', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      service.moveToDroppable('list-2', 3, 8);

      expect(service.targetIndex()).toBe(3);
    });

    it('should clamp targetIndex to totalItemCount', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      service.moveToDroppable('list-2', 20, 5);

      expect(service.targetIndex()).toBe(5);
    });

    it('should clamp targetIndex to 0 when negative', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      service.moveToDroppable('list-2', -3, 5);

      expect(service.targetIndex()).toBe(0);
    });

    it('should update totalItemCount for subsequent moves', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      // Move to list-2 with totalItemCount=3
      service.moveToDroppable('list-2', 0, 3);

      // Now moveDown should clamp to new totalItemCount
      service.moveDown(); // 1
      service.moveDown(); // 2
      service.moveDown(); // 3
      const result = service.moveDown(); // clamped at 3

      expect(result).toBe(3);
    });

    it('should not apply same-list adjustment when in different list', () => {
      const item = createMockItem({ droppableId: 'list-1' });
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      // Move to different list
      service.moveToDroppable('list-2', 2, 8);

      // Placeholder should equal targetIndex (no +1 adjustment for cross-list)
      expect(dragState.placeholderIndex()).toBe(2);
    });

    it('should clamp to the last slot when moving back to the source list', () => {
      const item = createMockItem({ droppableId: 'list-1' });
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      service.moveToDroppable('list-2', 1, 8);
      service.moveToDroppable('list-1', 20, 10);

      expect(service.targetIndex()).toBe(9);
    });

    it('should apply same-list adjustment when moving back to source list', () => {
      const item = createMockItem({ droppableId: 'list-1' });
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      // Move to different list
      service.moveToDroppable('list-2', 1, 8);
      expect(dragState.placeholderIndex()).toBe(1);

      // Move back to source list at index >= sourceIndex
      service.moveToDroppable('list-1', 3, 10);
      // targetIndex=3 >= sourceIndex=2 => placeholder = 3 + 1 = 4
      expect(dragState.placeholderIndex()).toBe(4);
    });
  });

  describe('completeKeyboardDrag', () => {
    it('should not end a pointer drag', () => {
      startPointerDrag();

      service.completeKeyboardDrag();

      expect(dragState.isDragging()).toBe(true);
    });

    it('should end the drag', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      service.completeKeyboardDrag();

      expect(service.isActive()).toBe(false);
      expect(dragState.isDragging()).toBe(false);
    });

    it('should not set wasCancelled', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      service.completeKeyboardDrag();

      expect(dragState.wasCancelled()).toBe(false);
    });
  });

  describe('cancelKeyboardDrag', () => {
    it('should not cancel a pointer drag', () => {
      startPointerDrag();

      service.cancelKeyboardDrag();

      expect(dragState.isDragging()).toBe(true);
      expect(dragState.wasCancelled()).toBe(false);
    });

    it('should cancel the drag', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      service.cancelKeyboardDrag();

      expect(service.isActive()).toBe(false);
      expect(dragState.isDragging()).toBe(false);
    });

    it('should set wasCancelled to true', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 2, 10, 'list-1');

      service.cancelKeyboardDrag();

      expect(dragState.wasCancelled()).toBe(true);
    });
  });

  describe('setTotalItemCount', () => {
    it('should update the clamping upper bound', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 0, 10, 'list-1');

      // Reduce total item count
      service.setTotalItemCount(3);

      // moveToIndex should now clamp to the source list's last slot (3 - 1)
      const result = service.moveToIndex(10);
      expect(result).toBe(2);
    });

    it('should allow increasing the upper bound', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 0, 3, 'list-1');

      service.setTotalItemCount(20);

      const result = service.moveToIndex(15);
      expect(result).toBe(15);
    });
  });

  describe('isActive computed signal', () => {
    it('should be false when isDragging is true but not keyboard drag', () => {
      const item = createMockItem();
      // Start a regular (non-keyboard) drag
      dragState.startDrag(item, { x: 0, y: 0 }, { x: 0, y: 0 }, null, 'list-1');

      expect(dragState.isDragging()).toBe(true);
      expect(dragState.isKeyboardDrag()).toBe(false);
      expect(service.isActive()).toBe(false);
    });

    it('should be true only when both isDragging and isKeyboardDrag', () => {
      const item = createMockItem();
      service.startKeyboardDrag(item, 0, 10, 'list-1');

      expect(dragState.isDragging()).toBe(true);
      expect(dragState.isKeyboardDrag()).toBe(true);
      expect(service.isActive()).toBe(true);
    });
  });

  describe('placeholder revealers', () => {
    it('should reveal the active droppable on every keyboard move', () => {
      const reveal = jest.fn();
      service.registerRevealer('list-1', reveal);
      service.startKeyboardDrag(createMockItem(), 2, 10, 'list-1');

      service.moveDown();
      service.moveToIndex(5);

      expect(reveal).toHaveBeenCalledTimes(2);
    });

    it('should reveal only the droppable the drag moves into', () => {
      const revealSource = jest.fn();
      const revealTarget = jest.fn();
      service.registerRevealer('list-1', revealSource);
      service.registerRevealer('list-2', revealTarget);
      service.startKeyboardDrag(createMockItem(), 2, 10, 'list-1');

      service.moveToDroppable('list-2', 0, 5);

      expect(revealTarget).toHaveBeenCalledTimes(1);
      expect(revealSource).not.toHaveBeenCalled();
    });

    it('should not reveal during a pointer drag', () => {
      const reveal = jest.fn();
      service.registerRevealer('list-1', reveal);
      startPointerDrag();

      service.moveDown();

      expect(reveal).not.toHaveBeenCalled();
    });

    it('should stop revealing after unregistering', () => {
      const reveal = jest.fn();
      service.registerRevealer('list-1', reveal);
      service.unregisterRevealer('list-1', reveal);
      service.startKeyboardDrag(createMockItem(), 2, 10, 'list-1');

      service.moveDown();

      expect(reveal).not.toHaveBeenCalled();
    });

    it('should keep a newer revealer when an older one unregisters', () => {
      const older = jest.fn();
      const newer = jest.fn();
      service.registerRevealer('list-1', older);
      service.registerRevealer('list-1', newer);
      service.unregisterRevealer('list-1', older);
      service.startKeyboardDrag(createMockItem(), 2, 10, 'list-1');

      service.moveDown();

      expect(newer).toHaveBeenCalledTimes(1);
      expect(older).not.toHaveBeenCalled();
    });
  });

  describe('cross-list drag scenario', () => {
    it('should handle a full cross-list drag workflow', () => {
      const item = createMockItem({ droppableId: 'list-1' });

      // Start drag in list-1 at index 2
      service.startKeyboardDrag(item, 2, 10, 'list-1');
      expect(service.isActive()).toBe(true);
      expect(service.targetIndex()).toBe(2);
      expect(service.activeDroppableId()).toBe('list-1');

      // Move down in same list
      service.moveDown(); // 3
      expect(service.targetIndex()).toBe(3);

      // Cross to list-2
      service.moveToDroppable('list-2', 0, 5);
      expect(service.activeDroppableId()).toBe('list-2');
      expect(service.targetIndex()).toBe(0);

      // Move down in list-2
      service.moveDown(); // 1
      service.moveDown(); // 2
      expect(service.targetIndex()).toBe(2);

      // Complete the drag
      service.completeKeyboardDrag();
      expect(service.isActive()).toBe(false);
    });

    it('should handle cancel during cross-list drag', () => {
      const item = createMockItem({ droppableId: 'list-1' });

      service.startKeyboardDrag(item, 2, 10, 'list-1');
      service.moveToDroppable('list-2', 1, 5);

      service.cancelKeyboardDrag();

      expect(service.isActive()).toBe(false);
      expect(dragState.wasCancelled()).toBe(true);
    });
  });
});
