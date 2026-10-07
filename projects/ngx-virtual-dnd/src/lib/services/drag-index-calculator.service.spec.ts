import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CursorPosition, GrabOffset } from '../models/drag-drop.models';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';
import { DragIndexCalculatorService } from './drag-index-calculator.service';
import { PositionCalculatorService } from './position-calculator.service';

class MockStrategy implements VirtualScrollStrategy {
  readonly #version = signal(0);
  readonly version = this.#version.asReadonly();
  readonly #itemCount: number;
  readonly #itemHeight: number;
  readonly #heights: number[] | null;

  constructor(
    private readonly offsetMap: number[],
    private readonly indexAtOffset: (offset: number) => number,
    itemCount?: number,
    itemHeight?: number,
    heights?: number[],
  ) {
    this.#itemCount = itemCount ?? Math.max(0, offsetMap.length - 1);
    this.#itemHeight = itemHeight ?? 50;
    this.#heights = heights ?? null;
  }

  getTotalHeight(itemCount: number): number {
    return itemCount * 50;
  }

  getFirstVisibleIndex(scrollTop: number): number {
    return Math.floor(scrollTop / 50);
  }

  getVisibleCount(startIndex: number, containerHeight: number): number {
    void startIndex;
    return Math.ceil(containerHeight / 50);
  }

  getOffsetForIndex(index: number): number {
    return this.offsetMap[index] ?? this.offsetMap[this.offsetMap.length - 1] ?? 0;
  }

  getItemHeight(index: number): number {
    if (this.#heights && index >= 0 && index < this.#heights.length) {
      return this.#heights[index];
    }
    return this.#itemHeight;
  }

  setMeasuredHeight(key: unknown, height: number): void {
    void key;
    void height;
    // no-op for mock
  }

  setItemKeys(keys: unknown[]): void {
    void keys;
    // no-op for mock
  }

  setExcludedIndex(index: number | null): void {
    void index;
    // no-op for mock
  }

  findIndexAtOffset(offset: number): number {
    return this.indexAtOffset(offset);
  }

  getItemCount(): number {
    return this.#itemCount;
  }
}

