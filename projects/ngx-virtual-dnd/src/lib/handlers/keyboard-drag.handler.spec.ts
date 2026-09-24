/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterNextRender } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  KeyboardDragCallbacks,
  KeyboardDragDeps,
  KeyboardDragHandler,
} from './keyboard-drag.handler';
import { PositionCalculatorService } from '../services/position-calculator.service';
import { DragIndexCalculatorService } from '../services/drag-index-calculator.service';

jest.mock('@angular/core', () => {
  const actual = jest.requireActual('@angular/core');
  return {
    ...actual,
    afterNextRender: jest.fn(),
  };
});

describe('KeyboardDragHandler', () => {
  const afterNextRenderMock = jest.mocked(afterNextRender);

  let handler: KeyboardDragHandler;
  let mockDragState: any;
  let mockKeyboardDrag: any;
  let mockPositionCalculator: any;
  let mockDragIndexCalculator: any;
  let mockElementClone: any;
  let mockNgZone: any;
  let mockEnvInjector: any;
  let mockCallbacks: KeyboardDragCallbacks;
  let mockContext: {
    element: HTMLElement;
    draggableId: string;
    groupName: string | null;
    data: unknown;
  };

  const createElement = (): HTMLElement => {
    const el = document.createElement('div');
    el.getBoundingClientRect = jest.fn().mockReturnValue({
      left: 100,
      top: 200,
      width: 200,
      height: 50,
    });
    return el;
  };

  beforeEach(() => {
    mockDragState = {
      sourceIndex: jest.fn().mockReturnValue(0),
      placeholderIndex: jest.fn().mockReturnValue(2),
      sourceDroppableId: jest.fn().mockReturnValue('list-1'),
      activeDroppableId: jest.fn().mockReturnValue('list-1'),
      draggedItem: jest.fn().mockReturnValue({ height: 50 }),
    };

    mockKeyboardDrag = {
      isActive: jest.fn().mockReturnValue(false),
      startKeyboardDrag: jest.fn(),
      completeKeyboardDrag: jest.fn(),
      cancelKeyboardDrag: jest.fn(),
      moveUp: jest.fn(),
      moveDown: jest.fn(),
      moveToDroppable: jest.fn(),
      targetIndex: jest.fn().mockReturnValue(0),
    };

    mockPositionCalculator = {
      getDroppableParent: jest.fn().mockReturnValue(createElement()),
      getDroppableId: jest.fn().mockReturnValue('list-1'),
      findAdjacentDroppable: jest.fn(),
      isDroppableDisabledById: jest.fn().mockReturnValue(false),
    };

    mockDragIndexCalculator = {
      getTotalItemCount: jest.fn().mockReturnValue(5),
      clearCache: jest.fn(),
    };

    mockElementClone = {
      cloneElement: jest.fn().mockReturnValue(createElement()),
    };

    mockNgZone = {
      runOutsideAngular: jest.fn((fn: () => void) => fn()),
    };

    mockEnvInjector = {};

    mockCallbacks = {
      onDragStart: jest.fn(),
      onDragEnd: jest.fn(),
      getParentDroppableId: jest.fn().mockReturnValue('list-1'),
      calculateSourceIndex: jest.fn().mockReturnValue(0),
    };

    mockContext = {
      element: createElement(),
      draggableId: 'item-1',
      groupName: 'test-group',
      data: { name: 'Test' },
    };

    afterNextRenderMock.mockClear();

    handler = new KeyboardDragHandler({
      dragState: mockDragState,
      keyboardDrag: mockKeyboardDrag,
      positionCalculator: mockPositionCalculator,
      dragIndexCalculator: mockDragIndexCalculator,
      elementClone: mockElementClone,
      overlayContainer: { hasTemplatePreview: jest.fn().mockReturnValue(false) },
      ngZone: mockNgZone,
      envInjector: mockEnvInjector,
      callbacks: mockCallbacks,
      getContext: () => mockContext,
    } as KeyboardDragDeps);
  });

  afterEach(() => {
    handler.destroy();
  });

  describe('isActive', () => {
    it('should delegate to keyboardDrag.isActive', () => {
      mockKeyboardDrag.isActive.mockReturnValue(false);
      expect(handler.isActive()).toBe(false);

      mockKeyboardDrag.isActive.mockReturnValue(true);
      expect(handler.isActive()).toBe(true);
    });
  });

  describe('activate', () => {
    it('should start a keyboard drag', () => {
      handler.activate();

      expect(mockElementClone.cloneElement).toHaveBeenCalledWith(mockContext.element);
      expect(mockKeyboardDrag.startKeyboardDrag).toHaveBeenCalledWith(
        expect.objectContaining({
          draggableId: 'item-1',
          droppableId: 'list-1',
          element: mockContext.element,
          height: 50,
          width: 200,
          data: { name: 'Test' },
        }),
        0, // sourceIndex
        5, // totalItemCount
        'list-1', // droppableId
      );
    });

    it('should skip cloning when a template-based preview is active', () => {
      const cloneSpy = jest.fn().mockReturnValue(createElement());
      const templateHandler = new KeyboardDragHandler({
        dragState: mockDragState,
        keyboardDrag: mockKeyboardDrag,
        positionCalculator: mockPositionCalculator,
        dragIndexCalculator: mockDragIndexCalculator,
        elementClone: { cloneElement: cloneSpy },
        overlayContainer: { hasTemplatePreview: jest.fn().mockReturnValue(true) },
        ngZone: mockNgZone,
        envInjector: mockEnvInjector,
        callbacks: mockCallbacks,
        getContext: () => mockContext,
      } as unknown as KeyboardDragDeps);

      templateHandler.activate();

      expect(cloneSpy).not.toHaveBeenCalled();
      expect(mockKeyboardDrag.startKeyboardDrag).toHaveBeenCalledWith(
        expect.objectContaining({ clonedElement: undefined }),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );

      templateHandler.destroy();
    });

    it('should emit drag start event', () => {
      handler.activate();

      expect(mockCallbacks.onDragStart).toHaveBeenCalledWith(
        expect.objectContaining({
          draggableId: 'item-1',
          droppableId: 'list-1',
          data: { name: 'Test' },
          position: { x: 100, y: 200 },
          sourceIndex: 0,
        }),
      );
    });

    it('should bail out if no group name', () => {
      mockContext.groupName = null;
      handler.activate();

      expect(mockKeyboardDrag.startKeyboardDrag).not.toHaveBeenCalled();
    });

    it('should bail out if no parent droppable', () => {
      mockPositionCalculator.getDroppableParent.mockReturnValue(null);
      handler.activate();

      expect(mockKeyboardDrag.startKeyboardDrag).not.toHaveBeenCalled();
    });

    it('should bail out if droppable has no ID', () => {
      mockPositionCalculator.getDroppableId.mockReturnValue(null);
      handler.activate();

      expect(mockKeyboardDrag.startKeyboardDrag).not.toHaveBeenCalled();
    });
  });

  describe('handleKey', () => {
    beforeEach(() => {
      mockKeyboardDrag.isActive.mockReturnValue(true);
    });

    const createKeyEvent = (key: string): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key });
      jest.spyOn(event, 'preventDefault');
      return event;
    };

    it('should return false when not active', () => {
      mockKeyboardDrag.isActive.mockReturnValue(false);
      const event = createKeyEvent('ArrowUp');
      expect(handler.handleKey(event)).toBe(false);
    });

    it('should handle Space key (complete)', () => {
      const event = createKeyEvent(' ');
      jest.spyOn(event, 'stopPropagation');
      const result = handler.handleKey(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      // Stops the same keydown from also reaching the element's host binding (double move)
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(mockKeyboardDrag.completeKeyboardDrag).toHaveBeenCalled();
    });

    it('should handle Enter key (complete)', () => {
      const event = createKeyEvent('Enter');
      const result = handler.handleKey(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockKeyboardDrag.completeKeyboardDrag).toHaveBeenCalled();
    });

    it('should handle Escape key (cancel)', () => {
      const event = createKeyEvent('Escape');
      const result = handler.handleKey(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockKeyboardDrag.cancelKeyboardDrag).toHaveBeenCalled();
    });

    it('should handle Tab key (cancel)', () => {
      const event = createKeyEvent('Tab');
      const result = handler.handleKey(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockKeyboardDrag.cancelKeyboardDrag).toHaveBeenCalled();
    });

    it('should handle ArrowUp key', () => {
      const event = createKeyEvent('ArrowUp');
      const result = handler.handleKey(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockKeyboardDrag.moveUp).toHaveBeenCalled();
    });

    it('should handle ArrowDown key', () => {
      const event = createKeyEvent('ArrowDown');
      const result = handler.handleKey(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockKeyboardDrag.moveDown).toHaveBeenCalled();
    });

    it('should handle ArrowLeft key (cross-list)', () => {
      const element = createElement();
      mockPositionCalculator.findAdjacentDroppable.mockReturnValue({ element, id: 'list-2' });
      mockDragIndexCalculator.getTotalItemCount.mockReturnValue(3);

      const event = createKeyEvent('ArrowLeft');
      const result = handler.handleKey(event);

      expect(result).toBe(true);
      expect(mockPositionCalculator.findAdjacentDroppable).toHaveBeenCalledWith(
        'list-1',
        'left',
        'test-group',
      );
      // The item count comes from DragIndexCalculatorService, not findAdjacentDroppable.
      expect(mockDragIndexCalculator.getTotalItemCount).toHaveBeenCalledWith(
        expect.objectContaining({ droppableElement: element }),
      );
      expect(mockKeyboardDrag.moveToDroppable).toHaveBeenCalledWith('list-2', 0, 3);
    });

    it('should handle ArrowRight key (cross-list)', () => {
      const element = createElement();
      mockPositionCalculator.findAdjacentDroppable.mockReturnValue({ element, id: 'list-2' });
      mockDragIndexCalculator.getTotalItemCount.mockReturnValue(3);

      const event = createKeyEvent('ArrowRight');
      const result = handler.handleKey(event);

      expect(result).toBe(true);
      expect(mockPositionCalculator.findAdjacentDroppable).toHaveBeenCalledWith(
        'list-1',
        'right',
        'test-group',
      );
      expect(mockKeyboardDrag.moveToDroppable).toHaveBeenCalledWith('list-2', 0, 3);
    });

    it('should return false for unhandled keys', () => {
      const event = createKeyEvent('a');
      const result = handler.handleKey(event);

      expect(result).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(mockKeyboardDrag.completeKeyboardDrag).not.toHaveBeenCalled();
      expect(mockKeyboardDrag.cancelKeyboardDrag).not.toHaveBeenCalled();
    });

    it('should clamp target index to new list size on cross-list move', () => {
      mockKeyboardDrag.targetIndex.mockReturnValue(10);
      const element = createElement();
      mockPositionCalculator.findAdjacentDroppable.mockReturnValue({ element, id: 'list-2' });
      mockDragIndexCalculator.getTotalItemCount.mockReturnValue(3);

      handler.handleKey(createKeyEvent('ArrowRight'));

      expect(mockKeyboardDrag.moveToDroppable).toHaveBeenCalledWith('list-2', 3, 3);
    });
  });

  describe('complete', () => {
    it('should emit drag end event with correct data', () => {
      mockDragState.sourceIndex.mockReturnValue(1);
      mockDragState.placeholderIndex.mockReturnValue(3);
      mockDragState.activeDroppableId.mockReturnValue('list-2');

      handler.complete();

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          draggableId: 'item-1',
          droppableId: 'list-1',
          cancelled: false,
          sourceIndex: 1,
          destinationIndex: 3,
        }),
      );
      expect(mockKeyboardDrag.completeKeyboardDrag).toHaveBeenCalled();
    });

    it('reports no destination when the active target was disabled mid-drag', () => {
      mockDragState.sourceIndex.mockReturnValue(1);
      mockDragState.placeholderIndex.mockReturnValue(3);
      mockDragState.activeDroppableId.mockReturnValue('list-2');
      // list-2 was disabled after the drag navigated into it.
      mockPositionCalculator.isDroppableDisabledById.mockReturnValue(true);

      handler.complete();

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          cancelled: false,
          destinationIndex: null,
        }),
      );
    });

    it('normalizes destination index for a same-list no-op drop', () => {
      mockDragState.sourceIndex.mockReturnValue(3);
      mockDragState.placeholderIndex.mockReturnValue(4);
      mockDragState.activeDroppableId.mockReturnValue('list-1');

      handler.complete();

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceIndex: 3,
          destinationIndex: 3,
        }),
      );
    });

    it('normalizes destination index for a same-list move down', () => {
      mockDragState.sourceIndex.mockReturnValue(1);
      mockDragState.placeholderIndex.mockReturnValue(4);
      mockDragState.activeDroppableId.mockReturnValue('list-1');

      handler.complete();

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceIndex: 1,
          destinationIndex: 3,
        }),
      );
    });

    it('keeps destination index for a same-list move up', () => {
      mockDragState.sourceIndex.mockReturnValue(3);
      mockDragState.placeholderIndex.mockReturnValue(1);
      mockDragState.activeDroppableId.mockReturnValue('list-1');

      handler.complete();

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceIndex: 3,
          destinationIndex: 1,
        }),
      );
    });

    it('keeps destination index for cross-list drops', () => {
      mockDragState.sourceIndex.mockReturnValue(1);
      mockDragState.placeholderIndex.mockReturnValue(4);
      mockDragState.activeDroppableId.mockReturnValue('list-2');

      handler.complete();

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceIndex: 1,
          destinationIndex: 4,
        }),
      );
    });

    it('restores focus when the draggable ID has selector-sensitive characters', () => {
      mockContext.draggableId = 'item-"quoted"\\[one]';
      const element = document.createElement('button');
      element.setAttribute('data-draggable-id', mockContext.draggableId);
      const focusSpy = jest.spyOn(element, 'focus');
      document.body.appendChild(element);

      handler.complete();

      const callback = afterNextRenderMock.mock.calls.at(-1)?.[0] as () => void;
      expect(() => callback()).not.toThrow();
      expect(focusSpy).toHaveBeenCalled();

      element.remove();
    });

    it('focuses the first destination draggable when destination ID has selector-sensitive characters', () => {
      const destinationId = 'list-"quoted"\\[one]';
      mockDragState.activeDroppableId.mockReturnValue(destinationId);
      mockContext.draggableId = 'missing-"quoted"\\[one]';

      const destination = document.createElement('div');
      destination.setAttribute('data-droppable-id', destinationId);
      const firstDraggable = document.createElement('button');
      firstDraggable.setAttribute('data-draggable-id', 'first');
      const focusSpy = jest.spyOn(firstDraggable, 'focus');
      destination.appendChild(firstDraggable);
      document.body.appendChild(destination);

      handler.complete();

      const callback = afterNextRenderMock.mock.calls.at(-1)?.[0] as () => void;
      expect(() => callback()).not.toThrow();
      expect(focusSpy).toHaveBeenCalled();

      destination.remove();
    });

    it('focuses the first destination draggable when the dropped item is not rendered', () => {
      // Dropped into list-2; the drop clears the drag state before the focus callback runs
      mockDragState.activeDroppableId.mockReturnValue('list-2');
      mockKeyboardDrag.completeKeyboardDrag.mockImplementation(() => {
        mockDragState.activeDroppableId.mockReturnValue(null);
        mockDragState.sourceDroppableId.mockReturnValue(null);
      });
      mockContext.draggableId = 'not-rendered';
      const createList = (id: string): HTMLButtonElement => {
        const list = document.createElement('div');
        list.setAttribute('data-droppable-id', id);
        const firstDraggable = document.createElement('button');
        firstDraggable.setAttribute('data-draggable-id', `${id}-first`);
        list.appendChild(firstDraggable);
        document.body.appendChild(list);
        return firstDraggable;
      };
      const sourceFirst = createList('list-1');
      const destinationFirst = createList('list-2');
      const sourceFocus = jest.spyOn(sourceFirst, 'focus');
      const destinationFocus = jest.spyOn(destinationFirst, 'focus');

      handler.complete();
      const callback = afterNextRenderMock.mock.calls.at(-1)?.[0] as () => void;
      callback();

      expect(destinationFocus).toHaveBeenCalled();
      expect(sourceFocus).not.toHaveBeenCalled();
      sourceFirst.parentElement?.remove();
      destinationFirst.parentElement?.remove();
    });
  });

  describe('cancel', () => {
    it('should emit drag end event with cancelled=true', () => {
      mockDragState.sourceIndex.mockReturnValue(1);

      handler.cancel();

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          draggableId: 'item-1',
          cancelled: true,
          destinationIndex: null,
        }),
      );
      expect(mockKeyboardDrag.cancelKeyboardDrag).toHaveBeenCalled();
    });
  });

  describe('cancel focus fallback', () => {
    it('focuses the first source draggable when the cancelled item is not rendered', () => {
      mockKeyboardDrag.isActive.mockReturnValue(true);
      mockDragState.activeDroppableId.mockReturnValue('list-2');
      mockKeyboardDrag.cancelKeyboardDrag.mockImplementation(() => {
        mockDragState.activeDroppableId.mockReturnValue(null);
        mockDragState.sourceDroppableId.mockReturnValue(null);
      });
      mockContext.draggableId = 'not-rendered';
      const createList = (id: string): HTMLButtonElement => {
        const list = document.createElement('div');
        list.setAttribute('data-droppable-id', id);
        const firstDraggable = document.createElement('button');
        firstDraggable.setAttribute('data-draggable-id', `${id}-first`);
        list.appendChild(firstDraggable);
        document.body.appendChild(list);
        return firstDraggable;
      };
      const sourceFirst = createList('list-1');
      const hoveredFirst = createList('list-2');
      const sourceFocus = jest.spyOn(sourceFirst, 'focus');
      const hoveredFocus = jest.spyOn(hoveredFirst, 'focus');

      handler.cancel();
      const callback = afterNextRenderMock.mock.calls.at(-1)?.[0] as () => void;
      callback();

      // A cancelled item goes back to its source list, not the list it was hovering
      expect(sourceFocus).toHaveBeenCalled();
      expect(hoveredFocus).not.toHaveBeenCalled();
      sourceFirst.parentElement?.remove();
      hoveredFirst.parentElement?.remove();
    });
  });

  describe('cross-list movement', () => {
    beforeEach(() => {
      mockKeyboardDrag.isActive.mockReturnValue(true);
    });

    it('should not move if no current droppable', () => {
      mockDragState.activeDroppableId.mockReturnValue(null);

      handler.handleKey(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));

      expect(mockPositionCalculator.findAdjacentDroppable).not.toHaveBeenCalled();
    });

    it('should not move if no group name', () => {
      mockContext.groupName = null;

      handler.handleKey(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));

      expect(mockPositionCalculator.findAdjacentDroppable).not.toHaveBeenCalled();
    });

    it('should not move if no adjacent droppable found', () => {
      mockPositionCalculator.findAdjacentDroppable.mockReturnValue(null);

      handler.handleKey(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));

      expect(mockKeyboardDrag.moveToDroppable).not.toHaveBeenCalled();
    });
  });

  describe('document listener lifecycle', () => {
    // The dragged element is hidden (display: none) during a keyboard drag, so keys must
    // reach the handler through the document listener that activate() installs.
    const pressOnDocument = (key: string): void => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    };

    beforeEach(() => {
      mockKeyboardDrag.isActive.mockReturnValue(true);
    });

    it('should not handle document keys before activation', () => {
      pressOnDocument('ArrowDown');

      expect(mockKeyboardDrag.moveDown).not.toHaveBeenCalled();
    });

    it('should handle document keys after activation', () => {
      handler.activate();

      pressOnDocument('ArrowDown');

      expect(mockKeyboardDrag.moveDown).toHaveBeenCalledTimes(1);
    });

    it('should stop handling document keys after complete', () => {
      handler.activate();
      handler.complete();

      pressOnDocument('ArrowDown');

      expect(mockKeyboardDrag.moveDown).not.toHaveBeenCalled();
    });

    it('should stop handling document keys after cancel', () => {
      handler.activate();
      handler.cancel();

      pressOnDocument('ArrowDown');

      expect(mockKeyboardDrag.moveDown).not.toHaveBeenCalled();
    });

    it('should stop handling document keys after destroy', () => {
      handler.activate();
      handler.destroy();

      pressOnDocument('ArrowDown');

      expect(mockKeyboardDrag.moveDown).not.toHaveBeenCalled();
    });
  });

  // Issue #25: cross-list keyboard navigation must derive the destination list's item count
  // through DragIndexCalculatorService (the single source of truth), not the duplicated
  // spacer/itemHeight division that mis-counted dynamic-height and vdnd-virtual-content lists.
  describe('cross-list item counting (issue #25)', () => {
    const created: HTMLElement[] = [];
    let realPositionCalc: PositionCalculatorService;
    let realIndexCalc: DragIndexCalculatorService;
    let localHandler: KeyboardDragHandler;

    function stubRect(el: HTMLElement, left: number): void {
      el.getBoundingClientRect = () =>
        ({
          top: 0,
          left,
          right: left + 100,
          bottom: 100,
          width: 100,
          height: 100,
          x: left,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    }

    function makeDroppable(id: string, left: number): HTMLElement {
      const el = document.createElement('div');
      el.setAttribute('data-droppable-id', id);
      el.setAttribute('data-droppable-group', 'test-group');
      stubRect(el, left);
      document.body.appendChild(el);
      created.push(el);
      return el;
    }

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [PositionCalculatorService, DragIndexCalculatorService],
      });
      realPositionCalc = TestBed.inject(PositionCalculatorService);
      realIndexCalc = TestBed.inject(DragIndexCalculatorService);

      mockKeyboardDrag.isActive.mockReturnValue(true);
      // Large current target index so the clamp lands exactly on the list's item count.
      mockKeyboardDrag.targetIndex.mockReturnValue(100);
      mockDragState.activeDroppableId.mockReturnValue('source-list');

      localHandler = new KeyboardDragHandler({
        dragState: mockDragState,
        keyboardDrag: mockKeyboardDrag,
        positionCalculator: realPositionCalc,
        dragIndexCalculator: realIndexCalc,
        elementClone: mockElementClone,
        overlayContainer: { hasTemplatePreview: jest.fn().mockReturnValue(false) },
        ngZone: mockNgZone,
        envInjector: mockEnvInjector,
        callbacks: mockCallbacks,
        getContext: () => ({ ...mockContext, groupName: 'test-group' }),
      } as KeyboardDragDeps);

      // Source list on the left so the target is the right-hand neighbour.
      makeDroppable('source-list', 0);
    });

    afterEach(() => {
      localHandler.destroy();
      created.forEach((el) => el.remove());
      created.length = 0;
    });

    it('clamps to the true item count for a dynamic-height list, not spacer/itemHeight division', () => {
      // Models a dynamic-height list: it publishes its true N via data-total-items (12) while
      // data-item-height is only a nominal estimate. The old duplicated logic ignored
      // data-total-items and divided spacer height (900) by data-item-height (50) = 18, which
      // overshoots when rows vary in height. The fix reads data-total-items instead.
      const target = makeDroppable('dynamic-list', 200);
      const virtualScroll = document.createElement('vdnd-virtual-scroll');
      virtualScroll.setAttribute('data-item-height', '50');
      virtualScroll.setAttribute('data-total-items', '12');
      const spacer = document.createElement('div');
      spacer.className = 'vdnd-virtual-scroll-spacer';
      spacer.style.height = '900px';
      virtualScroll.appendChild(spacer);
      target.appendChild(virtualScroll);

      localHandler.handleKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

      expect(mockKeyboardDrag.moveToDroppable).toHaveBeenCalledWith('dynamic-list', 12, 12);
    });

    it('clamps to the true item count for a vdnd-virtual-content list, not the rendered DOM count', () => {
      // True N = 20 (data-total-items), but only 4 items are rendered in the virtual window.
      const target = document.createElement('vdnd-virtual-content');
      target.setAttribute('data-droppable-id', 'content-list');
      target.setAttribute('data-droppable-group', 'test-group');
      target.setAttribute('data-item-height', '40');
      target.setAttribute('data-total-items', '20');
      stubRect(target, 200);
      for (let i = 0; i < 4; i++) {
        const child = document.createElement('div');
        child.setAttribute('data-draggable-id', `rendered-${i}`);
        target.appendChild(child);
      }
      document.body.appendChild(target);
      created.push(target);

      localHandler.handleKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

      expect(mockKeyboardDrag.moveToDroppable).toHaveBeenCalledWith('content-list', 20, 20);
    });
  });
});
