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

      expect(service.getScrollGeometry(viewport, 50)).toEqual(
        expect.objectContaining({ scrollTop: 120, isVirtual: true }),
      );
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