describe('DragIndexCalculatorService', () => {
  let service: DragIndexCalculatorService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DragIndexCalculatorService, PositionCalculatorService],
    });
    service = TestBed.inject(DragIndexCalculatorService);
  });

  function createVirtualDroppable(
    id: string,
    opts: { itemHeight: number; totalItems: number; containerHeight?: number },
  ): HTMLElement {
    const droppable = document.createElement('div');
    droppable.setAttribute('data-droppable-id', id);
    droppable.setAttribute('data-droppable-group', 'test-group');

    const virtualScroll = document.createElement('vdnd-virtual-scroll');
    virtualScroll.setAttribute('data-item-height', String(opts.itemHeight));
    virtualScroll.setAttribute('data-total-items', String(opts.totalItems));

    const containerHeight = opts.containerHeight ?? 500;
    Object.defineProperty(virtualScroll, 'scrollTop', { value: 0, writable: true });
    jest.spyOn(virtualScroll, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 300,
      height: containerHeight,
      top: 0,
      right: 300,
      bottom: containerHeight,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    droppable.appendChild(virtualScroll);
    return droppable;
  }

  function createDroppable(id: string, itemCount = 5, constrained = false): HTMLElement {
    const droppable = document.createElement('div');
    droppable.setAttribute('data-droppable-id', id);
    droppable.setAttribute('data-droppable-group', 'test-group');
    if (constrained) {
      droppable.setAttribute('data-constrain-to-container', '');
    }

    for (let i = 0; i < itemCount; i++) {
      const child = document.createElement('div');
      child.setAttribute('data-draggable-id', `item-${i}`);
      droppable.appendChild(child);
    }

    jest.spyOn(droppable, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 300,
      height: 500,
      top: 0,
      right: 300,
      bottom: 500,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    return droppable;
  }

  function calculateIndex(args: {
    strategy: VirtualScrollStrategy;
    position: CursorPosition;
    previousPosition?: CursorPosition | null;
    grabOffset: GrabOffset | null;
    draggedItemHeight: number;
    sourceDroppableId: string | null;
    sourceIndex: number | null;
    itemCount?: number;
    constrained?: boolean;
  }): number {
    const droppable = createDroppable('list-1', args.itemCount ?? 5, args.constrained ?? false);
    service.registerStrategy('list-1', args.strategy);

    return service.calculatePlaceholderIndex({
      droppableElement: droppable,
      position: args.position,
      previousPosition: args.previousPosition ?? null,
      grabOffset: args.grabOffset,
      draggedItemHeight: args.draggedItemHeight,
      sourceDroppableId: args.sourceDroppableId,
      sourceIndex: args.sourceIndex,
    }).index;
  }

  it('applies same-list +1 when strategy does not yet exclude source index', () => {
    const strategy = new MockStrategy([0, 50, 100, 150, 200, 250], (offset) =>
      Math.floor(offset / 50),
    );

    const index = calculateIndex({
      strategy,
      position: { x: 10, y: 100 }, // center = 125 -> visual index 2
      grabOffset: null,
      draggedItemHeight: 50,
      sourceDroppableId: 'list-1',
      sourceIndex: 1,
    });

    expect(index).toBe(3);
  });

  it('does not double-adjust when strategy already excludes source index', () => {
    const strategy = new MockStrategy([0, 50, 50, 100, 150, 200], (offset) => {
      if (offset < 50) return 0;
      if (offset < 100) return 2;
      if (offset < 150) return 3;
      if (offset < 200) return 4;
      return 5;
    });

    const index = calculateIndex({
      strategy,
      position: { x: 10, y: 100 }, // center = 125 -> logical index 3
      grabOffset: null,
      draggedItemHeight: 50,
      sourceDroppableId: 'list-1',
      sourceIndex: 1,
    });

    expect(index).toBe(3);
  });

  it('allows constrained drag with tall preview to drop at top and bottom edges', () => {
    const strategy = new MockStrategy(
      [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600],
      (offset) => Math.floor(offset / 50),
    );
    const draggedItemHeight = 240;
    const grabOffset = { x: 20, y: 120 };

    const topIndex = calculateIndex({
      strategy,
      position: { x: 20, y: 121 }, // clamped top: preview top = 1px
      grabOffset,
      draggedItemHeight,
      sourceDroppableId: null,
      sourceIndex: null,
      itemCount: 12,
      constrained: true,
    });

    const bottomIndex = calculateIndex({
      strategy,
      position: { x: 20, y: 379 }, // clamped bottom: preview bottom = 499px
      grabOffset,
      draggedItemHeight,
      sourceDroppableId: null,
      sourceIndex: null,
      itemCount: 12,
      constrained: true,
    });

    expect(topIndex).toBe(0);
    expect(bottomIndex).toBe(12);
  });

  it('uses edge snapping in constrained mode so tall items can reach first slot', () => {
    const itemHeight = 65;
    const offsets = [0, 65, 130, 195, 260, 325, 390, 455, 520, 585, 650, 715, 780];
    const strategy = new MockStrategy(
      offsets,
      (offset) => Math.floor(offset / itemHeight),
      undefined,
      65,
    );
    const draggedItemHeight = 130;
    const grabOffset = { x: 20, y: 65 };

    // When clamped at container top, preview top ≈ 1px from container edge.
    // Edge snapping detects this and overrides to index 0.
    const index = calculateIndex({
      strategy,
      position: { x: 20, y: 66 }, // clamped to top: previewTop = 1
      grabOffset,
      draggedItemHeight,
      sourceDroppableId: null,
      sourceIndex: null,
      itemCount: 12,
      constrained: true,
    });

    expect(index).toBe(0);
  });

  it('snaps to the edges of the part of a constrained list that nothing pinned over it covers', () => {
    const strategy = new MockStrategy(
      [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600],
      (offset) => Math.floor(offset / 50),
    );
    // The list is its own vdndScrollable: a sticky header covers its top 100px of 500, a sticky
    // footer its bottom 60px
    const droppable = createDroppable('list-1', 12, true);
    droppable.setAttribute('data-scroll-inset-top', '100');
    droppable.setAttribute('data-scroll-inset-bottom', '60');
    service.registerStrategy('list-1', strategy);
    const indexAt = (y: number): number =>
      service.calculatePlaceholderIndex({
        droppableElement: droppable,
        position: { x: 20, y },
        previousPosition: null,
        grabOffset: { x: 20, y: 120 },
        draggedItemHeight: 240,
        sourceDroppableId: null,
        sourceIndex: null,
      }).index;

    // Clamped below the header: preview top 101
    expect(indexAt(221)).toBe(0);
    // Clamped above the footer: preview bottom 439
    expect(indexAt(319)).toBe(12);
  });

  it('snaps to the end near the bottom edge of the part of the list nothing covers', () => {
    // 8 rows of 50px fill 0..400 of a 500px list whose bottom 100px a sticky footer covers
    const strategy = new MockStrategy([0, 50, 100, 150, 200, 250, 300, 350, 400], (offset) =>
      Math.floor(offset / 50),
    );
    const droppable = createDroppable('list-1', 8);
    droppable.setAttribute('data-scroll-inset-bottom', '100');
    service.registerStrategy('list-1', strategy);

    const index = service.calculatePlaceholderIndex({
      droppableElement: droppable,
      // Preview 360..410: its center (385) is 15px above the footer, over the last row
      position: { x: 20, y: 360 },
      previousPosition: null,
      grabOffset: { x: 20, y: 0 },
      draggedItemHeight: 50,
      sourceDroppableId: null,
      sourceIndex: null,
    }).index;

    expect(index).toBe(8);
  });

  it('snaps to the top of the part of a constrained sortable list its rows are not covered in', () => {
    // vdnd-sortable-list: the droppable wraps the vdnd-virtual-scroll, which a header overlaid on
    // its rows covers 100px of
    const droppable = createVirtualDroppable('list-1', { itemHeight: 50, totalItems: 12 });
    droppable.setAttribute('data-constrain-to-container', '');
    jest.spyOn(droppable, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 500));
    droppable.querySelector('vdnd-virtual-scroll')!.setAttribute('data-scroll-inset-top', '100');
    service.registerStrategy(
      'list-1',
      new MockStrategy([0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600], (offset) =>
        Math.floor(offset / 50),
      ),
    );

    const index = service.calculatePlaceholderIndex({
      droppableElement: droppable,
      // Clamped below the header: preview top 101
      position: { x: 20, y: 221 },
      previousPosition: null,
      grabOffset: { x: 20, y: 120 },
      draggedItemHeight: 240,
      sourceDroppableId: null,
      sourceIndex: null,
    }).index;

    expect(index).toBe(0);
  });

  describe('revealSlot', () => {
    /** A vdnd-virtual-viewport (0..300) whose rows start 80px down, scrolled to `scrollTop` */
    function createViewport(scrollTop: number): HTMLElement {
      const viewport = document.createElement('div');
      viewport.setAttribute('data-droppable-id', 'list-1');
      viewport.setAttribute('data-virtual-viewport', '');
      viewport.setAttribute('data-content-offset', '80');
      viewport.setAttribute('data-scroll-inset-top', '40');
      viewport.setAttribute('data-scroll-inset-bottom', '30');
      viewport.getBoundingClientRect = () => new DOMRect(0, 0, 300, 300);
      viewport.scrollTop = scrollTop;
      service.registerStrategy(
        'list-1',
        new MockStrategy(
          Array.from({ length: 101 }, (_, i) => i * 50),
          (offset) => Math.floor(offset / 50),
        ),
      );
      return viewport;
    }

    it('should scroll a slot above the uncovered part down to its top edge', () => {
      const viewport = createViewport(1000);

      service.revealSlot(viewport, 10, 50);

      // Row 10 starts 500px into the rows, 580px into the viewport: 40px below its top
      expect(viewport.scrollTop).toBe(580 - 40);
    });

    it('should scroll a slot below the uncovered part up to its bottom edge', () => {
      const viewport = createViewport(0);

      service.revealSlot(viewport, 10, 50);

      // The slot ends 630px into the viewport; 270px show above the 30px covered at the bottom
      expect(viewport.scrollTop).toBe(630 - 270);
    });

    it('should leave a slot that shows in full where it is', () => {
      const viewport = createViewport(500);

      service.revealSlot(viewport, 10, 50);

      expect(viewport.scrollTop).toBe(500);
    });
  });

  describe('constrained edge snap on a scrollable list', () => {
    // 50 rows of 50px in a 400px list: max scrollTop = 2500 - 400 = 2100.
    const ROW = 50;
    const ROWS = 50;
    const LIST_HEIGHT = 400;
    const MAX_SCROLL = ROWS * ROW - LIST_HEIGHT;

    function mockRect(element: HTMLElement): void {
      jest.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        width: 300,
        height: LIST_HEIGHT,
        top: 0,
        right: 300,
        bottom: LIST_HEIGHT,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);
    }

    function mockScroll(element: HTMLElement, scrollTop: number): void {
      Object.defineProperty(element, 'scrollTop', { value: scrollTop, configurable: true });
      Object.defineProperty(element, 'clientHeight', { value: LIST_HEIGHT, configurable: true });
      Object.defineProperty(element, 'scrollHeight', { value: ROWS * ROW, configurable: true });
    }

    /** A constrained droppable whose rows scroll in its own element or an inner virtual scroll. */
    function createScrolledDroppable(
      container: 'viewport' | 'virtualScroll',
      scrollTop: number,
      firstRowHeight = ROW,
    ): HTMLElement {
      const droppable = document.createElement('div');
      droppable.setAttribute('data-droppable-id', 'scrolled');
      droppable.setAttribute('data-droppable-group', 'test-group');
      droppable.setAttribute('data-constrain-to-container', '');
      mockRect(droppable);

      if (container === 'viewport') {
        droppable.setAttribute('data-virtual-viewport', '');
        mockScroll(droppable, scrollTop);
      } else {
        const virtualScroll = document.createElement('vdnd-virtual-scroll');
        virtualScroll.setAttribute('data-item-height', String(ROW));
        virtualScroll.setAttribute('data-total-items', String(ROWS));
        mockRect(virtualScroll);
        mockScroll(virtualScroll, scrollTop);
        droppable.appendChild(virtualScroll);
      }

      const offsets = Array.from({ length: ROWS + 1 }, (_, i) =>
        i === 0 ? 0 : firstRowHeight + (i - 1) * ROW,
      );
      service.registerStrategy(
        'scrolled',
        new MockStrategy(offsets, (offset) =>
          offset < firstRowHeight
            ? 0
            : Math.min(ROWS - 1, 1 + Math.floor((offset - firstRowHeight) / ROW)),
        ),
      );
      return droppable;
    }

    function indexFor(args: {
      container: 'viewport' | 'virtualScroll';
      scrollTop: number;
      previewTop: number;
      previewHeight?: number;
      firstRowHeight?: number;
    }): number {
      const previewHeight = args.previewHeight ?? ROW;
      const grabOffset = { x: 20, y: previewHeight / 2 };
      return service.calculatePlaceholderIndex({
        droppableElement: createScrolledDroppable(
          args.container,
          args.scrollTop,
          args.firstRowHeight,
        ),
        position: { x: 20, y: args.previewTop + grabOffset.y },
        previousPosition: null,
        grabOffset,
        draggedItemHeight: previewHeight,
        sourceDroppableId: null,
        sourceIndex: null,
      }).index;
    }

    it('snaps page-scroll content to the first slot whatever its scroll parent scrollTop', () => {
      // vdnd-virtual-content in a vdndScrollable parent scrolled by 900px of content above the
      // list: the droppable rect spans all rows, so a preview at its top is at the first row.
      const scrollable = document.createElement('div');
      scrollable.classList.add('vdnd-scrollable');
      mockRect(scrollable);
      mockScroll(scrollable, 900);
      const content = document.createElement('vdnd-virtual-content');
      content.setAttribute('data-content-offset', '900');
      const droppable = document.createElement('div');
      droppable.setAttribute('data-droppable-id', 'page-list');
      droppable.setAttribute('data-droppable-group', 'test-group');
      droppable.setAttribute('data-constrain-to-container', '');
      jest.spyOn(droppable, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        width: 300,
        height: ROWS * ROW,
        top: 0,
        right: 300,
        bottom: ROWS * ROW,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);
      content.appendChild(droppable);
      scrollable.appendChild(content);
      const offsets = Array.from({ length: ROWS + 1 }, (_, i) => i * ROW);
      service.registerStrategy(
        'page-list',
        new MockStrategy(offsets, (offset) =>
          Math.max(0, Math.min(ROWS - 1, Math.floor(offset / ROW))),
        ),
      );

      // A 240px preview 1px below the top: its probe reaches row 2, the snap gives 0
      const index = service.calculatePlaceholderIndex({
        droppableElement: droppable,
        position: { x: 20, y: 121 },
        previousPosition: null,
        grabOffset: { x: 20, y: 120 },
        draggedItemHeight: 240,
        sourceDroppableId: null,
        sourceIndex: null,
      }).index;
      expect(index).toBe(0);
    });

    describe.each(['viewport', 'virtualScroll'] as const)('in a %s', (container) => {
      it('keeps the visible top row when the preview is pinned at the top of a scrolled list', () => {
        // Preview top 1px below the list top at scrollTop 900: the capped probe is at
        // 26 + 900 = 926 → row 18, the first visible row. Snapping to 0 would drop the item
        // 18 rows above anything the user can see.
        expect(indexFor({ container, scrollTop: 900, previewTop: 1 })).toBe(18);
        expect(indexFor({ container, scrollTop: 900, previewTop: 2 })).toBe(18);
      });

      it('keeps the visible bottom row when the preview is pinned at the bottom of a scrolled list', () => {
        // Preview bottom 1px above the list bottom at scrollTop 900: probe 374 + 900 = 1274 → row 25.
        expect(indexFor({ container, scrollTop: 900, previewTop: LIST_HEIGHT - ROW - 1 })).toBe(25);
        expect(indexFor({ container, scrollTop: 900, previewTop: LIST_HEIGHT - ROW - 2 })).toBe(25);
      });

      it('still snaps to the first slot once the list is scrolled to its top', () => {
        // A 20px first row: the probe (at least 25px below the preview top) lands in row 1 or
        // further, so only the snap reaches slot 0.
        const top = { container, previewTop: 1, previewHeight: 240, firstRowHeight: 20 };
        expect(indexFor({ ...top, scrollTop: 0 })).toBe(0);
        // Fractional scrollTop (zoom/DPR) still counts as the top
        expect(indexFor({ ...top, scrollTop: 0.5 })).toBe(0);
        // Scrolled down a little: no snap, the probe's row
        expect(indexFor({ ...top, scrollTop: 10 })).toBeGreaterThan(0);
      });

      it('still snaps to the end once the list is scrolled to its bottom', () => {
        // A 240px preview pinned at the bottom: its probe reaches row 45 only, the snap gives 50.
        const previewTop = LIST_HEIGHT - 240 - 1;
        expect(indexFor({ container, scrollTop: MAX_SCROLL, previewTop, previewHeight: 240 })).toBe(
          ROWS,
        );
        // Fractional scrollTop just short of the integer max still counts as the bottom
        expect(
          indexFor({ container, scrollTop: MAX_SCROLL - 0.5, previewTop, previewHeight: 240 }),
        ).toBe(ROWS);
        // 100px short of the bottom: no snap, the visible bottom row (probe 374 + 2000 → row 47)
        expect(
          indexFor({ container, scrollTop: MAX_SCROLL - 100, previewTop: LIST_HEIGHT - ROW - 1 }),
        ).toBe(47);
      });
    });
  });

  it('uses center probe for dynamic heights regardless of direction', () => {
    const itemHeight = 65;
    const offsets = [0, 65, 130, 195, 260, 325];
    const strategy = new MockStrategy(
      offsets,
      (offset) => Math.floor(offset / itemHeight),
      5,
      itemHeight,
    );

    // Preview center at same position, different directions → same result
    // grabOffset y=65 (center of 130px preview), so center = position.y
    const upResult = calculateIndex({
      strategy,
      position: { x: 20, y: 97 },
      previousPosition: { x: 20, y: 110 }, // moving up
      grabOffset: { x: 20, y: 65 },
      draggedItemHeight: 130,
      sourceDroppableId: null,
      sourceIndex: null,
      itemCount: 5,
      constrained: false,
    });

    const downResult = calculateIndex({
      strategy,
      position: { x: 20, y: 97 },
      previousPosition: { x: 20, y: 90 }, // moving down
      grabOffset: { x: 20, y: 65 },
      draggedItemHeight: 130,
      sourceDroppableId: null,
      sourceIndex: null,
      itemCount: 5,
      constrained: false,
    });

    // Center probe: previewTop = 97 - 65 = 32, center = 32 + 65 = 97
    // relativeY = 97, floor(97/65) = 1. Same index regardless of direction.
    expect(upResult).toBe(1);
    expect(downResult).toBe(1);
  });

  it('center probe gives balanced threshold for mixed-height dynamic items', () => {
    const heights = [200, 60, 60];
    const strategy = new MockStrategy(
      [0, 200, 260, 320],
      (offset) => {
        if (offset < 200) return 0;
        if (offset < 260) return 1;
        if (offset < 320) return 2;
        return 3;
      },
      3,
      undefined,
      heights,
    );

    // 100px preview, grabOffset y=50, position y=280 → center = 280
    // relativeY = 280 → findIndexAtOffset(280) = 2
    const index = calculateIndex({
      strategy,
      position: { x: 20, y: 280 },
      previousPosition: { x: 20, y: 270 }, // moving down
      grabOffset: { x: 20, y: 50 },
      draggedItemHeight: 100,
      sourceDroppableId: null,
      sourceIndex: null,
      itemCount: 3,
      constrained: false,
    });

    expect(index).toBe(2);
  });

  it('caps probe depth so tall preview among short items does not jump multiple positions', () => {
    // 10 items at 60px each. Item-1 (120px) is being dragged.
    // Strategy has exclusion applied: item-1 collapsed to 0 height.
    // Post-exclusion: [item-0: 0-60] [item-2: 60-120] [item-3: 120-180] ...
    const offsets = [0, 60, 60, 120, 180, 240, 300, 360, 420, 480];
    const strategy = new MockStrategy(
      offsets,
      (offset) => {
        if (offset < 60) return 0;
        if (offset < 120) return 2;
        if (offset < 180) return 3;
        if (offset < 240) return 4;
        if (offset < 300) return 5;
        if (offset < 360) return 6;
        if (offset < 420) return 7;
        if (offset < 480) return 8;
        return 9;
      },
      9,
      60,
    );

    const droppable = createVirtualDroppable('list-v', {
      itemHeight: 60,
      totalItems: 9,
    });
    service.registerStrategy('list-v', strategy);

    // Preview is 120px, grabbed at center (grabOffset.y = 60).
    // Cursor at y=123: tiny movement from item-1's original position.
    //   previewTop = 123 - 60 = 63
    //   previewCenter = 63 + 60 = 123
    // Without cap: relativeY = 123 → findIndexAtOffset(123) = 3 (2-item jump!)
    // With cap: relativeY = min(123, 63 + 30) = 93 → findIndexAtOffset(93) = 2 (1-item move)
    const result = service.calculatePlaceholderIndex({
      droppableElement: droppable,
      position: { x: 10, y: 123 },
      previousPosition: null,
      grabOffset: { x: 10, y: 60 },
      draggedItemHeight: 120,
      sourceDroppableId: 'list-v',
      sourceIndex: 1,
    });

    expect(result.index).toBe(2);
  });

  it('does not displace a tall item until preview top passes its midpoint', () => {
    // Item-0 is 150px, items 1-5 are 60px. Item-4 excluded (being dragged).
    // Offsets with exclusion: [0, 150, 210, 270, 330(item-4 collapsed), 330, 390]
    const offsets = [0, 150, 210, 270, 330, 330, 390];
    const strategy = new MockStrategy(
      offsets,
      (offset) => {
        if (offset < 150) return 0;
        if (offset < 210) return 1;
        if (offset < 270) return 2;
        if (offset < 330) return 3;
        if (offset < 390) return 5;
        return 6;
      },
      6,
      undefined,
      [150, 60, 60, 60, 0, 60],
    );

    const droppable = createVirtualDroppable('list-v2', {
      itemHeight: 80,
      totalItems: 6,
    });
    service.registerStrategy('list-v2', strategy);

    // Preview top at 119: 31px into the 150px item, midpoint is at 75.
    // Preview top (119) > midpoint (75) → should NOT displace (placeholder = 1).
    const shallowOverlap = service.calculatePlaceholderIndex({
      droppableElement: droppable,
      position: { x: 10, y: 119 },
      previousPosition: null,
      grabOffset: null,
      draggedItemHeight: 60,
      sourceDroppableId: 'list-v2',
      sourceIndex: 4,
    });

    // Preview top at 74: 76px into the 150px item, past midpoint.
    // Preview top (74) < midpoint (75) → should displace (placeholder = 0).
    const deepOverlap = service.calculatePlaceholderIndex({
      droppableElement: droppable,
      position: { x: 10, y: 74 },
      previousPosition: null,
      grabOffset: null,
      draggedItemHeight: 60,
      sourceDroppableId: 'list-v2',
      sourceIndex: 4,
    });

    expect(shallowOverlap.index).toBe(1);
    expect(deepOverlap.index).toBe(0);
  });

  it('constrained mode gives same index as unconstrained for dynamic heights', () => {
    // Items: [150px, 60px, 60px, 60px, 60px]
    // Offsets: [0, 150, 210, 270, 330, 390]
    // Regression: constrained mode used to probe at the preview top instead of the capped
    // center, so the placeholder lagged one item behind the unconstrained result.
    const offsets = [0, 150, 210, 270, 330, 390];
    const strategy = new MockStrategy(
      offsets,
      (offset) => {
        if (offset < 150) return 0;
        if (offset < 210) return 1;
        if (offset < 270) return 2;
        if (offset < 330) return 3;
        if (offset < 390) return 4;
        return 5;
      },
      5,
      80,
      [150, 60, 60, 60, 60],
    );

    const grabOffset = { x: 20, y: 60 };
    // The droppable declares no data-item-height, so the probe cap uses the dragged item
    // height (120) — the strategy's own item height is not consulted.
    // At y=250: preview top = 190 (in item 1, 150-210), center = 250,
    // capped center = min(250, 190 + 120/2) = 250 (in item 2, 210-270) → index 2.
    // Midpoint of item 2 = 240; preview top 190 < 240 → stays at 2.
    // The old top-edge probe hit findIndexAtOffset(190) = 1 instead.
    const position = { x: 20, y: 250 };

    const unconstrainedIndex = calculateIndex({
      strategy,
      position,
      grabOffset,
      draggedItemHeight: 120,
      sourceDroppableId: null,
      sourceIndex: null,
      itemCount: 5,
      constrained: false,
    });

    const constrainedIndex = calculateIndex({
      strategy,
      position,
      grabOffset,
      draggedItemHeight: 120,
      sourceDroppableId: null,
      sourceIndex: null,
      itemCount: 5,
      constrained: true,
    });

    // Both should give index 2 — cursor center is solidly in item 2's range
    expect(unconstrainedIndex).toBe(2);
    expect(constrainedIndex).toBe(2);
  });

  it('uses fixed-height math for a plain list without a registered strategy', () => {
    // 5 rendered draggables, no strategy: the dragged item height (50) is the row height.
    const droppable = createDroppable('plain-list', 5);
    const args = {
      droppableElement: droppable,
      position: { x: 10, y: 100 }, // center = 125 -> visual index 2
      previousPosition: null,
      grabOffset: null,
      draggedItemHeight: 50,
      sourceIndex: 1,
    };

    // Same list: the hidden source item is still in the DOM, so indexes at/after it shift by 1
    expect(
      service.calculatePlaceholderIndex({ ...args, sourceDroppableId: 'plain-list' }).index,
    ).toBe(3);
    expect(
      service.calculatePlaceholderIndex({ ...args, sourceDroppableId: 'other-list' }).index,
    ).toBe(2);
  });

  describe('a plain list on later frames of a drag', () => {
    /** The preview near the list's bottom edge, which snaps the placeholder to the end */
    const atBottomEdge = (droppable: HTMLElement) => ({
      droppableElement: droppable,
      position: { x: 10, y: 440 },
      previousPosition: null,
      grabOffset: null,
      draggedItemHeight: 50,
      sourceDroppableId: null,
      sourceIndex: null,
    });

    it('does not look for virtual containers in the DOM again', () => {
      const droppable = createDroppable('plain-list', 5);
      // The first frame resolves the droppable
      expect(service.calculatePlaceholderIndex(atBottomEdge(droppable)).index).toBe(5);
      const querySelector = jest.spyOn(droppable, 'querySelector');
      const closest = jest.spyOn(droppable, 'closest');
      const matches = jest.spyOn(droppable, 'matches');

      expect(service.calculatePlaceholderIndex(atBottomEdge(droppable)).index).toBe(5);

      expect(querySelector).not.toHaveBeenCalled();
      expect(closest).not.toHaveBeenCalled();
      expect(matches).not.toHaveBeenCalled();
    });

    it('counts the items it renders now', () => {
      const droppable = createDroppable('plain-list', 5);
      expect(service.calculatePlaceholderIndex(atBottomEdge(droppable)).index).toBe(5);

      const added = document.createElement('div');
      added.setAttribute('data-draggable-id', 'item-5');
      droppable.appendChild(added);

      expect(service.calculatePlaceholderIndex(atBottomEdge(droppable)).index).toBe(6);
    });
  });

  it('snaps to the end of the list when the preview reaches the bottom edge', () => {
    // 12 rows (600px) in a 500px box scrolled to its max (100px).
    const droppable = createDroppable('plain-list', 12);
    droppable.scrollTop = 100;

    // Preview center 480 → content offset 580 → last row (11). The math alone can never
    // reach 12 (max scroll), so being within one row of the bottom edge snaps to the end.
    const result = service.calculatePlaceholderIndex({
      droppableElement: droppable,
      position: { x: 10, y: 455 },
      previousPosition: null,
      grabOffset: null,
      draggedItemHeight: 50,
      sourceDroppableId: null,
      sourceIndex: null,
    });

    expect(result.index).toBe(12);
  });

  describe('vdnd-virtual-viewport droppable', () => {
    /** A viewport droppable (300px tall, at the top of the page) with 30 rows of 50px. */
    function createViewport(contentOffset: number): HTMLElement {
      const viewport = document.createElement('vdnd-virtual-viewport');
      viewport.setAttribute('data-virtual-viewport', '');
      viewport.setAttribute('data-droppable-id', 'viewport');
      viewport.setAttribute('data-droppable-group', 'test-group');
      viewport.setAttribute('data-content-offset', String(contentOffset));
      jest.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        width: 300,
        height: 300,
        top: 0,
        right: 300,
        bottom: 300,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect);
      service.registerStrategy(
        'viewport',
        new MockStrategy([0, 50, 100, 150, 200], (offset) => Math.floor(offset / 50), 30),
      );
      return viewport;
    }

    it('measures rows from below the content offset', () => {
      // 80px reserved above the rows: the second row spans 130-180 and the preview covers it
      const result = service.calculatePlaceholderIndex({
        droppableElement: createViewport(80),
        position: { x: 10, y: 155 },
        previousPosition: null,
        grabOffset: { x: 10, y: 25 },
        draggedItemHeight: 50,
        sourceDroppableId: 'other-list',
        sourceIndex: 0,
      });

      expect(result.index).toBe(1);
    });

    it('reports the scroll offset of the rows below the content offset', () => {
      const viewport = createViewport(80);
      viewport.scrollTop = 200;

      expect(service.getScrollGeometry(viewport, 50).scrollTop).toBe(120);
    });

    it('measures the viewport itself even when a row holds another virtual list', () => {
      const viewport = createViewport(0);
      viewport.scrollTop = 200;
      const nested = document.createElement('vdnd-virtual-scroll');
      nested.scrollTop = 30;
      viewport.appendChild(nested);

      expect(service.getScrollGeometry(viewport, 50).scrollTop).toBe(200);
    });
  });

  it('reads the scroll offset of a vdndScrollable ancestor outside the shadow root of a vdnd-virtual-content list', () => {
    const scrollable = document.createElement('div');
    scrollable.className = 'vdnd-scrollable';
    scrollable.scrollTop = 200;
    const host = document.createElement('div');
    scrollable.appendChild(host);
    const content = document.createElement('vdnd-virtual-content');
    content.setAttribute('data-droppable-id', 'shadow-content');
    content.setAttribute('data-droppable-group', 'test-group');
    host.attachShadow({ mode: 'open' }).appendChild(content);
    document.body.appendChild(scrollable);

    try {
      expect(service.getScrollGeometry(content, 50).scrollTop).toBe(200);
    } finally {
      scrollable.remove();
    }
  });

  it('finds the vdnd-virtual-content around a droppable inside a shadow root', () => {
    const scrollable = document.createElement('div');
    scrollable.className = 'vdnd-scrollable';
    scrollable.scrollTop = 200;
    const content = document.createElement('vdnd-virtual-content');
    scrollable.appendChild(content);
    const host = document.createElement('div');
    content.appendChild(host);
    const droppable = document.createElement('div');
    droppable.setAttribute('data-droppable-id', 'shadow-list');
    droppable.setAttribute('data-droppable-group', 'test-group');
    host.attachShadow({ mode: 'open' }).appendChild(droppable);
    document.body.appendChild(scrollable);

    try {
      // Measured as page-level content scrolled by the vdndScrollable, not as a plain list
      expect(service.getScrollGeometry(droppable, 50)).toEqual(
        expect.objectContaining({ scrollTop: 200, isVirtual: true }),
      );
    } finally {
      scrollable.remove();
    }
  });

  it('uses registered strategy item count for direct virtualized lists', () => {
    const droppable = createDroppable('list-direct', 3);
    const strategy = new MockStrategy([0, 50, 100, 150], (offset) => Math.floor(offset / 50), 100);
    service.registerStrategy('list-direct', strategy);

    const totalCount = service.getTotalItemCount({
      droppableElement: droppable,
      isSameList: false,
      draggedItemHeight: 50,
    });

    expect(totalCount).toBe(100);
  });
});
