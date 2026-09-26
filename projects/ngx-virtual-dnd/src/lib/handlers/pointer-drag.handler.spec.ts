/* eslint-disable @typescript-eslint/no-explicit-any */
import { PointerDragHandler, PointerDragCallbacks, PointerDragDeps } from './pointer-drag.handler';

describe('PointerDragHandler', () => {
  let handler: PointerDragHandler;
  let mockNgZone: any;
  let mockCallbacks: PointerDragCallbacks;
  let mockContext: any;
  let isDragging: boolean;
  let otherDragActive: boolean;

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

  /** Create a MouseEvent with a real target element (JSDOM requires this). */
  const createMouseEvent = (
    type: string,
    x: number,
    y: number,
    button = 0,
    target?: HTMLElement,
  ): MouseEvent => {
    const event = new MouseEvent(type, {
      clientX: x,
      clientY: y,
      button,
      bubbles: true,
      cancelable: true,
    });
    if (target) {
      Object.defineProperty(event, 'target', { value: target });
    }
    return event;
  };

  /** Create a MouseEvent whose target is the draggable element itself. */
  const createMouseDown = (x: number, y: number, button = 0): MouseEvent =>
    createMouseEvent('mousedown', x, y, button, mockContext.element);

  const createTouchEvent = (
    type: string,
    x: number,
    y: number,
    target?: HTMLElement,
  ): TouchEvent => {
    const touch = { clientX: x, clientY: y } as Touch;
    const event = new TouchEvent(type, {
      touches: type === 'touchend' ? [] : [touch],
      changedTouches: [touch],
      bubbles: true,
      cancelable: true,
    });
    if (target) {
      Object.defineProperty(event, 'target', { value: target });
    }
    return event;
  };

  /** Create a TouchEvent whose target is the draggable element itself. */
  const createTouchStart = (x: number, y: number): TouchEvent =>
    createTouchEvent('touchstart', x, y, mockContext.element);

  beforeEach(() => {
    isDragging = false;
    otherDragActive = false;

    mockNgZone = {
      runOutsideAngular: jest.fn((fn: () => void) => fn()),
    };

    mockCallbacks = {
      onDragStart: jest.fn(() => {
        isDragging = true;
      }),
      onDragMove: jest.fn(),
      onDragEnd: jest.fn(() => {
        isDragging = false;
      }),
      onPendingChange: jest.fn(),
      isDragging: jest.fn(() => isDragging),
      isOtherDragActive: jest.fn(() => otherDragActive),
    };

    mockContext = {
      element: createElement(),
      groupName: 'test-group',
      disabled: false,
      dragHandle: undefined,
      dragThreshold: 5,
      dragDelay: 0,
    };

    handler = new PointerDragHandler({
      ngZone: mockNgZone,
      callbacks: mockCallbacks,
      getContext: () => mockContext,
    } as PointerDragDeps);
  });

  afterEach(() => {
    handler.destroy();
    jest.restoreAllMocks();
  });

  describe('onPointerDown', () => {
    it('should ignore if disabled', () => {
      const addSpy = jest.spyOn(document, 'addEventListener');
      mockContext.disabled = true;

      handler.onPointerDown(createMouseDown(150, 220), false);

      expect(addSpy).not.toHaveBeenCalled();
    });

    it('should ignore if no group name', () => {
      const addSpy = jest.spyOn(document, 'addEventListener');
      mockContext.groupName = null;

      handler.onPointerDown(createMouseDown(150, 220), false);

      expect(addSpy).not.toHaveBeenCalled();
    });

    it('should ignore non-left mouse clicks', () => {
      const addSpy = jest.spyOn(document, 'addEventListener');

      handler.onPointerDown(createMouseDown(150, 220, 2), false);

      expect(addSpy).not.toHaveBeenCalled();
    });

    it('should add document listeners for mouse events', () => {
      const addSpy = jest.spyOn(document, 'addEventListener');

      handler.onPointerDown(createMouseDown(150, 220), false);

      expect(addSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('should add document listeners for touch events', () => {
      const addSpy = jest.spyOn(document, 'addEventListener');

      handler.onPointerDown(createTouchStart(150, 220), true);

      expect(addSpy).toHaveBeenCalledWith(
        'touchmove',
        expect.any(Function),
        expect.objectContaining({ passive: false }),
      );
      expect(addSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('touchcancel', expect.any(Function));
    });

    it('should prevent default for mouse events', () => {
      const event = createMouseDown(150, 220);
      const preventSpy = jest.spyOn(event, 'preventDefault');

      handler.onPointerDown(event, false);

      expect(preventSpy).toHaveBeenCalled();
    });

    it('should NOT prevent default for touch events with delay', () => {
      mockContext.dragDelay = 200;
      const event = createTouchStart(150, 220);
      const preventSpy = jest.spyOn(event, 'preventDefault');

      handler.onPointerDown(event, true);

      expect(preventSpy).not.toHaveBeenCalled();
    });

    it('should prevent default for touch events without delay', () => {
      const event = createTouchStart(150, 220);
      const preventSpy = jest.spyOn(event, 'preventDefault');

      handler.onPointerDown(event, true);

      expect(preventSpy).toHaveBeenCalled();
    });

    it('should store start position', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);

      expect(handler.getStartPosition()).toEqual({ x: 150, y: 220 });
    });

    it('should ignore clicks on interactive elements', () => {
      const addSpy = jest.spyOn(document, 'addEventListener');
      const button = document.createElement('button');
      mockContext.element.appendChild(button);

      const event = new MouseEvent('mousedown', {
        clientX: 150,
        clientY: 220,
        button: 0,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'target', { value: button });

      handler.onPointerDown(event, false);

      expect(addSpy).not.toHaveBeenCalledWith('mousemove', expect.any(Function));
    });

    it('should ignore clicks on no-drag class elements', () => {
      const addSpy = jest.spyOn(document, 'addEventListener');
      const noDragEl = document.createElement('div');
      noDragEl.classList.add('no-drag');
      mockContext.element.appendChild(noDragEl);

      const event = new MouseEvent('mousedown', {
        clientX: 150,
        clientY: 220,
        button: 0,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'target', { value: noDragEl });

      handler.onPointerDown(event, false);

      expect(addSpy).not.toHaveBeenCalledWith('mousemove', expect.any(Function));
    });

    it('should ignore presses on elements inside a no-drag element', () => {
      const addSpy = jest.spyOn(document, 'addEventListener');
      const noDragEl = document.createElement('div');
      noDragEl.classList.add('no-drag');
      const label = document.createElement('span');
      noDragEl.appendChild(label);
      mockContext.element.appendChild(noDragEl);

      handler.onPointerDown(createMouseEvent('mousedown', 150, 220, 0, label), false);

      expect(addSpy).not.toHaveBeenCalledWith('mousemove', expect.any(Function));
    });

    it('should ignore touches on an SVG icon inside a no-drag element', () => {
      const addSpy = jest.spyOn(document, 'addEventListener');
      const noDragEl = document.createElement('div');
      noDragEl.classList.add('no-drag');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      icon.appendChild(path);
      noDragEl.appendChild(icon);
      mockContext.element.appendChild(noDragEl);

      const event = createTouchEvent('touchstart', 150, 220);
      Object.defineProperty(event, 'target', { value: path });
      handler.onPointerDown(event, true);

      expect(addSpy).not.toHaveBeenCalledWith('touchmove', expect.any(Function), expect.anything());
    });

    it('should ignore presses anywhere inside a draggable that carries no-drag itself', () => {
      const addSpy = jest.spyOn(document, 'addEventListener');
      mockContext.element.classList.add('no-drag');
      const content = document.createElement('span');
      mockContext.element.appendChild(content);

      handler.onPointerDown(createMouseEvent('mousedown', 150, 220, 0, content), false);

      expect(addSpy).not.toHaveBeenCalledWith('mousemove', expect.any(Function));
    });

    it('should start tracking when the no-drag element is an ancestor of the draggable', () => {
      const addSpy = jest.spyOn(document, 'addEventListener');
      const outer = document.createElement('div');
      outer.classList.add('no-drag');
      outer.appendChild(mockContext.element);
      const content = document.createElement('span');
      mockContext.element.appendChild(content);

      handler.onPointerDown(createMouseEvent('mousedown', 150, 220, 0, content), false);

      expect(addSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    });

    it('should ignore pointer down outside the drag handle', () => {
      const addSpy = jest.spyOn(document, 'addEventListener');
      mockContext.dragHandle = '.handle';
      const contentEl = document.createElement('span');
      contentEl.className = 'content';
      mockContext.element.appendChild(contentEl);

      handler.onPointerDown(createMouseEvent('mousedown', 150, 220, 0, contentEl), false);

      expect(addSpy).not.toHaveBeenCalledWith('mousemove', expect.any(Function));
    });

    it('should start tracking on pointer down inside the drag handle', () => {
      mockContext.dragHandle = '.handle';
      const handleEl = document.createElement('span');
      handleEl.className = 'handle';
      const handleIcon = document.createElement('i');
      handleEl.appendChild(handleIcon);
      mockContext.element.appendChild(handleEl);

      handler.onPointerDown(createMouseEvent('mousedown', 150, 220, 0, handleIcon), false);
      document.dispatchEvent(createMouseEvent('mousemove', 160, 220));

      expect(mockCallbacks.onDragStart).toHaveBeenCalledWith({ x: 160, y: 220 });
    });
  });

  describe('threshold detection', () => {
    it('should not start drag when movement is below threshold', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);

      // Move less than threshold (5px)
      document.dispatchEvent(createMouseEvent('mousemove', 152, 221));

      expect(mockCallbacks.onDragStart).not.toHaveBeenCalled();
    });

    it('should start drag when movement exceeds threshold', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);

      // Move more than threshold (5px)
      document.dispatchEvent(createMouseEvent('mousemove', 160, 220));

      expect(mockCallbacks.onDragStart).toHaveBeenCalledWith({ x: 160, y: 220 });
    });
  });

  describe('another drag in progress', () => {
    it('should ignore a press while another drag is active', () => {
      const addSpy = jest.spyOn(document, 'addEventListener');
      otherDragActive = true;

      handler.onPointerDown(createMouseDown(150, 220), false);

      expect(addSpy).not.toHaveBeenCalled();
      expect(handler.getStartPosition()).toBeNull();
    });

    it('should keep a rejected mouse press from moving focus or selecting text', () => {
      otherDragActive = true;
      const event = createMouseDown(150, 220);

      handler.onPointerDown(event, false);

      // Focusing this item mid-drag would route the next key (Space) to the wrong draggable
      expect(event.defaultPrevented).toBe(true);
    });

    it('should leave a rejected touch alone when a drag delay lets the page scroll', () => {
      otherDragActive = true;
      mockContext.dragDelay = 200;
      const event = createTouchStart(150, 220);

      handler.onPointerDown(event, true);

      expect(event.defaultPrevented).toBe(false);
    });

    it('should let a press on a control in another item focus it as usual', () => {
      otherDragActive = true;
      const input = document.createElement('input');
      mockContext.element.appendChild(input);
      const event = createMouseEvent('mousedown', 150, 220, 0, input);

      handler.onPointerDown(event, false);

      expect(event.defaultPrevented).toBe(false);
    });

    it('should drop a pending press instead of marking it ready when another drag started', () => {
      jest.useFakeTimers();
      try {
        mockContext.dragDelay = 200;
        handler.onPointerDown(createTouchStart(150, 220), true);
        otherDragActive = true;

        jest.advanceTimersByTime(200);

        expect(mockCallbacks.onPendingChange).not.toHaveBeenCalledWith(true);
        expect(handler.getStartPosition()).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('should drop a pending press when another drag starts before the threshold is crossed', () => {
      const removeSpy = jest.spyOn(document, 'removeEventListener');
      handler.onPointerDown(createTouchStart(150, 220), true);
      otherDragActive = true;

      const move = createTouchEvent('touchmove', 160, 220);
      document.dispatchEvent(move);

      expect(mockCallbacks.onDragStart).not.toHaveBeenCalled();
      expect(mockCallbacks.onDragMove).not.toHaveBeenCalled();
      expect(handler.getStartPosition()).toBeNull();
      expect(removeSpy).toHaveBeenCalledWith('touchmove', expect.any(Function));
      // The other drag owns the gesture: leave its touchmove alone
      expect(move.defaultPrevented).toBe(false);
    });
  });

  describe('drag delay', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      mockContext.dragDelay = 200;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should cancel drag if moved before delay fires', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);

      // Move past threshold before delay fires
      document.dispatchEvent(createMouseEvent('mousemove', 160, 220));

      // The attempt is abandoned: neither the delay nor later moves revive it
      jest.advanceTimersByTime(200);
      document.dispatchEvent(createMouseEvent('mousemove', 170, 220));

      expect(mockCallbacks.onDragStart).not.toHaveBeenCalled();
      expect(mockCallbacks.onPendingChange).not.toHaveBeenCalledWith(true);
    });

    it('should not mark the item pending after a repeated press is released', () => {
      // A second press (e.g. another finger) before the first delay fires, then release:
      // no timer of the abandoned gesture may fire afterwards.
      handler.onPointerDown(createTouchStart(150, 220), true);
      jest.advanceTimersByTime(100);
      handler.onPointerDown(createTouchStart(150, 220), true);
      document.dispatchEvent(createTouchEvent('touchend', 150, 220));

      jest.advanceTimersByTime(200);

      expect(mockCallbacks.onPendingChange).not.toHaveBeenCalledWith(true);
    });

    it('should emit pending change when delay fires', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);

      jest.advanceTimersByTime(200);

      expect(mockCallbacks.onPendingChange).toHaveBeenCalledWith(true);
    });

    it('should start drag after delay fires and movement exceeds threshold', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);

      jest.advanceTimersByTime(200);

      // Move past threshold after delay
      document.dispatchEvent(createMouseEvent('mousemove', 160, 220));

      expect(mockCallbacks.onDragStart).toHaveBeenCalledWith({ x: 160, y: 220 });
    });
  });

  describe('drag move notification', () => {
    it('should call onDragMove directly on each pointer move while dragging', () => {
      // The handler no longer owns a RAF — it calls onDragMove synchronously so that
      // DragSchedulerService can coalesce multiple moves into one RAF per frame.
      handler.onPointerDown(createMouseDown(150, 220), false);

      // Trigger drag start
      document.dispatchEvent(createMouseEvent('mousemove', 160, 220));
      expect(mockCallbacks.onDragStart).toHaveBeenCalled();

      // Subsequent move — onDragMove is called directly (no RAF in the handler)
      document.dispatchEvent(createMouseEvent('mousemove', 170, 230));
      expect(mockCallbacks.onDragMove).toHaveBeenCalledWith({ x: 170, y: 230 });
    });

    it('should call onDragMove on every move event (RAF coalescing is done by DragSchedulerService)', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);
      // Move 1 triggers drag start AND the first onDragMove (position is now dragging)
      document.dispatchEvent(createMouseEvent('mousemove', 160, 220));
      // Moves 2 and 3 each produce a direct onDragMove call
      document.dispatchEvent(createMouseEvent('mousemove', 170, 230));
      document.dispatchEvent(createMouseEvent('mousemove', 180, 240));

      expect(mockCallbacks.onDragMove).toHaveBeenCalledTimes(3);
      expect(mockCallbacks.onDragMove).toHaveBeenLastCalledWith({ x: 180, y: 240 });
    });
  });

  describe('pointer up', () => {
    it('should stop tracking moves after pointer up', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);
      document.dispatchEvent(createMouseEvent('mouseup', 150, 220));

      document.dispatchEvent(createMouseEvent('mousemove', 200, 220));

      expect(mockCallbacks.onDragStart).not.toHaveBeenCalled();
    });

    it('should end drag on pointer up while dragging', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);

      // Start drag
      document.dispatchEvent(createMouseEvent('mousemove', 160, 220));

      // Pointer up
      document.dispatchEvent(createMouseEvent('mouseup', 160, 220));

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(false);
    });

    it('should cancel a touch drag when the touch is cancelled', () => {
      handler.onPointerDown(createTouchStart(150, 220), true);
      document.dispatchEvent(createTouchEvent('touchmove', 150, 240));

      const cancel = new TouchEvent('touchcancel', {
        touches: [],
        changedTouches: [{ clientX: 150, clientY: 240 } as Touch],
        bubbles: true,
      });
      document.dispatchEvent(cancel);

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(true);
    });

    it('should drop a pending touch press quietly when the touch is cancelled', () => {
      handler.onPointerDown(createTouchStart(150, 220), true);

      document.dispatchEvent(
        new TouchEvent('touchcancel', {
          touches: [],
          changedTouches: [{ clientX: 150, clientY: 220 } as Touch],
          bubbles: true,
        }),
      );
      document.dispatchEvent(createTouchEvent('touchmove', 150, 260));

      expect(mockCallbacks.onDragEnd).not.toHaveBeenCalled();
      expect(mockCallbacks.onDragStart).not.toHaveBeenCalled();
    });

    it('should not end drag on pointer up if not dragging', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);

      // Pointer up without moving past threshold
      document.dispatchEvent(createMouseEvent('mouseup', 150, 220));

      expect(mockCallbacks.onDragEnd).not.toHaveBeenCalled();
    });
  });

  describe('multi-touch', () => {
    interface TouchPoint {
      id: number;
      x: number;
      y: number;
    }

    /** A touch event listing `touches` (all fingers down) and `changed` (the ones it is about). */
    const multiTouch = (type: string, touches: TouchPoint[], changed: TouchPoint[]): TouchEvent => {
      const toTouch = ({ id, x, y }: TouchPoint) =>
        ({ identifier: id, clientX: x, clientY: y, target: mockContext.element }) as Touch;
      const event = new TouchEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches.map(toTouch) });
      Object.defineProperty(event, 'changedTouches', { value: changed.map(toTouch) });
      Object.defineProperty(event, 'target', { value: mockContext.element });
      return event;
    };

    const dragFinger = { id: 7, x: 150, y: 220 };
    const otherFinger = { id: 3, x: 400, y: 600 };

    /** Press with `dragFinger` and move it past the threshold to start the drag. */
    const startTouchDrag = (): void => {
      handler.onPointerDown(multiTouch('touchstart', [dragFinger], [dragFinger]), true);
      const moved = { ...dragFinger, y: 240 };
      document.dispatchEvent(multiTouch('touchmove', [moved], [moved]));
      expect(mockCallbacks.onDragStart).toHaveBeenCalledWith({ x: 150, y: 240 });
    };

    it('should not start the drag when only another finger moves', () => {
      handler.onPointerDown(multiTouch('touchstart', [dragFinger], [dragFinger]), true);

      // The other finger comes first in the list and moves far past the threshold
      const otherMoved = { ...otherFinger, y: 700 };
      document.dispatchEvent(multiTouch('touchmove', [otherMoved, dragFinger], [otherMoved]));

      expect(mockCallbacks.onDragStart).not.toHaveBeenCalled();
    });

    it('should follow the finger that started the drag, not the first one in the list', () => {
      startTouchDrag();

      const moved = { ...dragFinger, x: 180, y: 260 };
      document.dispatchEvent(multiTouch('touchmove', [otherFinger, moved], [otherFinger, moved]));

      expect(mockCallbacks.onDragMove).toHaveBeenLastCalledWith({ x: 180, y: 260 });
      expect(mockCallbacks.onDragMove).not.toHaveBeenCalledWith({ x: 400, y: 600 });
    });

    it('should keep dragging when another finger lifts', () => {
      startTouchDrag();

      document.dispatchEvent(multiTouch('touchend', [dragFinger], [otherFinger]));

      expect(mockCallbacks.onDragEnd).not.toHaveBeenCalled();
      const moved = { ...dragFinger, y: 300 };
      document.dispatchEvent(multiTouch('touchmove', [moved], [moved]));
      expect(mockCallbacks.onDragMove).toHaveBeenLastCalledWith({ x: 150, y: 300 });
    });

    it('should drop when the finger that started the drag lifts', () => {
      startTouchDrag();

      document.dispatchEvent(multiTouch('touchend', [otherFinger], [dragFinger]));

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(false);
    });

    it("should keep another finger's move from scrolling the page during the drag", () => {
      startTouchDrag();

      const otherMoved = { ...otherFinger, y: 650 };
      const move = multiTouch('touchmove', [otherMoved, { ...dragFinger, y: 240 }], [otherMoved]);
      document.dispatchEvent(move);

      expect(move.defaultPrevented).toBe(true);
    });

    it('should let another finger scroll the page while a delayed press is pending', () => {
      mockContext.dragDelay = 200;
      handler.onPointerDown(multiTouch('touchstart', [dragFinger], [dragFinger]), true);

      const otherMoved = { ...otherFinger, y: 650 };
      const move = multiTouch('touchmove', [otherMoved, dragFinger], [otherMoved]);
      document.dispatchEvent(move);

      expect(move.defaultPrevented).toBe(false);
      expect(mockCallbacks.onDragStart).not.toHaveBeenCalled();
    });

    it('should follow the finger on the draggable when several touches start at once', () => {
      const elsewhere = document.createElement('div');
      const toTouch = ({ id, x, y }: TouchPoint, target: Element) =>
        ({ identifier: id, clientX: x, clientY: y, target }) as unknown as Touch;
      const start = new TouchEvent('touchstart', { bubbles: true, cancelable: true });
      const started = [toTouch(otherFinger, elsewhere), toTouch(dragFinger, mockContext.element)];
      Object.defineProperty(start, 'touches', { value: started });
      Object.defineProperty(start, 'changedTouches', { value: started });
      Object.defineProperty(start, 'target', { value: mockContext.element });

      handler.onPointerDown(start, true);

      expect(handler.getStartPosition()).toEqual({ x: dragFinger.x, y: dragFinger.y });
    });

    it('should keep following the first finger when a second one lands on the same item', () => {
      handler.onPointerDown(multiTouch('touchstart', [dragFinger], [dragFinger]), true);
      const second = { id: 9, x: 160, y: 230 };
      // The browser lists the new finger first
      handler.onPointerDown(multiTouch('touchstart', [second, dragFinger], [second]), true);
      expect(handler.getStartPosition()).toEqual({ x: dragFinger.x, y: dragFinger.y });

      const moved = { ...dragFinger, y: 260 };
      document.dispatchEvent(multiTouch('touchmove', [second, moved], [moved]));

      expect(mockCallbacks.onDragStart).toHaveBeenCalledWith({ x: 150, y: 260 });
    });

    it('should end the gesture on any release when touches carry no identifier', () => {
      // Malformed synthetic events: the press and the release list touches without identifiers
      const touch = { clientX: 150, clientY: 220 };
      const start = new TouchEvent('touchstart', { bubbles: true, cancelable: true });
      Object.defineProperty(start, 'touches', { value: [touch] });
      Object.defineProperty(start, 'changedTouches', { value: [touch] });
      Object.defineProperty(start, 'target', { value: mockContext.element });
      handler.onPointerDown(start, true);
      document.dispatchEvent(createTouchEvent('touchmove', 150, 260));

      const end = new TouchEvent('touchend', { bubbles: true, cancelable: true });
      Object.defineProperty(end, 'touches', { value: [touch] });
      Object.defineProperty(end, 'changedTouches', { value: undefined });
      document.dispatchEvent(end);

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(false);
    });

    it('should not throw on synthetic touch events without changedTouches', () => {
      const start = new TouchEvent('touchstart', { bubbles: true, cancelable: true });
      Object.defineProperty(start, 'touches', { value: [{ clientX: 150, clientY: 220 }] });
      Object.defineProperty(start, 'changedTouches', { value: undefined });
      Object.defineProperty(start, 'target', { value: mockContext.element });
      const move = new TouchEvent('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(move, 'touches', { value: [{ clientX: 150, clientY: 260 }] });
      Object.defineProperty(move, 'changedTouches', { value: undefined });
      const end = new TouchEvent('touchend', { bubbles: true, cancelable: true });
      Object.defineProperty(end, 'touches', { value: [] });
      Object.defineProperty(end, 'changedTouches', { value: undefined });

      expect(() => {
        handler.onPointerDown(start, true);
        document.dispatchEvent(move);
        document.dispatchEvent(end);
      }).not.toThrow();
      expect(mockCallbacks.onDragStart).toHaveBeenCalledWith({ x: 150, y: 260 });
      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(false);
    });

    it('should keep the drag when another finger is cancelled', () => {
      startTouchDrag();

      document.dispatchEvent(multiTouch('touchcancel', [dragFinger], [otherFinger]));

      expect(mockCallbacks.onDragEnd).not.toHaveBeenCalled();
    });

    it('should cancel the drag, not drop, when the dragging finger is cancelled', () => {
      startTouchDrag();

      // The system took the touch (an incoming call, an OS gesture): the user never released
      document.dispatchEvent(multiTouch('touchcancel', [otherFinger], [dragFinger]));

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(true);
    });

    it('should drop when the dragging finger lifts while another is down', () => {
      startTouchDrag();

      document.dispatchEvent(multiTouch('touchend', [otherFinger], [dragFinger]));

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(false);
    });
  });

  describe('escape key cancellation', () => {
    it('should cancel drag on Escape key', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);

      // Start drag
      document.dispatchEvent(createMouseEvent('mousemove', 160, 220));

      // Press Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(true);
    });

    it('should ignore non-Escape keys', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);

      // Start drag
      document.dispatchEvent(createMouseEvent('mousemove', 160, 220));

      // Press a non-Escape key
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

      // Should not have called onDragEnd yet (only onDragStart)
      expect(mockCallbacks.onDragEnd).not.toHaveBeenCalled();
    });
  });

  describe('focus loss', () => {
    const setVisibility = (state: DocumentVisibilityState): void => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };

    afterEach(() => {
      // Restore jsdom's own getter
      delete (document as unknown as Record<string, unknown>)['visibilityState'];
    });

    it('should cancel the drag when the window loses focus', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);
      document.dispatchEvent(createMouseEvent('mousemove', 160, 220));

      window.dispatchEvent(new Event('blur'));

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(true);
      expect(handler.getStartPosition()).toBeNull();
    });

    it('should cancel a touch drag when the page is hidden', () => {
      handler.onPointerDown(createTouchStart(150, 220), true);
      document.dispatchEvent(createTouchEvent('touchmove', 150, 240));

      setVisibility('hidden');

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(true);
    });

    it('should keep the drag when the page becomes visible', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);
      document.dispatchEvent(createMouseEvent('mousemove', 160, 220));

      setVisibility('visible');

      expect(mockCallbacks.onDragEnd).not.toHaveBeenCalled();
      expect(isDragging).toBe(true);
    });

    it('should drop a pending press without ending a drag when the window loses focus', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);

      window.dispatchEvent(new Event('blur'));
      document.dispatchEvent(createMouseEvent('mousemove', 160, 220));

      expect(mockCallbacks.onDragEnd).not.toHaveBeenCalled();
      expect(mockCallbacks.onDragStart).not.toHaveBeenCalled();
    });

    it('should stop listening for focus loss once the drag has ended', () => {
      const windowAddSpy = jest.spyOn(window, 'addEventListener');
      const documentAddSpy = jest.spyOn(document, 'addEventListener');
      const windowRemoveSpy = jest.spyOn(window, 'removeEventListener');
      const documentRemoveSpy = jest.spyOn(document, 'removeEventListener');
      handler.onPointerDown(createMouseDown(150, 220), false);
      document.dispatchEvent(createMouseEvent('mousemove', 160, 220));
      document.dispatchEvent(createMouseEvent('mouseup', 160, 220));

      window.dispatchEvent(new Event('blur'));
      setVisibility('hidden');

      expect(mockCallbacks.onDragEnd).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.onDragEnd).toHaveBeenCalledWith(false);
      const blurListener = windowAddSpy.mock.calls.find(([type]) => type === 'blur')?.[1];
      const visibilityListener = documentAddSpy.mock.calls.find(
        ([type]) => type === 'visibilitychange',
      )?.[1];
      expect(blurListener).toEqual(expect.any(Function));
      expect(visibilityListener).toEqual(expect.any(Function));
      expect(windowRemoveSpy).toHaveBeenCalledWith('blur', blurListener);
      expect(documentRemoveSpy).toHaveBeenCalledWith('visibilitychange', visibilityListener);
    });
  });

  describe('cleanup', () => {
    it('should remove all document listeners', () => {
      const removeSpy = jest.spyOn(document, 'removeEventListener');

      handler.onPointerDown(createMouseDown(150, 220), false);
      handler.cleanup();

      expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('should reset start position', () => {
      handler.onPointerDown(createMouseDown(150, 220), false);
      expect(handler.getStartPosition()).toEqual({ x: 150, y: 220 });

      handler.cleanup();
      expect(handler.getStartPosition()).toBeNull();
    });

    it('should clear pending state', () => {
      handler.cleanup();
      expect(mockCallbacks.onPendingChange).toHaveBeenCalledWith(false);
    });
  });

  describe('destroy', () => {
    it('should call cleanup', () => {
      const removeSpy = jest.spyOn(document, 'removeEventListener');

      handler.onPointerDown(createMouseDown(150, 220), false);
      handler.destroy();

      expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    });
  });

  describe('getStartPosition', () => {
    it('should return null before any pointer down', () => {
      expect(handler.getStartPosition()).toBeNull();
    });

    it('should return correct position for touch events', () => {
      handler.onPointerDown(createTouchStart(100, 300), true);
      expect(handler.getStartPosition()).toEqual({ x: 100, y: 300 });
    });
  });
});
