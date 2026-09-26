import { TestBed } from '@angular/core/testing';
import { PositionCalculatorService } from './position-calculator.service';

describe('PositionCalculatorService', () => {
  let service: PositionCalculatorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PositionCalculatorService);
  });

  describe('calculateDropIndex', () => {
    it('should calculate index 0 when cursor is at top of container', () => {
      const index = service.calculateDropIndex(
        0, // scrollTop
        100, // cursorY
        100, // containerTop
        50, // itemHeight
        10, // totalItems
      );
      expect(index).toBe(0);
    });

    it('should calculate correct index based on cursor position', () => {
      const index = service.calculateDropIndex(
        0, // scrollTop
        200, // cursorY (100px into content = 2 items)
        100, // containerTop
        50, // itemHeight
        10, // totalItems
      );
      expect(index).toBe(2);
    });

    it('should account for scroll offset', () => {
      const index = service.calculateDropIndex(
        100, // scrollTop (scrolled down 2 items)
        150, // cursorY (50px into viewport)
        100, // containerTop
        50, // itemHeight
        10, // totalItems
      );
      // relativeY = 150 - 100 + 100 = 150
      // index = floor(150 / 50) = 3
      expect(index).toBe(3);
    });

    it('should clamp index to 0 when cursor is above container', () => {
      const index = service.calculateDropIndex(
        0, // scrollTop
        50, // cursorY (above containerTop)
        100, // containerTop
        50, // itemHeight
        10, // totalItems
      );
      expect(index).toBe(0);
    });

    it('should clamp index to totalItems when cursor is below all items', () => {
      const index = service.calculateDropIndex(
        0, // scrollTop
        700, // cursorY (way below)
        100, // containerTop
        50, // itemHeight
        10, // totalItems
      );
      expect(index).toBe(10);
    });

    it('should handle edge case of very large scroll offset', () => {
      const index = service.calculateDropIndex(
        5000, // scrollTop
        150, // cursorY
        100, // containerTop
        50, // itemHeight
        200, // totalItems
      );
      // relativeY = 150 - 100 + 5000 = 5050
      // index = floor(5050 / 50) = 101
      expect(index).toBe(101);
    });
  });

  describe('getNearEdge', () => {
    const containerRect = {
      top: 100,
      bottom: 500,
      left: 100,
      right: 600,
    } as DOMRect;

    it('should detect near top edge', () => {
      const result = service.getNearEdge({ x: 300, y: 120 }, containerRect, 50);
      expect(result.top).toBe(true);
      expect(result.bottom).toBe(false);
      expect(result.left).toBe(false);
      expect(result.right).toBe(false);
    });

    it('should detect near bottom edge', () => {
      const result = service.getNearEdge({ x: 300, y: 480 }, containerRect, 50);
      expect(result.top).toBe(false);
      expect(result.bottom).toBe(true);
      expect(result.left).toBe(false);
      expect(result.right).toBe(false);
    });

    it('should detect near left edge', () => {
      const result = service.getNearEdge({ x: 120, y: 300 }, containerRect, 50);
      expect(result.top).toBe(false);
      expect(result.bottom).toBe(false);
      expect(result.left).toBe(true);
      expect(result.right).toBe(false);
    });

    it('should detect near right edge', () => {
      const result = service.getNearEdge({ x: 580, y: 300 }, containerRect, 50);
      expect(result.top).toBe(false);
      expect(result.bottom).toBe(false);
      expect(result.left).toBe(false);
      expect(result.right).toBe(true);
    });

    it('should detect multiple edges (corner)', () => {
      const result = service.getNearEdge({ x: 120, y: 120 }, containerRect, 50);
      expect(result.top).toBe(true);
      expect(result.left).toBe(true);
      expect(result.bottom).toBe(false);
      expect(result.right).toBe(false);
    });

    it('should detect no edges when in center', () => {
      const result = service.getNearEdge({ x: 350, y: 300 }, containerRect, 50);
      expect(result.top).toBe(false);
      expect(result.bottom).toBe(false);
      expect(result.left).toBe(false);
      expect(result.right).toBe(false);
    });
  });

  describe('isInsideContainer', () => {
    const containerRect = {
      top: 100,
      bottom: 500,
      left: 100,
      right: 600,
    } as DOMRect;

    it('should return true when position is inside container', () => {
      expect(service.isInsideContainer({ x: 300, y: 300 }, containerRect)).toBe(true);
    });

    it('should return true when position is on edge', () => {
      expect(service.isInsideContainer({ x: 100, y: 100 }, containerRect)).toBe(true);
      expect(service.isInsideContainer({ x: 600, y: 500 }, containerRect)).toBe(true);
    });

    it('should return false when position is outside container (left)', () => {
      expect(service.isInsideContainer({ x: 50, y: 300 }, containerRect)).toBe(false);
    });

    it('should return false when position is outside container (right)', () => {
      expect(service.isInsideContainer({ x: 650, y: 300 }, containerRect)).toBe(false);
    });

    it('should return false when position is outside container (top)', () => {
      expect(service.isInsideContainer({ x: 300, y: 50 }, containerRect)).toBe(false);
    });

    it('should return false when position is outside container (bottom)', () => {
      expect(service.isInsideContainer({ x: 300, y: 550 }, containerRect)).toBe(false);
    });
  });

  describe('DOM element finding', () => {
    let container: HTMLElement;
    let droppable: HTMLElement;
    let draggable: HTMLElement;

    beforeEach(() => {
      // Set up test DOM
      container = document.createElement('div');
      droppable = document.createElement('div');
      droppable.setAttribute('data-droppable-id', 'test-droppable');
      droppable.setAttribute('data-droppable-group', 'test-group');

      draggable = document.createElement('div');
      draggable.setAttribute('data-draggable-id', 'test-draggable');

      droppable.appendChild(draggable);
      container.appendChild(droppable);
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should find droppable parent element', () => {
      const result = service.getDroppableParent(draggable, 'test-group');
      expect(result).toBe(droppable);
    });

    it('should return null if droppable not found', () => {
      const result = service.getDroppableParent(draggable, 'wrong-group');
      expect(result).toBeNull();
    });

    it('should find draggable parent element', () => {
      const inner = document.createElement('span');
      draggable.appendChild(inner);

      const result = service.getDraggableParent(inner);
      expect(result).toBe(draggable);
    });

    it('should return null if draggable not found', () => {
      const orphan = document.createElement('div');
      container.appendChild(orphan);

      const result = service.getDraggableParent(orphan);
      expect(result).toBeNull();
    });

    /** Append a chain of `depth` nested divs under `parent`; returns the innermost. */
    const nest = (parent: HTMLElement, depth: number): HTMLElement => {
      let current = parent;
      for (let i = 0; i < depth; i++) {
        const child = document.createElement('div');
        current.appendChild(child);
        current = child;
      }
      return current;
    };

    it('should find a droppable parent any number of levels up', () => {
      // Component wrappers and layout shells between a list and its rows
      const deepDraggable = nest(droppable, 20);
      deepDraggable.setAttribute('data-draggable-id', 'deep-draggable');

      expect(service.getDroppableParent(deepDraggable, 'test-group')).toBe(droppable);
    });

    it('should skip droppables of other groups on the way up', () => {
      const otherGroup = nest(droppable, 3);
      otherGroup.setAttribute('data-droppable-group', 'other-group');
      const deepDraggable = nest(otherGroup, 17);

      expect(service.getDroppableParent(deepDraggable, 'test-group')).toBe(droppable);
      expect(service.getDroppableParent(deepDraggable, 'other-group')).toBe(otherGroup);
    });

    it('should find a draggable parent any number of levels up', () => {
      const deepTarget = nest(draggable, 20);

      expect(service.getDraggableParent(deepTarget)).toBe(draggable);
    });

    it('should skip elements with an empty draggable ID', () => {
      const unnamed = nest(draggable, 2);
      unnamed.setAttribute('data-draggable-id', '');
      const target = nest(unnamed, 2);

      expect(service.getDraggableParent(target)).toBe(draggable);
    });

    it('should not match an empty group name', () => {
      const unnamed = nest(droppable, 1);
      unnamed.setAttribute('data-droppable-group', '');

      expect(service.getDroppableParent(nest(unnamed, 1), '')).toBeNull();
    });

    it('should not treat <body> as a droppable or draggable', () => {
      document.body.setAttribute('data-droppable-group', 'body-group');
      document.body.setAttribute('data-draggable-id', 'body');
      try {
        const orphan = nest(container, 1);

        expect(service.getDroppableParent(orphan, 'body-group')).toBeNull();
        expect(service.getDraggableParent(orphan)).toBeNull();
      } finally {
        document.body.removeAttribute('data-droppable-group');
        document.body.removeAttribute('data-draggable-id');
      }
    });

    it('should get draggable ID from element', () => {
      const id = service.getDraggableId(draggable);
      expect(id).toBe('test-draggable');
    });

    it('should get droppable ID from element', () => {
      const id = service.getDroppableId(droppable);
      expect(id).toBe('test-droppable');
    });
  });

  describe('geometric hit-testing (cached rects)', () => {
    // jsdom has no layout engine, so getBoundingClientRect() returns zeros and
    // elementFromPoint() returns null. We stub rects to exercise the pure-geometry
    // hit-testing path that replaces elementFromPoint.
    const created: HTMLElement[] = [];

    function makeDroppable(id: string, group: string, rect: Partial<DOMRect>): HTMLElement {
      const el = document.createElement('div');
      el.setAttribute('data-droppable-id', id);
      el.setAttribute('data-droppable-group', group);
      stubRect(el, rect);
      document.body.appendChild(el);
      created.push(el);
      return el;
    }

    function stubRect(el: HTMLElement, rect: Partial<DOMRect>): void {
      const full = {
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
        ...rect,
      } as DOMRect;
      el.getBoundingClientRect = () => full;
    }

    afterEach(() => {
      service.endDragSession();
      created.forEach((el) => el.remove());
      created.length = 0;
    });

    it('returns the droppable whose snapshot rect contains the point', () => {
      const dragged = document.createElement('div');
      const drop = makeDroppable('list', 'g', { top: 100, left: 100, right: 300, bottom: 400 });

      service.beginDragSession('g');
      const result = service.findDroppableAtPoint(200, 250, dragged, 'g');
      expect(result).toBe(drop);
    });

    it('returns null when the point is outside every droppable', () => {
      const dragged = document.createElement('div');
      makeDroppable('list', 'g', { top: 100, left: 100, right: 300, bottom: 400 });

      service.beginDragSession('g');
      expect(service.findDroppableAtPoint(50, 50, dragged, 'g')).toBeNull();
    });

    it('only considers droppables in the requested group', () => {
      const dragged = document.createElement('div');
      makeDroppable('other', 'other-group', { top: 100, left: 100, right: 300, bottom: 400 });
      const mine = makeDroppable('mine', 'g', { top: 100, left: 100, right: 300, bottom: 400 });

      service.beginDragSession('g');
      expect(service.findDroppableAtPoint(200, 250, dragged, 'g')).toBe(mine);
    });

    it('prefers the nested (inner) droppable via painter-order tie-break', () => {
      const dragged = document.createElement('div');
      const outer = makeDroppable('outer', 'g', { top: 0, left: 0, right: 400, bottom: 400 });
      const inner = document.createElement('div');
      inner.setAttribute('data-droppable-id', 'inner');
      inner.setAttribute('data-droppable-group', 'g');
      stubRect(inner, { top: 100, left: 100, right: 300, bottom: 300 });
      outer.appendChild(inner);
      created.push(inner);

      service.beginDragSession('g');
      // Point inside both outer and inner — inner is later in document order (painted on top).
      expect(service.findDroppableAtPoint(200, 200, dragged, 'g')).toBe(inner);
    });

    it('prefers the later overlapping sibling via painter-order tie-break', () => {
      const dragged = document.createElement('div');
      makeDroppable('a', 'g', { top: 0, left: 0, right: 200, bottom: 200 });
      const b = makeDroppable('b', 'g', { top: 50, left: 50, right: 250, bottom: 250 });

      service.beginDragSession('g');
      // Point (100,100) is inside both A and B; B comes later in the DOM.
      expect(service.findDroppableAtPoint(100, 100, dragged, 'g')).toBe(b);
    });

    it('re-reads rects after invalidateDroppableRects (scroll/resize)', () => {
      const dragged = document.createElement('div');
      const drop = makeDroppable('list', 'g', { top: 100, left: 100, right: 300, bottom: 400 });

      service.beginDragSession('g');
      expect(service.findDroppableAtPoint(200, 250, dragged, 'g')).toBe(drop);

      // Simulate the container scrolling up by 100px (rect moves up).
      stubRect(drop, { top: 0, left: 100, right: 300, bottom: 300 });
      // Without invalidation the cached rect (100..400) is still used...
      expect(service.findDroppableAtPoint(200, 350, dragged, 'g')).toBe(drop);
      // ...after invalidation the fresh rect (0..300) is.
      service.invalidateDroppableRects();
      expect(service.findDroppableAtPoint(200, 350, dragged, 'g')).toBeNull();
      expect(service.findDroppableAtPoint(200, 250, dragged, 'g')).toBe(drop);
    });

    it('falls back to a one-shot geometric query when no session is active', () => {
      const dragged = document.createElement('div');
      const drop = makeDroppable('list', 'g', { top: 100, left: 100, right: 300, bottom: 400 });

      // No beginDragSession() — lazy path queries the DOM directly.
      expect(service.findDroppableAtPoint(200, 250, dragged, 'g')).toBe(drop);
    });
  });

  describe('mid-drag candidate changes', () => {
    // Exercises the divergence cases from issue #23: droppables added/removed after
    // the candidate snapshot was captured at drag start.
    const created: HTMLElement[] = [];

    function stubRect(el: HTMLElement, rect: Partial<DOMRect>): void {
      const full = {
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
        ...rect,
      } as DOMRect;
      el.getBoundingClientRect = () => full;
    }

    function makeDroppable(id: string, group: string, rect: Partial<DOMRect>): HTMLElement {
      const el = document.createElement('div');
      el.setAttribute('data-droppable-id', id);
      el.setAttribute('data-droppable-group', group);
      stubRect(el, rect);
      document.body.appendChild(el);
      created.push(el);
      return el;
    }

    afterEach(() => {
      service.endDragSession();
      created.forEach((el) => el.remove());
      created.length = 0;
    });

    it('refreshCandidates picks up a droppable mounted after the session started', () => {
      const dragged = document.createElement('div');
      makeDroppable('a', 'g', { top: 0, left: 0, right: 100, bottom: 100 });

      service.beginDragSession('g');

      // A new droppable mounts mid-drag (e.g. a conditionally rendered list).
      const b = makeDroppable('b', 'g', { top: 200, left: 200, right: 400, bottom: 400 });

      // Frozen candidate list does not see it yet.
      expect(service.findDroppableAtPoint(300, 300, dragged, 'g')).toBeNull();

      service.refreshCandidates();

      // After an explicit refresh it becomes a valid target.
      expect(service.findDroppableAtPoint(300, 300, dragged, 'g')).toBe(b);
    });

    it('refreshCandidates drops a droppable removed mid-session', () => {
      const dragged = document.createElement('div');
      const a = makeDroppable('a', 'g', { top: 0, left: 0, right: 300, bottom: 300 });

      service.beginDragSession('g');
      expect(service.findDroppableAtPoint(100, 100, dragged, 'g')).toBe(a);

      a.remove();
      service.refreshCandidates();

      expect(service.findDroppableAtPoint(100, 100, dragged, 'g')).toBeNull();
    });

    it('notifyCandidatesChanged makes the next hit-test observe a newly mounted droppable', () => {
      const dragged = document.createElement('div');
      makeDroppable('a', 'g', { top: 0, left: 0, right: 100, bottom: 100 });

      service.beginDragSession('g');

      const b = makeDroppable('b', 'g', { top: 200, left: 200, right: 400, bottom: 400 });
      expect(service.findDroppableAtPoint(300, 300, dragged, 'g')).toBeNull();

      // A droppable directive registering mid-drag notifies the calculator.
      service.notifyCandidatesChanged('g');

      expect(service.findDroppableAtPoint(300, 300, dragged, 'g')).toBe(b);
    });

    it('notifyCandidatesChanged ignores notifications for a different group', () => {
      const dragged = document.createElement('div');
      makeDroppable('a', 'g', { top: 0, left: 0, right: 100, bottom: 100 });

      service.beginDragSession('g');
      const b = makeDroppable('b', 'g', { top: 200, left: 200, right: 400, bottom: 400 });

      // Notification for an unrelated group must not refresh this session's candidates.
      service.notifyCandidatesChanged('other-group');
      expect(service.findDroppableAtPoint(300, 300, dragged, 'g')).toBeNull();

      // The matching group's notification does refresh them.
      service.notifyCandidatesChanged('g');
      expect(service.findDroppableAtPoint(300, 300, dragged, 'g')).toBe(b);
    });

    it('refreshCandidates is a no-op when no session is active', () => {
      expect(() => service.refreshCandidates()).not.toThrow();
    });
  });

  describe('rect clipping by scrollable ancestor', () => {
    // Issue #23 case 3: a droppable scrolled mostly out of a clipping ancestor still
    // hit-tests over its full unclipped rect. Rects are clipped to the nearest
    // `.vdnd-scrollable` ancestor at snapshot/refresh time.
    const created: HTMLElement[] = [];

    function stubRect(el: HTMLElement, rect: Partial<DOMRect>): void {
      const full = {
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
        ...rect,
      } as DOMRect;
      el.getBoundingClientRect = () => full;
    }

    afterEach(() => {
      service.endDragSession();
      created.forEach((el) => el.remove());
      created.length = 0;
    });

    it('clips a candidate rect to its scrollable ancestor viewport', () => {
      const dragged = document.createElement('div');

      const scrollable = document.createElement('div');
      scrollable.className = 'vdnd-scrollable';
      stubRect(scrollable, { top: 100, left: 100, right: 300, bottom: 300 });
      document.body.appendChild(scrollable);
      created.push(scrollable);

      // Droppable content is taller than the scrollable viewport and scrolled so its
      // unclipped rect (top: 0) extends above the visible clip region (top: 100).
      const drop = document.createElement('div');
      drop.setAttribute('data-droppable-id', 'list');
      drop.setAttribute('data-droppable-group', 'g');
      stubRect(drop, { top: 0, left: 100, right: 300, bottom: 600 });
      scrollable.appendChild(drop);
      created.push(drop);

      service.beginDragSession('g');

      // A point inside the unclipped rect but ABOVE the scrollable viewport must miss.
      expect(service.findDroppableAtPoint(200, 50, dragged, 'g')).toBeNull();
      // A point inside the visible (clipped) region hits.
      expect(service.findDroppableAtPoint(200, 200, dragged, 'g')).toBe(drop);
      // A point inside the unclipped rect but BELOW the scrollable viewport must miss.
      expect(service.findDroppableAtPoint(200, 400, dragged, 'g')).toBeNull();
    });

    it('does not clip when the droppable has no scrollable ancestor', () => {
      const dragged = document.createElement('div');
      const drop = document.createElement('div');
      drop.setAttribute('data-droppable-id', 'list');
      drop.setAttribute('data-droppable-group', 'g');
      stubRect(drop, { top: 0, left: 0, right: 300, bottom: 600 });
      document.body.appendChild(drop);
      created.push(drop);

      service.beginDragSession('g');
      expect(service.findDroppableAtPoint(100, 500, dragged, 'g')).toBe(drop);
    });
  });

  describe('getDroppableById', () => {
    const createdById: HTMLElement[] = [];

    function makeDroppableById(id: string, group: string): HTMLElement {
      const el = document.createElement('div');
      el.setAttribute('data-droppable-id', id);
      el.setAttribute('data-droppable-group', group);
      document.body.appendChild(el);
      createdById.push(el);
      return el;
    }

    afterEach(() => {
      service.endDragSession();
      createdById.forEach((el) => el.remove());
      createdById.length = 0;
    });

    it('returns the element from session candidates when a session is active', () => {
      const drop = makeDroppableById('list-1', 'g');
      service.beginDragSession('g');

      expect(service.getDroppableById('list-1')).toBe(drop);
    });

    it('returns null when the ID is not in the session candidates', () => {
      makeDroppableById('list-1', 'g');
      service.beginDragSession('g');

      expect(service.getDroppableById('list-999')).toBeNull();
    });

    it('falls back to a DOM query when no session is active', () => {
      const drop = makeDroppableById('list-1', 'g');

      // No session active — should still find via querySelector.
      expect(service.getDroppableById('list-1')).toBe(drop);
    });

    it('finds a droppable with selector-sensitive characters in its ID', () => {
      const unsafeId = 'list-"quoted"\\[one]';
      const drop = makeDroppableById(unsafeId, 'g');

      expect(() => service.getDroppableById(unsafeId)).not.toThrow();
      expect(service.getDroppableById(unsafeId)).toBe(drop);
    });

    it('returns null when the element does not exist in the DOM (no session)', () => {
      expect(service.getDroppableById('nonexistent')).toBeNull();
    });
  });

  describe('findAdjacentDroppable', () => {
    const createdAdjacent: HTMLElement[] = [];

    function makeAdjacentDroppable(id: string, group: string, left: number): HTMLElement {
      const el = document.createElement('div');
      el.setAttribute('data-droppable-id', id);
      el.setAttribute('data-droppable-group', group);
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
      document.body.appendChild(el);
      createdAdjacent.push(el);
      return el;
    }

    afterEach(() => {
      createdAdjacent.forEach((el) => el.remove());
      createdAdjacent.length = 0;
    });

    it('orders droppables by horizontal position, not DOM order', () => {
      // DOM order: right, left, middle
      const right = makeAdjacentDroppable('right', 'g', 400);
      const left = makeAdjacentDroppable('left', 'g', 0);
      makeAdjacentDroppable('middle', 'g', 200);

      expect(service.findAdjacentDroppable('middle', 'right', 'g')?.element).toBe(right);
      expect(service.findAdjacentDroppable('middle', 'left', 'g')?.element).toBe(left);
    });

    it('returns null past either end of the row', () => {
      makeAdjacentDroppable('left', 'g', 0);
      makeAdjacentDroppable('right', 'g', 200);

      expect(service.findAdjacentDroppable('left', 'left', 'g')).toBeNull();
      expect(service.findAdjacentDroppable('right', 'right', 'g')).toBeNull();
    });

    it('ignores droppables from other groups', () => {
      makeAdjacentDroppable('left', 'g', 0);
      makeAdjacentDroppable('foreign', 'other', 100);
      const right = makeAdjacentDroppable('right', 'g', 200);

      expect(service.findAdjacentDroppable('left', 'right', 'g')?.element).toBe(right);
    });

    it('finds adjacent droppables when the group contains selector-sensitive characters', () => {
      const group = 'group-"quoted"\\[one]';
      makeAdjacentDroppable('left', group, 0);
      const right = makeAdjacentDroppable('right', group, 200);

      expect(() => service.findAdjacentDroppable('left', 'right', group)).not.toThrow();
      expect(service.findAdjacentDroppable('left', 'right', group)?.element).toBe(right);
    });
  });

  describe('disabled droppable filtering', () => {
    const createdDisabled: HTMLElement[] = [];

    function stub(el: HTMLElement, rect: Partial<DOMRect>): void {
      el.getBoundingClientRect = () =>
        ({
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
          ...rect,
        }) as DOMRect;
    }

    function make(
      id: string,
      group: string,
      rect: Partial<DOMRect>,
      disabled = false,
    ): HTMLElement {
      const el = document.createElement('div');
      el.setAttribute('data-droppable-id', id);
      el.setAttribute('data-droppable-group', group);
      if (disabled) {
        el.setAttribute('data-droppable-disabled', 'true');
      }
      stub(el, rect);
      document.body.appendChild(el);
      createdDisabled.push(el);
      return el;
    }

    afterEach(() => {
      service.endDragSession();
      createdDisabled.forEach((el) => el.remove());
      createdDisabled.length = 0;
    });

    it('excludes a disabled droppable from hit-test candidates (treated as no target)', () => {
      const dragged = document.createElement('div');
      make('disabled-list', 'g', { top: 100, left: 100, right: 300, bottom: 400 }, true);

      service.beginDragSession('g');
      expect(service.findDroppableAtPoint(200, 250, dragged, 'g')).toBeNull();
    });

    it('excludes a droppable that becomes disabled during an active drag session', () => {
      const dragged = document.createElement('div');
      const drop = make('list', 'g', { top: 100, left: 100, right: 300, bottom: 400 });

      service.beginDragSession('g');
      expect(service.findDroppableAtPoint(200, 250, dragged, 'g')).toBe(drop);

      // Consumer disables it mid-drag (e.g. from a (dragStart) handler, which fires
      // AFTER the candidate snapshot is captured). It must stop being a target.
      drop.setAttribute('data-droppable-disabled', 'true');
      expect(service.findDroppableAtPoint(200, 250, dragged, 'g')).toBeNull();
    });

    it('includes a droppable that becomes enabled during an active drag session', () => {
      const dragged = document.createElement('div');
      const drop = make('list', 'g', { top: 100, left: 100, right: 300, bottom: 400 }, true);

      service.beginDragSession('g');
      expect(service.findDroppableAtPoint(200, 250, dragged, 'g')).toBeNull();

      // Consumer re-enables it mid-drag — it must become targetable again.
      drop.removeAttribute('data-droppable-disabled');
      expect(service.findDroppableAtPoint(200, 250, dragged, 'g')).toBe(drop);
    });

    it('a disabled droppable does not occlude an enabled one it overlaps', () => {
      const dragged = document.createElement('div');
      const enabled = make('enabled', 'g', { top: 0, left: 0, right: 300, bottom: 300 });
      // Later in document order (would win the painter-order tie-break) but disabled.
      make('disabled', 'g', { top: 50, left: 50, right: 350, bottom: 350 }, true);

      service.beginDragSession('g');
      expect(service.findDroppableAtPoint(100, 100, dragged, 'g')).toBe(enabled);
    });

    it('excludes disabled droppables on the one-shot (no-session) path', () => {
      const dragged = document.createElement('div');
      make('disabled-list', 'g', { top: 100, left: 100, right: 300, bottom: 400 }, true);

      expect(service.findDroppableAtPoint(200, 250, dragged, 'g')).toBeNull();
    });

    it('skips a disabled droppable during adjacent (cross-list) navigation', () => {
      make('left', 'g', { top: 0, left: 0, right: 100, bottom: 100 });
      make('middle', 'g', { top: 0, left: 200, right: 300, bottom: 100 }, true);
      const right = make('right', 'g', { top: 0, left: 400, right: 500, bottom: 100 });

      const result = service.findAdjacentDroppable('left', 'right', 'g');
      expect(result?.id).toBe('right');
      expect(result?.element).toBe(right);
    });

    it('returns null when the only adjacent droppable is disabled', () => {
      make('left', 'g', { top: 0, left: 0, right: 100, bottom: 100 });
      make('right', 'g', { top: 0, left: 200, right: 300, bottom: 100 }, true);

      expect(service.findAdjacentDroppable('left', 'right', 'g')).toBeNull();
    });

    it('navigates out of a disabled current container to an enabled neighbour', () => {
      // The current container was disabled mid-drag (keyboard drag). Navigation must still
      // be able to escape it toward an enabled neighbour rather than trapping the drag.
      make('current', 'g', { top: 0, left: 0, right: 100, bottom: 100 }, true);
      const right = make('right', 'g', { top: 0, left: 200, right: 300, bottom: 100 });

      const result = service.findAdjacentDroppable('current', 'right', 'g');
      expect(result?.id).toBe('right');
      expect(result?.element).toBe(right);
    });

    it('reports a droppable as disabled by id via isDroppableDisabledById', () => {
      make('enabled', 'g', { top: 0, left: 0, right: 100, bottom: 100 });
      make('off', 'g', { top: 0, left: 200, right: 300, bottom: 100 }, true);

      expect(service.isDroppableDisabledById('off')).toBe(true);
      expect(service.isDroppableDisabledById('enabled')).toBe(false);
      // A missing droppable is treated as not a valid target.
      expect(service.isDroppableDisabledById('nonexistent')).toBe(true);
    });
  });
});
