import { TestBed } from '@angular/core/testing';
import { AutoScrollService, AutoScrollConfig } from './auto-scroll.service';
import { DragStateService } from './drag-state.service';
import { PositionCalculatorService } from './position-calculator.service';
import { DragSchedulerService } from './drag-scheduler.service';

/**
 * Mock requestAnimationFrame to give synchronous control of the tick loop.
 * AutoScrollService no longer owns its RAF loop — DragSchedulerService does.
 * Tests drive ticks by:
 *   1. Calling startMonitoringWithScheduler() (starts scheduler + registers participant).
 *   2. Calling flushRAF() to fire the scheduler's RAF, which in turn calls the participant.
 */
let rafCallbacks = new Map<number, FrameRequestCallback>();
let rafIdCounter = 0;

function mockRAF(cb: FrameRequestCallback): number {
  const id = ++rafIdCounter;
  rafCallbacks.set(id, cb);
  return id;
}

function mockCancelRAF(id: number): void {
  rafCallbacks.delete(id);
}

function flushRAF(): void {
  // Drain the current batch (callbacks may schedule new ones)
  const batch = new Map(rafCallbacks);
  rafCallbacks.clear();
  for (const cb of batch.values()) {
    cb(performance.now());
  }
}

describe('AutoScrollService', () => {
  let service: AutoScrollService;
  let scheduler: DragSchedulerService;
  let dragStateService: DragStateService;
  let mockElement: HTMLElement;

  // Save originals
  const originalRAF = globalThis.requestAnimationFrame;
  const originalCancelRAF = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    // Install RAF mock
    rafCallbacks = new Map();
    rafIdCounter = 0;
    globalThis.requestAnimationFrame = mockRAF as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = mockCancelRAF;

    TestBed.configureTestingModule({
      providers: [
        AutoScrollService,
        DragStateService,
        PositionCalculatorService,
        DragSchedulerService,
      ],
    });
    service = TestBed.inject(AutoScrollService);
    scheduler = TestBed.inject(DragSchedulerService);
    dragStateService = TestBed.inject(DragStateService);

    // Create a mock scrollable element with real-ish scroll properties
    mockElement = document.createElement('div');
    Object.defineProperty(mockElement, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(mockElement, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(mockElement, 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(mockElement, 'clientWidth', { value: 200, configurable: true });

    // scrollTop / scrollLeft need to be writable so += works
    let scrollTopVal = 200;
    Object.defineProperty(mockElement, 'scrollTop', {
      get: () => scrollTopVal,
      set: (v: number) => {
        scrollTopVal = v;
      },
      configurable: true,
    });
    let scrollLeftVal = 0;
    Object.defineProperty(mockElement, 'scrollLeft', {
      get: () => scrollLeftVal,
      set: (v: number) => {
        scrollLeftVal = v;
      },
      configurable: true,
    });

    // Container rect: top=100, bottom=500, left=50, right=250
    mockElement.getBoundingClientRect = jest.fn().mockReturnValue({
      top: 100,
      bottom: 500,
      left: 50,
      right: 250,
      height: 400,
      width: 200,
    });
  });

  afterEach(() => {
    scheduler.stop();
    service.stopMonitoring();
    service.unregisterContainer('test-container');
    dragStateService.endDrag();
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCancelRAF;
  });

  /** Helper: put the service into a dragging state with the given cursor position. */
  function setupDrag(cursor: { x: number; y: number }): void {
    dragStateService.startDrag(
      {
        draggableId: 'item-1',
        droppableId: 'list-1',
        element: document.createElement('div'),
        height: 50,
        width: 200,
      },
      cursor,
    );
  }

  /**
   * Helper: start the scheduler RAF loop (which drives autoscroll ticks) and
   * register AutoScrollService as a participant.
   * In production, DraggableDirective calls scheduler.start() then autoScroll.startMonitoring().
   * Tests must mirror this order so that flushRAF() fires the scheduler and participants.
   */
  function startMonitoringWithScheduler(onScroll?: () => void): void {
    scheduler.start(jest.fn()); // noop main tick — tests only care about participant behavior
    service.startMonitoring(onScroll);
  }

  // ---------------------------------------------------------------------------
  // registerContainer / unregisterContainer
  // ---------------------------------------------------------------------------
  describe('registerContainer', () => {
    it('should register a container that is used for scrolling', () => {
      // Cursor near bottom edge (y=480, threshold default=50, bottom=500)
      setupDrag({ x: 150, y: 480 });
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();

      const before = mockElement.scrollTop;
      flushRAF(); // one tick

      expect(mockElement.scrollTop).toBeGreaterThan(before);
    });

    it('should register with custom config that affects scroll behavior', () => {
      // Custom threshold of 10 — cursor at y=480 is 20px from bottom edge
      // With threshold=10 the cursor is NOT near the edge, so no scroll
      const config: Partial<AutoScrollConfig> = { threshold: 10 };
      setupDrag({ x: 150, y: 480 });
      service.registerContainer('test-container', mockElement, config);
      startMonitoringWithScheduler();

      const before = mockElement.scrollTop;
      flushRAF();

      expect(mockElement.scrollTop).toBe(before);
    });
  });

  describe('unregisterContainer', () => {
    it('should stop a container from being scrolled after unregistration', () => {
      setupDrag({ x: 150, y: 480 });
      service.registerContainer('test-container', mockElement);
      service.unregisterContainer('test-container');
      startMonitoringWithScheduler();

      const before = mockElement.scrollTop;
      flushRAF();

      expect(mockElement.scrollTop).toBe(before);
    });
  });

  // ---------------------------------------------------------------------------
  // startMonitoring / stopMonitoring
  // ---------------------------------------------------------------------------
  describe('startMonitoring', () => {
    it('should scroll once per frame even if startMonitoring is called multiple times', () => {
      const callback = jest.fn();
      setupDrag({ x: 150, y: 480 });
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler(callback);
      service.startMonitoring(callback); // second call — must not add a second participant

      const before = mockElement.scrollTop;
      flushRAF();

      // 20px from the bottom edge: 30/50 of the threshold → 0.6 * maxSpeed(15) = 9px, once
      expect(mockElement.scrollTop - before).toBe(9);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopMonitoring', () => {
    it('should stop scrolling when called — participant is removed from scheduler', () => {
      setupDrag({ x: 150, y: 480 });
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();
      flushRAF(); // scrolling active

      service.stopMonitoring();
      const scrollTopAfterStop = mockElement.scrollTop;
      flushRAF(); // scheduler tick runs but no participant registered
      expect(mockElement.scrollTop).toBe(scrollTopAfterStop); // no additional scroll
    });

    it('should reset isScrolling to false', () => {
      setupDrag({ x: 150, y: 480 });
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();
      flushRAF();

      expect(service.isScrolling()).toBe(true);

      service.stopMonitoring();
      expect(service.isScrolling()).toBe(false);
    });

    it('should reset scroll direction to zero', () => {
      setupDrag({ x: 150, y: 480 });
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();
      flushRAF();

      service.stopMonitoring();
      const dir = service.getScrollDirection();
      expect(dir.x).toBe(0);
      expect(dir.y).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // isScrolling / getScrollDirection
  // ---------------------------------------------------------------------------
  describe('isScrolling', () => {
    it('should return false initially', () => {
      expect(service.isScrolling()).toBe(false);
    });
  });

  describe('getScrollDirection', () => {
    it('should return zero direction initially', () => {
      const dir = service.getScrollDirection();
      expect(dir.x).toBe(0);
      expect(dir.y).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-scroll behavior (participant tick)
  // ---------------------------------------------------------------------------
  describe('auto-scroll behavior', () => {
    it('should not scroll before the drag has a cursor position', () => {
      // Start drag without cursor position
      dragStateService.startDrag({
        draggableId: 'item-1',
        droppableId: 'list-1',
        element: document.createElement('div'),
        height: 50,
        width: 200,
      });
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();

      const before = mockElement.scrollTop;
      flushRAF();

      expect(mockElement.scrollTop).toBe(before);
      expect(service.isScrolling()).toBe(false);
    });

    it('should reset scroll state when cursor moves from edge to center', () => {
      setupDrag({ x: 150, y: 480 });
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();
      flushRAF();
      expect(service.isScrolling()).toBe(true);

      // Move cursor to center
      dragStateService.updateDragPosition({
        cursorPosition: { x: 150, y: 300 },
        activeDroppableId: null,
        placeholderId: null,
        placeholderIndex: null,
      });
      flushRAF();

      expect(service.isScrolling()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Acceleration and speed
  // ---------------------------------------------------------------------------
  describe('scroll speed', () => {
    it('should scroll faster when cursor is closer to the edge', () => {
      // First: cursor 10px from bottom edge (fast)
      setupDrag({ x: 150, y: 490 });
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();

      const start1 = mockElement.scrollTop;
      flushRAF();
      const delta1 = mockElement.scrollTop - start1;

      service.stopMonitoring();
      scheduler.stop();
      // Reset scrollTop
      mockElement.scrollTop = 200;

      // Second: cursor 40px from bottom edge (slow)
      dragStateService.updateDragPosition({
        cursorPosition: { x: 150, y: 460 },
        activeDroppableId: null,
        placeholderId: null,
        placeholderIndex: null,
      });
      startMonitoringWithScheduler();

      const start2 = mockElement.scrollTop;
      flushRAF();
      const delta2 = mockElement.scrollTop - start2;

      expect(delta1).toBeGreaterThan(delta2);
    });

    it('should not accelerate when accelerate is false', () => {
      const config: Partial<AutoScrollConfig> = { accelerate: false };
      setupDrag({ x: 150, y: 490 });
      service.registerContainer('test-container', mockElement, config);
      startMonitoringWithScheduler();

      const start1 = mockElement.scrollTop;
      flushRAF();
      const delta1 = mockElement.scrollTop - start1;

      service.stopMonitoring();
      scheduler.stop();
      mockElement.scrollTop = 200;

      dragStateService.updateDragPosition({
        cursorPosition: { x: 150, y: 460 },
        activeDroppableId: null,
        placeholderId: null,
        placeholderIndex: null,
      });
      startMonitoringWithScheduler();

      const start2 = mockElement.scrollTop;
      flushRAF();
      const delta2 = mockElement.scrollTop - start2;

      // Both should scroll at maxSpeed regardless of distance
      expect(delta1).toBe(delta2);
    });

    it('should respect custom maxSpeed', () => {
      const config: Partial<AutoScrollConfig> = { maxSpeed: 5, accelerate: false };
      setupDrag({ x: 150, y: 480 });
      service.registerContainer('test-container', mockElement, config);
      startMonitoringWithScheduler();

      const before = mockElement.scrollTop;
      flushRAF();

      expect(mockElement.scrollTop - before).toBe(5);
    });

    it('should scale scroll distance by elapsed frame time', () => {
      let now = 100;
      const performanceNowSpy = jest.spyOn(performance, 'now');
      performanceNowSpy.mockImplementation(() => now);

      const config: Partial<AutoScrollConfig> = { maxSpeed: 15, accelerate: false };
      setupDrag({ x: 150, y: 480 });
      service.registerContainer('test-container', mockElement, config);
      startMonitoringWithScheduler();

      const start = mockElement.scrollTop;
      flushRAF();
      const firstDelta = mockElement.scrollTop - start;

      now = 108.33;
      const afterFirst = mockElement.scrollTop;
      flushRAF();
      const fastFrameDelta = mockElement.scrollTop - afterFirst;

      now = 141.67;
      const afterFastFrame = mockElement.scrollTop;
      flushRAF();
      const slowFrameDelta = mockElement.scrollTop - afterFastFrame;

      expect(firstDelta).toBeCloseTo(15, 2);
      expect(fastFrameDelta).toBeCloseTo(15, 1);
      expect(slowFrameDelta).toBeCloseTo(30, 1);

      performanceNowSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // Boundary clamping
  // ---------------------------------------------------------------------------
  describe('boundary checking', () => {
    it('should not scroll past top boundary (scrollTop = 0)', () => {
      mockElement.scrollTop = 0;
      setupDrag({ x: 150, y: 120 }); // near top edge
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();

      flushRAF();

      expect(mockElement.scrollTop).toBe(0);
    });

    it('should not scroll past bottom boundary (scrollTop = max)', () => {
      // max = scrollHeight(1000) - clientHeight(400) = 600
      mockElement.scrollTop = 600;
      setupDrag({ x: 150, y: 480 }); // near bottom edge
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();

      flushRAF();

      expect(mockElement.scrollTop).toBe(600);
    });

    it('should not scroll left past 0', () => {
      mockElement.scrollLeft = 0;
      setupDrag({ x: 70, y: 300 }); // near left edge
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();

      flushRAF();

      expect(mockElement.scrollLeft).toBe(0);
    });

    it('should not scroll right past max scrollLeft', () => {
      // max = scrollWidth(400) - clientWidth(200) = 200
      mockElement.scrollLeft = 200;
      setupDrag({ x: 230, y: 300 }); // near right edge
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();

      flushRAF();

      expect(mockElement.scrollLeft).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple containers
  // ---------------------------------------------------------------------------
  describe('multiple containers', () => {
    it('should only scroll the container that contains the cursor', () => {
      const element2 = document.createElement('div');
      Object.defineProperty(element2, 'scrollHeight', { value: 800, configurable: true });
      Object.defineProperty(element2, 'clientHeight', { value: 400, configurable: true });
      Object.defineProperty(element2, 'scrollWidth', { value: 200, configurable: true });
      Object.defineProperty(element2, 'clientWidth', { value: 200, configurable: true });
      let el2ScrollTop = 100;
      Object.defineProperty(element2, 'scrollTop', {
        get: () => el2ScrollTop,
        set: (v: number) => {
          el2ScrollTop = v;
        },
        configurable: true,
      });
      element2.getBoundingClientRect = jest.fn().mockReturnValue({
        top: 600,
        bottom: 1000,
        left: 50,
        right: 250,
        height: 400,
        width: 200,
      });

      // Cursor is inside container-1's bottom edge, not container-2
      setupDrag({ x: 150, y: 480 });
      service.registerContainer('container-1', mockElement);
      service.registerContainer('container-2', element2);
      startMonitoringWithScheduler();

      const before1 = mockElement.scrollTop;
      const before2 = el2ScrollTop;
      flushRAF();

      expect(mockElement.scrollTop).toBeGreaterThan(before1);
      expect(el2ScrollTop).toBe(before2);

      service.unregisterContainer('container-2');
    });

    it('should stop after the first matching container (break)', () => {
      // Two containers that overlap (cursor inside both)
      const element2 = document.createElement('div');
      Object.defineProperty(element2, 'scrollHeight', { value: 1000, configurable: true });
      Object.defineProperty(element2, 'clientHeight', { value: 400, configurable: true });
      Object.defineProperty(element2, 'scrollWidth', { value: 200, configurable: true });
      Object.defineProperty(element2, 'clientWidth', { value: 200, configurable: true });
      let el2ScrollTop = 200;
      Object.defineProperty(element2, 'scrollTop', {
        get: () => el2ScrollTop,
        set: (v: number) => {
          el2ScrollTop = v;
        },
        configurable: true,
      });
      // Same rect as mockElement so cursor is inside both
      element2.getBoundingClientRect = jest.fn().mockReturnValue({
        top: 100,
        bottom: 500,
        left: 50,
        right: 250,
        height: 400,
        width: 200,
      });

      setupDrag({ x: 150, y: 480 });
      service.registerContainer('container-1', mockElement);
      service.registerContainer('container-2', element2);
      startMonitoringWithScheduler();

      const before2 = el2ScrollTop;
      flushRAF();

      // Only container-1 should have scrolled (it was first in iteration order)
      expect(mockElement.scrollTop).toBeGreaterThan(200); // was 200
      expect(el2ScrollTop).toBe(before2);

      service.unregisterContainer('container-2');
    });
  });

  // ---------------------------------------------------------------------------
  // Nested scrollable containers (issue #26)
  // ---------------------------------------------------------------------------
  describe('nested scrollable containers', () => {
    /** Build a scrollable element with mocked rect + scroll geometry. */
    function makeScrollable(opts: {
      rect: { top: number; bottom: number; left: number; right: number };
      scrollHeight: number;
      clientHeight: number;
      scrollWidth?: number;
      clientWidth?: number;
      scrollTop?: number;
      scrollLeft?: number;
    }): HTMLElement {
      const el = document.createElement('div');
      Object.defineProperty(el, 'scrollHeight', { value: opts.scrollHeight, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: opts.clientHeight, configurable: true });
      Object.defineProperty(el, 'scrollWidth', {
        value: opts.scrollWidth ?? opts.clientWidth ?? 200,
        configurable: true,
      });
      Object.defineProperty(el, 'clientWidth', {
        value: opts.clientWidth ?? 200,
        configurable: true,
      });
      let topVal = opts.scrollTop ?? 0;
      Object.defineProperty(el, 'scrollTop', {
        get: () => topVal,
        set: (v: number) => {
          topVal = v;
        },
        configurable: true,
      });
      let leftVal = opts.scrollLeft ?? 0;
      Object.defineProperty(el, 'scrollLeft', {
        get: () => leftVal,
        set: (v: number) => {
          leftVal = v;
        },
        configurable: true,
      });
      el.getBoundingClientRect = jest.fn().mockReturnValue({
        top: opts.rect.top,
        bottom: opts.rect.bottom,
        left: opts.rect.left,
        right: opts.rect.right,
        height: opts.rect.bottom - opts.rect.top,
        width: opts.rect.right - opts.rect.left,
      });
      return el;
    }

    it('should scroll the outer container the same tick when the inner container is at its boundary', () => {
      // Outer page scroller: can still scroll down (scrollTop 0, max 600).
      const outer = makeScrollable({
        rect: { top: 100, bottom: 500, left: 50, right: 250 },
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop: 0,
      });
      // Inner list nested inside outer, already scrolled to the bottom (max 600).
      const inner = makeScrollable({
        rect: { top: 100, bottom: 480, left: 50, right: 250 },
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop: 600,
      });
      outer.appendChild(inner);

      // Cursor near the bottom edge of BOTH containers.
      setupDrag({ x: 150, y: 470 });
      // Register inner FIRST — with registration-order selection the exhausted inner
      // would swallow the tick and the outer would never scroll.
      service.registerContainer('inner', inner);
      service.registerContainer('outer', outer);
      startMonitoringWithScheduler();

      const beforeOuter = outer.scrollTop;
      flushRAF();

      // Inner is exhausted → stays put; outer picks up the scroll the same tick.
      expect(inner.scrollTop).toBe(600);
      expect(outer.scrollTop).toBeGreaterThan(beforeOuter);

      service.unregisterContainer('inner');
      service.unregisterContainer('outer');
    });

    it('should still scroll the available axis at a corner when the other axis is exhausted', () => {
      // Vertical exhausted (scrollTop at max 600), horizontal still available.
      const el = makeScrollable({
        rect: { top: 100, bottom: 500, left: 50, right: 250 },
        scrollHeight: 1000,
        clientHeight: 400,
        scrollWidth: 400,
        clientWidth: 200,
        scrollTop: 600,
        scrollLeft: 0,
      });

      // Cursor near the bottom-right corner (near both bottom and right edges).
      setupDrag({ x: 230, y: 480 });
      service.registerContainer('corner', el);
      startMonitoringWithScheduler();

      flushRAF();

      // Vertical is blocked, but horizontal must still scroll.
      expect(el.scrollTop).toBe(600);
      expect(el.scrollLeft).toBeGreaterThan(0);

      service.unregisterContainer('corner');
    });

    it('should scroll the innermost container regardless of registration order', () => {
      const outer = makeScrollable({
        rect: { top: 100, bottom: 500, left: 50, right: 250 },
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop: 0,
      });
      // Inner shares the rect and can also scroll — depth, not order, must decide.
      const inner = makeScrollable({
        rect: { top: 100, bottom: 500, left: 50, right: 250 },
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop: 0,
      });
      outer.appendChild(inner);

      setupDrag({ x: 150, y: 480 });
      // Register OUTER first: registration order would (wrongly) pick the outer.
      service.registerContainer('outer', outer);
      service.registerContainer('inner', inner);
      startMonitoringWithScheduler();

      const beforeInner = inner.scrollTop;
      const beforeOuter = outer.scrollTop;
      flushRAF();

      // Innermost (deepest) container under the cursor wins.
      expect(inner.scrollTop).toBeGreaterThan(beforeInner);
      expect(outer.scrollTop).toBe(beforeOuter);

      service.unregisterContainer('outer');
      service.unregisterContainer('inner');
    });

    it('should scroll the innermost container when an unrelated container is registered between them', () => {
      // Regression: an `element.contains()` comparator returns 0 for unrelated pairs and
      // is not a valid total order. With this exact registration interleaving the sort can
      // skip the outer↔inner comparison entirely and leave the outer ahead of its child.
      const board1 = makeScrollable({
        rect: { top: 100, bottom: 500, left: 50, right: 250 },
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop: 0,
      });
      // col1 is nested inside board1 and shares its rect (both under the cursor).
      const col1 = makeScrollable({
        rect: { top: 100, bottom: 500, left: 50, right: 250 },
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop: 0,
      });
      board1.appendChild(col1);
      // board2 is a second, unrelated board the cursor is NOT over.
      const board2 = makeScrollable({
        rect: { top: 600, bottom: 900, left: 50, right: 250 },
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop: 0,
      });

      setupDrag({ x: 150, y: 480 });
      // Interleave the unrelated board between the outer board and its inner column.
      service.registerContainer('board1', board1);
      service.registerContainer('board2', board2);
      service.registerContainer('col1', col1);
      startMonitoringWithScheduler();

      const beforeInner = col1.scrollTop;
      const beforeOuter = board1.scrollTop;
      flushRAF();

      // The deepest container under the cursor (col1) must win regardless of interleaving.
      expect(col1.scrollTop).toBeGreaterThan(beforeInner);
      expect(board1.scrollTop).toBe(beforeOuter);

      service.unregisterContainer('board1');
      service.unregisterContainer('board2');
      service.unregisterContainer('col1');
    });

    it('should not claim the tick or fire the callback when the container is at its fractional boundary', () => {
      // scrollHeight/clientHeight are rounded integers (max computes to 600), but the real
      // max is fractional (599.6) — as on WebKit / non-integer DPR. The integer pre-check
      // thinks the element can still scroll; only a before/after check reveals it cannot.
      const realMax = 599.6;
      const el = document.createElement('div');
      Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
      Object.defineProperty(el, 'scrollWidth', { value: 200, configurable: true });
      Object.defineProperty(el, 'clientWidth', { value: 200, configurable: true });
      let topVal = realMax;
      Object.defineProperty(el, 'scrollTop', {
        get: () => topVal,
        // Browser-style clamp: assignments beyond the real max are no-ops.
        set: (v: number) => {
          topVal = Math.min(v, realMax);
        },
        configurable: true,
      });
      el.getBoundingClientRect = jest.fn().mockReturnValue({
        top: 100,
        bottom: 500,
        left: 50,
        right: 250,
        height: 400,
        width: 200,
      });

      const callback = jest.fn();
      setupDrag({ x: 150, y: 480 }); // near bottom edge
      service.registerContainer('fractional', el);
      startMonitoringWithScheduler(callback);

      flushRAF();

      // The clamped assignment does not move the element → no scroll is claimed.
      expect(el.scrollTop).toBe(realMax);
      expect(callback).not.toHaveBeenCalled();
      expect(service.isScrolling()).toBe(false);

      service.unregisterContainer('fractional');
    });

    it('should rebuild containment ordering on each drag when a container is reparented', () => {
      const a = makeScrollable({
        rect: { top: 100, bottom: 500, left: 50, right: 250 },
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop: 0,
      });
      const b = makeScrollable({
        rect: { top: 100, bottom: 500, left: 50, right: 250 },
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop: 0,
      });
      // Initially siblings (equal depth) — registration order decides.
      service.registerContainer('a', a);
      service.registerContainer('b', b);

      setupDrag({ x: 150, y: 480 });
      startMonitoringWithScheduler();
      flushRAF();
      expect(a.scrollTop).toBeGreaterThan(0);
      expect(b.scrollTop).toBe(0);

      service.stopMonitoring();
      scheduler.stop();
      a.scrollTop = 0;

      // Reparent b under a WITHOUT re-registering. Only startMonitoring refreshes the order.
      a.appendChild(b);

      startMonitoringWithScheduler();
      flushRAF();

      // b is now deeper → it must win, proving the per-drag cache refresh.
      expect(b.scrollTop).toBeGreaterThan(0);
      expect(a.scrollTop).toBe(0);

      service.unregisterContainer('a');
      service.unregisterContainer('b');
    });
  });

  // ---------------------------------------------------------------------------
  // Scrollability filtering (registration is unconditional; the candidate list
  // is filtered by live scroll geometry, refreshed per drag)
  // ---------------------------------------------------------------------------
  describe('scrollability filtering', () => {
    /** Element whose content fits its box — nothing to scroll. */
    function makeNonScrollable(): { el: HTMLElement; rectSpy: jest.Mock } {
      const el = document.createElement('div');
      Object.defineProperty(el, 'scrollHeight', { value: 400, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
      Object.defineProperty(el, 'scrollWidth', { value: 200, configurable: true });
      Object.defineProperty(el, 'clientWidth', { value: 200, configurable: true });
      let topVal = 0;
      Object.defineProperty(el, 'scrollTop', {
        get: () => topVal,
        set: (v: number) => {
          topVal = v;
        },
        configurable: true,
      });
      const rectSpy = jest.fn().mockReturnValue({
        top: 100,
        bottom: 500,
        left: 50,
        right: 250,
        height: 400,
        width: 200,
      });
      el.getBoundingClientRect = rectSpy;
      return { el, rectSpy };
    }

    it('should skip a registered container that has nothing to scroll', () => {
      const { el, rectSpy } = makeNonScrollable();

      // Cursor sits right on the (would-be) bottom edge — the only reason not to
      // touch this container is that it is excluded from the candidate list.
      setupDrag({ x: 150, y: 480 });
      service.registerContainer('non-scrollable', el);
      startMonitoringWithScheduler();
      flushRAF();

      expect(rectSpy).not.toHaveBeenCalled();
      expect(el.scrollTop).toBe(0);

      service.unregisterContainer('non-scrollable');
    });

    it('should include a container once its content grows scrollable on the next drag', () => {
      let scrollHeight = 400; // === clientHeight → not scrollable yet
      const el = document.createElement('div');
      Object.defineProperty(el, 'scrollHeight', { get: () => scrollHeight, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
      Object.defineProperty(el, 'scrollWidth', { value: 200, configurable: true });
      Object.defineProperty(el, 'clientWidth', { value: 200, configurable: true });
      let topVal = 0;
      Object.defineProperty(el, 'scrollTop', {
        get: () => topVal,
        set: (v: number) => {
          topVal = v;
        },
        configurable: true,
      });
      el.getBoundingClientRect = jest.fn().mockReturnValue({
        top: 100,
        bottom: 500,
        left: 50,
        right: 250,
        height: 400,
        width: 200,
      });

      // Registered up front, while not yet scrollable (mirrors a list awaiting data).
      service.registerContainer('grow-list', el);

      setupDrag({ x: 150, y: 480 });
      startMonitoringWithScheduler();
      flushRAF();
      expect(el.scrollTop).toBe(0);

      service.stopMonitoring();
      scheduler.stop();
      dragStateService.endDrag();

      // Content arrives — container is now scrollable. No re-registration happens.
      scrollHeight = 1000;

      setupDrag({ x: 150, y: 480 });
      startMonitoringWithScheduler();
      flushRAF();
      expect(el.scrollTop).toBeGreaterThan(0);

      service.unregisterContainer('grow-list');
    });
  });

  // ---------------------------------------------------------------------------
  // Callback invocation
  // ---------------------------------------------------------------------------
  describe('callback invocation', () => {
    it('should not invoke callback when no scroll occurs', () => {
      const callback = jest.fn();
      setupDrag({ x: 150, y: 300 }); // center, no edge
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler(callback);

      flushRAF();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should not invoke the previous drag callback after monitoring restarts without one', () => {
      const callback = jest.fn();
      setupDrag({ x: 150, y: 480 });
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler(callback);
      flushRAF();
      callback.mockClear();

      service.stopMonitoring();
      // Restart monitoring without callback, near edge again
      service.startMonitoring();
      flushRAF();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should invoke callback on every tick that causes scroll', () => {
      const callback = jest.fn();
      setupDrag({ x: 150, y: 480 });
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler(callback);

      flushRAF(); // tick 1
      flushRAF(); // tick 2
      flushRAF(); // tick 3

      expect(callback.mock.calls.length).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge detection directions
  // ---------------------------------------------------------------------------
  describe('edge detection', () => {
    it('should detect cursor near top edge and scroll up', () => {
      setupDrag({ x: 150, y: 120 }); // 20px from top (threshold=50)
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();
      flushRAF();

      expect(service.isScrolling()).toBe(true);
      expect(service.getScrollDirection().y).toBe(-1);
      expect(mockElement.scrollTop).toBeLessThan(200);
    });

    it('should detect cursor near bottom edge and scroll down', () => {
      setupDrag({ x: 150, y: 480 }); // 20px from bottom (threshold=50)
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();
      flushRAF();

      expect(service.isScrolling()).toBe(true);
      expect(service.getScrollDirection().y).toBe(1);
      expect(mockElement.scrollTop).toBeGreaterThan(200);
    });

    it('should detect cursor near left edge and scroll left', () => {
      mockElement.scrollLeft = 100;
      setupDrag({ x: 70, y: 300 }); // 20px from left (threshold=50)
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();
      flushRAF();

      expect(service.isScrolling()).toBe(true);
      expect(service.getScrollDirection().x).toBe(-1);
      expect(mockElement.scrollLeft).toBeLessThan(100);
    });

    it('should detect cursor near right edge and scroll right', () => {
      setupDrag({ x: 230, y: 300 }); // 20px from right (threshold=50)
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();
      flushRAF();

      expect(service.isScrolling()).toBe(true);
      expect(service.getScrollDirection().x).toBe(1);
      expect(mockElement.scrollLeft).toBeGreaterThan(0);
    });

    it('should not detect edge when cursor is in the center', () => {
      setupDrag({ x: 150, y: 300 });
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();
      flushRAF();

      expect(mockElement.scrollTop).toBe(200);
      expect(mockElement.scrollLeft).toBe(0);
      expect(service.isScrolling()).toBe(false);
      expect(service.getScrollDirection().x).toBe(0);
      expect(service.getScrollDirection().y).toBe(0);
    });

    it('should respect custom threshold', () => {
      // Default threshold is 50, cursor at y=460 is 40px from bottom => scrolls
      // Custom threshold of 30 means cursor at y=460 is 40px from bottom => NOT within 30px
      const config: Partial<AutoScrollConfig> = { threshold: 30 };
      setupDrag({ x: 150, y: 460 });
      service.registerContainer('test-container', mockElement, config);
      startMonitoringWithScheduler();
      flushRAF();

      expect(service.isScrolling()).toBe(false);

      service.stopMonitoring();
      scheduler.stop();

      // But y=480 is 20px from bottom edge, within threshold of 30
      dragStateService.updateDragPosition({
        cursorPosition: { x: 150, y: 480 },
        activeDroppableId: null,
        placeholderId: null,
        placeholderIndex: null,
      });
      startMonitoringWithScheduler();
      flushRAF();

      expect(service.isScrolling()).toBe(true);
      expect(service.getScrollDirection().y).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // setCursorOverride
  // ---------------------------------------------------------------------------
  describe('setCursorOverride', () => {
    it('should use override cursor instead of DragState cursor for edge detection', () => {
      // DragState cursor is in the center (no scroll)
      setupDrag({ x: 150, y: 300 });
      service.registerContainer('test-container', mockElement);

      // Override cursor to near bottom edge (should trigger scroll)
      service.setCursorOverride({ x: 150, y: 480 });
      startMonitoringWithScheduler();

      const before = mockElement.scrollTop;
      flushRAF();

      expect(mockElement.scrollTop).toBeGreaterThan(before);
    });

    it('should clear override on stopMonitoring', () => {
      // DragState cursor is in the center (no scroll)
      setupDrag({ x: 150, y: 300 });
      service.registerContainer('test-container', mockElement);

      // Override to near edge
      service.setCursorOverride({ x: 150, y: 480 });
      startMonitoringWithScheduler();
      flushRAF();
      expect(service.isScrolling()).toBe(true);

      // Stop clears override
      service.stopMonitoring();
      scheduler.stop();

      // Restart without override — should fall back to DragState center cursor
      startMonitoringWithScheduler();
      flushRAF();

      expect(service.isScrolling()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Cursor outside container
  // ---------------------------------------------------------------------------
  describe('cursor outside container', () => {
    it('should not scroll when cursor is above the container', () => {
      setupDrag({ x: 150, y: 50 }); // above container (top=100)
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();

      const before = mockElement.scrollTop;
      flushRAF();

      expect(mockElement.scrollTop).toBe(before);
      expect(service.isScrolling()).toBe(false);
    });

    it('should not scroll when cursor is below the container', () => {
      setupDrag({ x: 150, y: 550 }); // below container (bottom=500)
      service.registerContainer('test-container', mockElement);
      startMonitoringWithScheduler();

      const before = mockElement.scrollTop;
      flushRAF();

      expect(mockElement.scrollTop).toBe(before);
      expect(service.isScrolling()).toBe(false);
    });
  });
});
