import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { VirtualForDirective } from './virtual-for.directive';
import { ScrollableDirective } from './scrollable.directive';
import { VirtualViewportComponent } from '../components/virtual-viewport.component';
import { VirtualContentComponent } from '../components/virtual-content.component';
import { DragStateService } from '../services/drag-state.service';
import { VDND_ANIMATION_CONFIG } from '../tokens/animation-config.token';
import { VDND_SCROLL_CONTAINER, VdndScrollContainer } from '../tokens/scroll-container.token';
import { VDND_VIRTUAL_VIEWPORT, VdndVirtualViewport } from '../tokens/virtual-viewport.token';
import { FixedHeightStrategy } from '../strategies/fixed-height.strategy';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';
import { END_OF_LIST } from '../models/drag-drop.models';
import { DropAnimator } from '../utils/drop-animator';

const nextAnimationFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

interface TestItem {
  id: string;
  key: string;
  label: string;
  parts: string[];
}

class MockResizeObserver {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}

@Component({
  template: `
    <vdnd-virtual-viewport [itemHeight]="50" style="height: 200px;">
      <ng-container *vdndVirtualFor="let item of items(); trackBy: trackByFn">
        <div class="item" [attr.data-id]="item.id">
          <span class="label">{{ item.label }}</span>
          <div class="parts">
            @for (part of item.parts; track part) {
              <span class="part">{{ part }}</span>
            }
          </div>
        </div>
      </ng-container>
    </vdnd-virtual-viewport>
  `,
  imports: [VirtualViewportComponent, VirtualForDirective],
})
class TestHostComponent {
  readonly items = signal<TestItem[]>([]);
  readonly trackByFn = (_index: number, item: TestItem): string => item.key;
}

@Component({
  template: `
    <vdnd-virtual-viewport [itemHeight]="50" [dynamicItemHeight]="true" style="height: 200px;">
      <ng-container
        *vdndVirtualFor="let item of items(); trackBy: trackByFn; dynamicItemHeight: true"
      >
        <div class="item" [attr.data-id]="item.id" [style.height.px]="item.height">
          {{ item.label }}
        </div>
      </ng-container>
    </vdnd-virtual-viewport>
  `,
  imports: [VirtualViewportComponent, VirtualForDirective],
})
class DynamicHeightTestHostComponent {
  readonly items = signal<{ id: string; key: string; label: string; height: number }[]>([]);
  readonly trackByFn = (_index: number, item: { key: string }): string => item.key;
}

/** Counts the calls of its trackBy function, which returns the item ID (the draggable ID) */
@Component({
  template: `
    <vdnd-virtual-viewport [itemHeight]="50" [dynamicItemHeight]="dynamic()" style="height: 200px;">
      <ng-container *vdndVirtualFor="let item of items(); trackBy: trackByFn; droppableId: 'list'">
        <div class="item" [attr.data-id]="item.id">{{ item.label }}</div>
      </ng-container>
    </vdnd-virtual-viewport>
  `,
  imports: [VirtualViewportComponent, VirtualForDirective],
})
class TrackCountingHostComponent {
  readonly items = signal<TestItem[]>([]);
  readonly dynamic = signal(false);
  trackCalls = 0;
  readonly trackByFn = (_index: number, item: TestItem): string => {
    this.trackCalls++;
    return item.id;
  };
}

/** A FixedHeightStrategy subclass that uses the keys: it overrides setItemKeys */
class KeyRecordingFixedStrategy extends FixedHeightStrategy {
  keys: unknown[] | null = null;

  override setItemKeys(keys: unknown[]): void {
    this.keys = [...keys];
    super.setItemKeys(keys);
  }
}

/** A consumer's own strategy that reorders the keys array it is given */
class ReorderingStrategy implements VirtualScrollStrategy {
  readonly #fixed = new FixedHeightStrategy(50);
  readonly version = this.#fixed.version;
  excludedIndex: number | null = null;

  getTotalHeight(itemCount: number): number {
    return this.#fixed.getTotalHeight(itemCount);
  }
  getFirstVisibleIndex(scrollTop: number): number {
    return this.#fixed.getFirstVisibleIndex(scrollTop);
  }
  getVisibleCount(startIndex: number, containerHeight: number): number {
    return this.#fixed.getVisibleCount(startIndex, containerHeight);
  }
  getOffsetForIndex(index: number): number {
    return this.#fixed.getOffsetForIndex(index);
  }
  getItemHeight(index: number): number {
    return this.#fixed.getItemHeight(index);
  }
  setMeasuredHeight(key: unknown, height: number): void {
    this.#fixed.setMeasuredHeight(key, height);
  }
  setItemKeys(keys: unknown[]): void {
    keys.reverse();
    this.#fixed.setItemKeys(keys);
  }
  setExcludedIndex(index: number | null): void {
    this.excludedIndex = index;
    this.#fixed.setExcludedIndex(index);
  }
  findIndexAtOffset(offset: number): number {
    return this.#fixed.findIndexAtOffset(offset);
  }
  getItemCount(): number {
    return this.#fixed.getItemCount();
  }
}

/** A viewport of the consumer's own, which provides the strategy the directive uses */
@Component({
  template: `
    <ng-container *vdndVirtualFor="let item of items; trackBy: trackByFn; droppableId: 'list'">
      <div class="item" [attr.data-id]="item.id">{{ item.label }}</div>
    </ng-container>
  `,
  imports: [VirtualForDirective],
  providers: [
    { provide: VDND_SCROLL_CONTAINER, useExisting: CustomViewportHostComponent },
    { provide: VDND_VIRTUAL_VIEWPORT, useExisting: CustomViewportHostComponent },
  ],
})
class CustomViewportHostComponent implements VdndScrollContainer, VdndVirtualViewport {
  readonly items: TestItem[] = Array.from({ length: 20 }, (_, i) => ({
    id: `item-${i}`,
    key: `key-${i}`,
    label: `Item ${i}`,
    parts: [],
  }));
  readonly trackByFn = (_index: number, item: TestItem): string => item.id;

  /** Set before the first change detection */
  strategy: VirtualScrollStrategy = new FixedHeightStrategy(50);

  readonly scrollTop = signal(0);
  readonly containerHeight = signal(200);
  readonly itemHeight = (): number => 50;
  readonly contentOffset = (): number => 0;
  readonly nativeElement = document.createElement('div');
  readonly scrollTo = jest.fn();
  readonly setRenderStartIndex = jest.fn();

  getOffsetForIndex(index: number): number {
    return this.strategy.getOffsetForIndex(index);
  }
}

/** Rows 0..29 of 50px, for lists whose rows start 400px down: deeper than the 3-row overscan */
const offsetListItems = (): TestItem[] =>
  Array.from({ length: 30 }, (_, i) => ({
    id: `item-${i}`,
    key: `key-${i}`,
    label: `Item ${i}`,
    parts: [],
  }));

@Component({
  template: `
    <vdnd-virtual-viewport [itemHeight]="50" [contentOffset]="400" style="height: 300px;">
      <ng-container *vdndVirtualFor="let item of items; trackBy: trackByFn">
        <div class="item" [attr.data-id]="item.id">{{ item.label }}</div>
      </ng-container>
    </vdnd-virtual-viewport>
  `,
  imports: [VirtualViewportComponent, VirtualForDirective],
})
class ContentOffsetViewportHostComponent {
  readonly items = offsetListItems();
  readonly trackByFn = (_index: number, item: TestItem): string => item.key;
}

@Component({
  template: `
    <vdnd-virtual-content [itemHeight]="50" [contentOffset]="400">
      <ng-container *vdndVirtualFor="let item of items; trackBy: trackByFn">
        <div class="item" [attr.data-id]="item.id">{{ item.label }}</div>
      </ng-container>
    </vdnd-virtual-content>
  `,
  imports: [VirtualContentComponent, VirtualForDirective],
  providers: [{ provide: VDND_SCROLL_CONTAINER, useExisting: ContentOffsetPageHostComponent }],
})
class ContentOffsetPageHostComponent implements VdndScrollContainer {
  readonly items = offsetListItems();
  readonly trackByFn = (_index: number, item: TestItem): string => item.key;

  // The page-level scroll container the content sits in
  scrollTop = signal(0);
  containerHeight = signal(300);
  nativeElement = document.createElement('div');
  scrollTo = jest.fn();
}

describe('VirtualForDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let component: TestHostComponent;
  let originalResizeObserver: typeof ResizeObserver;

  const makeItems = (count: number): TestItem[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `item-${i}`,
      key: `key-${i}`,
      label: `Item ${i}`,
      parts: [],
    }));

  const renderedIds = (): string[] =>
    fixture.debugElement
      .queryAll(By.css('.item'))
      .map((el) => (el.nativeElement as HTMLElement).getAttribute('data-id') ?? '');

  beforeAll(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  beforeEach(() => {
    // jsdom has no layout: give the viewport its 200px height (4 rows of 50px)
    jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);

    TestBed.configureTestingModule({
      imports: [TestHostComponent],
    });

    fixture = TestBed.createComponent(TestHostComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    jest.restoreAllMocks();
  });

  it('should render item views for unique trackBy keys', () => {
    component.items.set([
      { id: 'item-1', key: 'a', label: 'A', parts: ['a1'] },
      { id: 'item-2', key: 'b', label: 'B', parts: ['b1', 'b2'] },
      { id: 'item-3', key: 'c', label: 'C', parts: ['c1'] },
    ]);

    fixture.detectChanges();

    const renderedItems = fixture.debugElement.queryAll(By.css('.item'));
    expect(renderedItems.length).toBe(3);
  });

  it('should skip and warn about items whose trackBy key collides', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    component.items.set([
      { id: 'item-1', key: 'a', label: 'A1', parts: ['a'] },
      { id: 'item-2', key: 'b', label: 'B', parts: ['b'] },
      { id: 'item-3', key: 'c', label: 'C', parts: ['c'] },
      { id: 'item-4', key: 'a', label: 'A2', parts: ['a', 'a2'] },
    ]);

    expect(() => fixture.detectChanges()).not.toThrow();
    expect(renderedIds()).toHaveLength(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate trackBy key'));
  });

  it('should render the new items when replacing the full item list', () => {
    component.items.set([
      { id: 'item-1', key: '1', label: 'One', parts: ['1a'] },
      { id: 'item-2', key: '2', label: 'Two', parts: ['2a', '2b'] },
      { id: 'item-3', key: '3', label: 'Three', parts: ['3a'] },
      { id: 'item-4', key: '4', label: 'Four', parts: ['4a', '4b', '4c'] },
    ]);
    fixture.detectChanges();

    component.items.set([
      { id: 'item-10', key: '10', label: 'Ten', parts: ['10a', '10b'] },
      { id: 'item-11', key: '11', label: 'Eleven', parts: ['11a'] },
      { id: 'item-12', key: '12', label: 'Twelve', parts: ['12a', '12b', '12c'] },
      { id: 'item-13', key: '13', label: 'Thirteen', parts: ['13a'] },
      { id: 'item-14', key: '14', label: 'Fourteen', parts: ['14a', '14b'] },
    ]);
    fixture.detectChanges();

    expect(renderedIds()).toEqual(['item-10', 'item-11', 'item-12', 'item-13', 'item-14']);
  });

  it('should reconcile nested @for content when list shape changes', () => {
    component.items.set([
      { id: 'item-a', key: 'a', label: 'Alpha', parts: ['p1', 'p2', 'p3'] },
      { id: 'item-b', key: 'b', label: 'Beta', parts: ['q1'] },
      { id: 'item-c', key: 'c', label: 'Gamma', parts: ['r1', 'r2'] },
    ]);
    fixture.detectChanges();

    component.items.set([
      { id: 'item-x', key: 'x', label: 'Xray', parts: ['x1'] },
      { id: 'item-y', key: 'y', label: 'Yankee', parts: ['y1', 'y2', 'y3', 'y4'] },
      { id: 'item-z', key: 'z', label: 'Zulu', parts: [] },
      { id: 'item-w', key: 'w', label: 'Whiskey', parts: ['w1', 'w2'] },
    ]);

    fixture.detectChanges();

    expect(renderedIds()).toEqual(['item-x', 'item-y', 'item-z', 'item-w']);
    const parts = fixture.debugElement
      .queryAll(By.css('.part'))
      .map((el) => (el.nativeElement as HTMLElement).textContent);
    expect(parts).toEqual(['x1', 'y1', 'y2', 'y3', 'y4', 'w1', 'w2']);
  });

  describe('virtual rendering', () => {
    it('should only render visible items plus overscan', () => {
      // 200px viewport / 50px rows = 4 visible, + 3 overscan below (none above at the top)
      component.items.set(makeItems(20));
      fixture.detectChanges();

      expect(renderedIds()).toEqual(makeItems(8).map((item) => item.id));
    });

    it('should render all items when list fits entirely in viewport', () => {
      component.items.set(makeItems(3));
      fixture.detectChanges();

      expect(renderedIds()).toEqual(['item-0', 'item-1', 'item-2']);
    });

    it('should render zero items for an empty list', () => {
      component.items.set([]);
      fixture.detectChanges();

      expect(renderedIds()).toEqual([]);
    });
  });

  describe('item positioning via viewport wrapper', () => {
    it('should position the viewport wrapper instead of each item', () => {
      component.items.set(makeItems(5));
      fixture.detectChanges();

      const wrapper = fixture.debugElement.query(By.css('.vdnd-viewport-content'));
      expect((wrapper.nativeElement as HTMLElement).style.transform).toBe('translateY(0px)');
      // Items stay in normal flow inside the wrapper
      const items = fixture.debugElement.queryAll(By.css('.item'));
      expect(items.every((item) => (item.nativeElement as HTMLElement).style.position === '')).toBe(
        true,
      );
    });
  });

  describe('view recycling with trackBy', () => {
    it('should reuse existing views when items are reordered', () => {
      component.items.set([
        { id: 'item-1', key: 'a', label: 'A', parts: [] },
        { id: 'item-2', key: 'b', label: 'B', parts: [] },
        { id: 'item-3', key: 'c', label: 'C', parts: [] },
      ]);
      fixture.detectChanges();

      const beforeElements = fixture.debugElement
        .queryAll(By.css('.item'))
        .map((el) => el.nativeElement as HTMLElement);

      // Reorder: swap first and last
      component.items.set([
        { id: 'item-3', key: 'c', label: 'C', parts: [] },
        { id: 'item-2', key: 'b', label: 'B', parts: [] },
        { id: 'item-1', key: 'a', label: 'A', parts: [] },
      ]);
      fixture.detectChanges();

      const afterElements = fixture.debugElement
        .queryAll(By.css('.item'))
        .map((el) => el.nativeElement as HTMLElement);

      // Same DOM nodes, moved — not destroyed and re-created
      expect(afterElements).toEqual([beforeElements[2], beforeElements[1], beforeElements[0]]);
      expect(afterElements.map((el) => el.getAttribute('data-id'))).toEqual([
        'item-3',
        'item-2',
        'item-1',
      ]);
    });

    it('should update context when item data changes but key remains the same', () => {
      component.items.set([{ id: 'item-1', key: 'a', label: 'Original', parts: [] }]);
      fixture.detectChanges();

      const label = fixture.debugElement.query(By.css('.label'));
      expect(label.nativeElement.textContent.trim()).toBe('Original');

      component.items.set([{ id: 'item-1', key: 'a', label: 'Updated', parts: [] }]);
      fixture.detectChanges();

      const updatedLabel = fixture.debugElement.query(By.css('.label'));
      expect(updatedLabel.nativeElement).toBe(label.nativeElement);
      expect(updatedLabel.nativeElement.textContent.trim()).toBe('Updated');
    });

    it('should remove views for items no longer in the list', () => {
      component.items.set([
        { id: 'item-1', key: 'a', label: 'A', parts: [] },
        { id: 'item-2', key: 'b', label: 'B', parts: [] },
        { id: 'item-3', key: 'c', label: 'C', parts: [] },
      ]);
      fixture.detectChanges();
      expect(fixture.debugElement.queryAll(By.css('.item')).length).toBe(3);

      component.items.set([{ id: 'item-1', key: 'a', label: 'A', parts: [] }]);
      fixture.detectChanges();
      expect(renderedIds()).toEqual(['item-1']);
    });
  });
});

describe('VirtualForDirective (track keys)', () => {
  let fixture: ComponentFixture<TrackCountingHostComponent>;
  let host: TrackCountingHostComponent;
  let dragState: DragStateService;
  const originalResizeObserver = globalThis.ResizeObserver;

  const makeItems = (count: number): TestItem[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `item-${i}`,
      key: `key-${i}`,
      label: `Item ${i}`,
      parts: [],
    }));

  const renderedIds = (): string[] =>
    fixture.debugElement
      .queryAll(By.css('.item'))
      .map((el) => (el.nativeElement as HTMLElement).getAttribute('data-id') ?? '');

  /** The viewport's strategy, which the directive keeps in sync with its items */
  const strategy = () =>
    fixture.debugElement.query(By.directive(VirtualViewportComponent)).componentInstance
      .strategy as VirtualViewportComponent['strategy'];

  const startDragOf = (id: string): void => {
    dragState.startDrag({
      draggableId: id,
      droppableId: 'list',
      element: document.createElement('div'),
      height: 50,
      width: 100,
    });
    fixture.detectChanges();
  };

  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    // jsdom has no layout: give the viewport its 200px height (4 rows of 50px)
    jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
    TestBed.configureTestingModule({ imports: [TrackCountingHostComponent] });
    fixture = TestBed.createComponent(TrackCountingHostComponent);
    host = fixture.componentInstance;
    dragState = TestBed.inject(DragStateService);
    host.items.set(makeItems(1000));
    fixture.detectChanges();
  });

  afterEach(() => {
    dragState.endDrag();
    fixture.destroy();
    jest.restoreAllMocks();
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('computes only the track keys of the rendered rows when fixed-height items change', () => {
    host.trackCalls = 0;

    const [first, ...rest] = host.items();
    host.items.set([...rest, first]);
    fixture.detectChanges();

    expect(renderedIds()).toEqual(Array.from({ length: 8 }, (_, i) => `item-${i + 1}`));
    // Not one per item: a fixed-height strategy needs only the count
    expect(host.trackCalls).toBeLessThan(100);
    expect(strategy()?.getItemCount()).toBe(1000);
  });

  it('finds the dragged item without computing the track keys again (dynamic heights)', () => {
    host.dynamic.set(true);
    fixture.detectChanges();
    host.trackCalls = 0;

    startDragOf('item-5');

    // The keys computed for the height cache serve the drag's lookup too
    expect(host.trackCalls).toBeLessThan(100);
    expect(strategy()?.getOffsetForIndex(6)).toBe(250);
  });

  it.each([
    ['fixed', false],
    ['dynamic', true],
  ])('collapses the slot of the item dragged in the list (%s heights)', (_heights, dynamic) => {
    host.dynamic.set(dynamic);
    fixture.detectChanges();

    startDragOf('item-5');

    expect(strategy()?.getOffsetForIndex(5)).toBe(250);
    expect(strategy()?.getOffsetForIndex(6)).toBe(250);
    expect(strategy()?.getItemCount()).toBe(1000);
  });

  it('finds the dragged item at the source index of the drag without computing every key', () => {
    host.trackCalls = 0;

    dragState.startDrag(
      {
        draggableId: 'item-5',
        droppableId: 'list',
        element: document.createElement('div'),
        height: 50,
        width: 100,
      },
      undefined,
      undefined,
      null,
      'list',
      null,
      null,
      5,
    );
    fixture.detectChanges();

    expect(host.trackCalls).toBeLessThan(100);
    expect(strategy()?.getOffsetForIndex(6)).toBe(250);
  });

  it('does not look for the item of a drag from another list', () => {
    host.trackCalls = 0;

    dragState.startDrag({
      draggableId: 'elsewhere-5',
      droppableId: 'other-list',
      element: document.createElement('div'),
      height: 50,
      width: 100,
    });
    fixture.detectChanges();

    // A fixed-height list computes no track key for it
    expect(host.trackCalls).toBeLessThan(100);
    expect(strategy()?.getOffsetForIndex(6)).toBe(300);
  });

  it('finds the dragged item by its data when its ID is not a track key', () => {
    const items = makeItems(20);
    host.items.set(items);
    fixture.detectChanges();

    dragState.startDrag({
      draggableId: 'not-a-track-key',
      droppableId: 'list',
      element: document.createElement('div'),
      height: 50,
      width: 100,
      data: items[5],
    });
    fixture.detectChanges();

    expect(strategy()?.getOffsetForIndex(6)).toBe(250);
  });
});

describe('VirtualForDirective (strategy of a custom viewport)', () => {
  let fixture: ComponentFixture<CustomViewportHostComponent>;
  let host: CustomViewportHostComponent;
  let dragState: DragStateService;
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    TestBed.configureTestingModule({ imports: [CustomViewportHostComponent] });
    fixture = TestBed.createComponent(CustomViewportHostComponent);
    host = fixture.componentInstance;
    dragState = TestBed.inject(DragStateService);
  });

  afterEach(() => {
    dragState.endDrag();
    fixture.destroy();
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('gives the keys to a FixedHeightStrategy subclass that overrides setItemKeys', () => {
    const strategy = new KeyRecordingFixedStrategy(50);
    host.strategy = strategy;

    fixture.detectChanges();

    expect(strategy.keys).toEqual(host.items.map((item) => item.id));
    expect(strategy.getItemCount()).toBe(20);
  });

  it('keeps finding the dragged item when the strategy reorders the keys it is given', () => {
    const strategy = new ReorderingStrategy();
    host.strategy = strategy;
    fixture.detectChanges();

    dragState.startDrag({
      draggableId: 'item-5',
      droppableId: 'list',
      element: document.createElement('div'),
      height: 50,
      width: 100,
    });
    fixture.detectChanges();

    expect(strategy.excludedIndex).toBe(5);
  });
});

describe('VirtualForDirective (dynamic height)', () => {
  let fixture: ComponentFixture<DynamicHeightTestHostComponent>;
  let component: DynamicHeightTestHostComponent;
  let originalResizeObserver: typeof ResizeObserver;

  beforeAll(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DynamicHeightTestHostComponent],
    });

    fixture = TestBed.createComponent(DynamicHeightTestHostComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should render items in dynamic height mode', () => {
    component.items.set([
      { id: 'item-1', key: 'a', label: 'Short', height: 30 },
      { id: 'item-2', key: 'b', label: 'Tall', height: 100 },
      { id: 'item-3', key: 'c', label: 'Medium', height: 60 },
    ]);
    fixture.detectChanges();

    const rendered = fixture.debugElement.queryAll(By.css('.item'));
    expect(rendered.map((el) => (el.nativeElement as HTMLElement).getAttribute('data-id'))).toEqual(
      ['item-1', 'item-2', 'item-3'],
    );
  });

  it('should handle list replacement in dynamic height mode', () => {
    component.items.set([
      { id: 'item-1', key: 'a', label: 'A', height: 40 },
      { id: 'item-2', key: 'b', label: 'B', height: 80 },
    ]);
    fixture.detectChanges();

    component.items.set([
      { id: 'item-3', key: 'c', label: 'C', height: 60 },
      { id: 'item-4', key: 'd', label: 'D', height: 100 },
      { id: 'item-5', key: 'e', label: 'E', height: 30 },
    ]);

    fixture.detectChanges();
    const rendered = fixture.debugElement.queryAll(By.css('.item'));
    expect(rendered.map((el) => (el.nativeElement as HTMLElement).getAttribute('data-id'))).toEqual(
      ['item-3', 'item-4', 'item-5'],
    );
  });
});

/** ResizeObserver stand-in that records what each instance observes and can report sizes. */
class RecordingResizeObserver {
  static instances: RecordingResizeObserver[] = [];
  readonly observed = new Set<Element>();
  disconnected = false;

  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
    RecordingResizeObserver.instances.push(this);
  }

  /** Live observers watching list rows (the viewport observes its own size too). */
  static measuringRows(): RecordingResizeObserver[] {
    return RecordingResizeObserver.instances.filter(
      (observer) =>
        !observer.disconnected &&
        [...observer.observed].some((element) => element.hasAttribute('data-id')),
    );
  }

  observe(element: Element): void {
    this.observed.add(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
  }

  disconnect(): void {
    this.observed.clear();
    this.disconnected = true;
  }

  /** Report `element` at `height` px, as the browser does after a layout change. */
  report(element: Element, height: number): void {
    const entry = { target: element, borderBoxSize: [{ blockSize: height, inlineSize: 100 }] };
    this.#callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

@Component({
  template: `
    <vdnd-virtual-viewport [itemHeight]="50" [dynamicItemHeight]="dynamic()" style="height: 200px;">
      <ng-container *vdndVirtualFor="let item of items; trackBy: trackByFn">
        <div class="item" [attr.data-id]="item.key">{{ item.key }}</div>
      </ng-container>
    </vdnd-virtual-viewport>
  `,
  imports: [VirtualViewportComponent, VirtualForDirective],
})
class ToggleDynamicHeightHostComponent {
  readonly dynamic = signal(false);
  readonly items = Array.from({ length: 3 }, (_, i) => ({ key: `key-${i}` }));
  readonly trackByFn = (_index: number, item: { key: string }): string => item.key;
}

@Component({
  template: `
    <vdnd-virtual-viewport
      [itemHeight]="itemHeight()"
      [dynamicItemHeight]="true"
      style="height: 200px;"
    >
      <ng-container
        *vdndVirtualFor="let item of items; trackBy: trackByFn; dynamicItemHeight: true"
      >
        <div class="item" [attr.data-id]="item.key">{{ item.key }}</div>
      </ng-container>
    </vdnd-virtual-viewport>
  `,
  imports: [VirtualViewportComponent, VirtualForDirective],
})
class ChangingEstimateHostComponent {
  readonly itemHeight = signal(50);
  readonly items = Array.from({ length: 3 }, (_, i) => ({ key: `key-${i}` }));
  readonly trackByFn = (_index: number, item: { key: string }): string => item.key;
}

describe('VirtualForDirective (dynamicItemHeight toggled at runtime)', () => {
  let fixture: ComponentFixture<ToggleDynamicHeightHostComponent>;
  let originalResizeObserver: typeof ResizeObserver;

  const renderedItems = (): HTMLElement[] =>
    fixture.debugElement.queryAll(By.css('.item')).map((el) => el.nativeElement as HTMLElement);

  const setDynamic = (dynamic: boolean): void => {
    fixture.componentInstance.dynamic.set(dynamic);
    fixture.detectChanges();
  };

  beforeAll(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = RecordingResizeObserver as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  beforeEach(() => {
    RecordingResizeObserver.instances = [];
    TestBed.configureTestingModule({ imports: [ToggleDynamicHeightHostComponent] });
    fixture = TestBed.createComponent(ToggleDynamicHeightHostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should not measure items while heights are fixed', () => {
    expect(renderedItems().length).toBe(3);
    expect(RecordingResizeObserver.measuringRows()).toEqual([]);
  });

  it('should start measuring the rendered items when dynamic heights are turned on', () => {
    setDynamic(true);

    const [observer] = RecordingResizeObserver.measuringRows();
    expect(RecordingResizeObserver.measuringRows().length).toBe(1);
    expect([...observer.observed]).toEqual(renderedItems());

    // Measurements reach the new dynamic strategy
    observer.report(renderedItems()[1], 120);
    const viewport = fixture.debugElement.query(By.directive(VirtualViewportComponent))
      .componentInstance as VirtualViewportComponent;
    expect(viewport.strategy.getItemHeight(1)).toBe(120);
  });

  it('should stop measuring when dynamic heights are turned off', () => {
    setDynamic(true);
    const [observer] = RecordingResizeObserver.measuringRows();

    setDynamic(false);

    expect(observer.disconnected).toBe(true);
    expect(RecordingResizeObserver.measuringRows()).toEqual([]);
  });

  it('should measure every rendered item again when dynamic heights are turned back on', () => {
    setDynamic(true);
    setDynamic(false);

    setDynamic(true);

    const active = RecordingResizeObserver.measuringRows();
    expect(active.length).toBe(1);
    expect([...active[0].observed]).toEqual(renderedItems());
  });

  it('should measure every rendered item into the new strategy when itemHeight changes', () => {
    // The directive's own dynamicItemHeight input is on, as well as the viewport's
    const estimateFixture = TestBed.createComponent(ChangingEstimateHostComponent);
    estimateFixture.detectChanges();
    const [first] = RecordingResizeObserver.measuringRows();

    estimateFixture.componentInstance.itemHeight.set(80);
    estimateFixture.detectChanges();

    const rows = estimateFixture.debugElement
      .queryAll(By.css('[data-id]'))
      .map((el) => el.nativeElement as HTMLElement);
    const active = RecordingResizeObserver.measuringRows();
    expect(first.disconnected).toBe(true);
    expect(active.length).toBe(1);
    expect([...active[0].observed]).toEqual(rows);

    active[0].report(rows[0], 120);
    const viewport = estimateFixture.debugElement.query(By.directive(VirtualViewportComponent))
      .componentInstance as VirtualViewportComponent;
    expect(viewport.strategy.getItemHeight(0)).toBe(120);
    estimateFixture.destroy();
  });

  it('should not measure during server rendering', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ToggleDynamicHeightHostComponent],
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    });
    RecordingResizeObserver.instances = [];
    const serverFixture = TestBed.createComponent(ToggleDynamicHeightHostComponent);
    serverFixture.componentInstance.dynamic.set(true);
    serverFixture.detectChanges();

    expect(RecordingResizeObserver.measuringRows()).toEqual([]);
    serverFixture.destroy();
  });

  it('should disconnect the observer when destroyed', () => {
    setDynamic(true);
    const [observer] = RecordingResizeObserver.measuringRows();

    fixture.destroy();

    expect(observer.disconnected).toBe(true);
  });
});

@Component({
  template: `
    <vdnd-virtual-viewport [itemHeight]="50" style="height: 200px;">
      <ng-container *vdndVirtualFor="let item of items(); trackBy: trackByFn; droppableId: 'list'">
        <div class="item" [attr.data-id]="item.key">{{ item.key }}</div>
      </ng-container>
    </vdnd-virtual-viewport>
  `,
  imports: [VirtualViewportComponent, VirtualForDirective],
  providers: [{ provide: VDND_ANIMATION_CONFIG, useValue: { shiftDuration: 200 } }],
})
class AnimatedTestHostComponent {
  readonly items = signal<{ key: string }[]>([]);
  readonly trackByFn = (_index: number, item: { key: string }): string => item.key;
}

describe('VirtualForDirective (shift animation)', () => {
  let fixture: ComponentFixture<AnimatedTestHostComponent>;
  let component: AnimatedTestHostComponent;
  let dragState: DragStateService;
  let appRef: ApplicationRef;
  let animationsByKey: Map<string, { cancel: jest.Mock }[]>;
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalAnimate = Element.prototype.animate;
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  const render = (): void => {
    fixture.detectChanges();
    appRef.tick();
  };

  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    animationsByKey = new Map();
    // jsdom has no layout: place each element by its position among its siblings
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const index = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0;
      return { top: index * 50, left: 0, width: 100, height: 50 } as DOMRect;
    };
    Element.prototype.animate = function (this: Element) {
      const animation = {
        cancel: jest.fn(),
        effect: { getComputedTiming: () => ({ progress: 0 }) },
        onfinish: null,
      };
      const key = this.getAttribute('data-id') ?? 'placeholder';
      animationsByKey.set(key, [...(animationsByKey.get(key) ?? []), animation]);
      return animation as unknown as Animation;
    } as typeof Element.prototype.animate;

    TestBed.configureTestingModule({ imports: [AnimatedTestHostComponent] });
    fixture = TestBed.createComponent(AnimatedTestHostComponent);
    component = fixture.componentInstance;
    dragState = TestBed.inject(DragStateService);
    appRef = TestBed.inject(ApplicationRef);

    component.items.set(Array.from({ length: 6 }, (_, i) => ({ key: `k${i}` })));
    render();
    // Drag k0 within 'list'; the placeholder starts in its own slot
    dragState.startDrag(
      {
        draggableId: 'k0',
        droppableId: 'list',
        element: document.createElement('div'),
        height: 50,
        width: 100,
      },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      null,
      'list',
      END_OF_LIST,
      1,
      0,
    );
    render();
  });

  afterEach(() => {
    dragState.endDrag();
    fixture.destroy();
    globalThis.ResizeObserver = originalResizeObserver;
    Element.prototype.animate = originalAnimate;
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  const movePlaceholder = (placeholderIndex: number): void => {
    dragState.updateDragPosition({
      cursorPosition: { x: 0, y: 0 },
      activeDroppableId: 'list',
      placeholderId: END_OF_LIST,
      placeholderIndex,
    });
    render();
  };

  it('does not animate the drag start render', () => {
    expect(animationsByKey.size).toBe(0);
  });

  it('animates only the items displaced by a placeholder move', () => {
    // Placeholder moves from before k1 to before k3: k1 and k2 move up past it
    movePlaceholder(3);

    expect([...animationsByKey.keys()].sort()).toEqual(['k1', 'k2', 'placeholder']);
  });

  it('cancels the animation of a view recycled for another item', () => {
    movePlaceholder(3);
    const k1Animation = animationsByKey.get('k1')![0];
    expect(k1Animation.cancel).not.toHaveBeenCalled();

    // k1 leaves the list: its view is pooled and may be reused for another item
    component.items.set(component.items().filter((item) => item.key !== 'k1'));
    render();

    expect(k1Animation.cancel).toHaveBeenCalled();
  });

  it('shows again a row the drop animation hides when its view is pooled', () => {
    const row = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-id="k1"]',
    )!;
    new DropAnimator({ dropDuration: 200 }).play(
      document.createElement('div'),
      { element: row, rect: row.getBoundingClientRect() },
      () => undefined,
    );
    const hide = animationsByKey.get('k1')!.at(-1)!;
    expect(hide.cancel).not.toHaveBeenCalled();

    // k1 leaves the list: its view is pooled, to render another item that must not stay hidden
    component.items.set(component.items().filter((item) => item.key !== 'k1'));
    render();

    expect(hide.cancel).toHaveBeenCalled();
  });

  it('animates the drag end render instead of snapping rows into place', () => {
    movePlaceholder(3);
    const displaced = ['k1', 'k2'].map((key) => animationsByKey.get(key)![0]);
    expect(animationsByKey.has('k3')).toBe(false);

    // The placeholder (before k3) leaves: k3 moves up into its slot, k1/k2 stay put
    dragState.cancelDrag();
    render();

    expect(animationsByKey.get('k3')?.length).toBe(1);
    // In-flight slides whose target did not change keep running
    expect(displaced.every((animation) => animation.cancel.mock.calls.length === 0)).toBe(true);
  });
});

describe('VirtualForDirective (content offset)', () => {
  let originalResizeObserver: typeof ResizeObserver;

  const renderedIds = (fixture: ComponentFixture<unknown>): string[] =>
    fixture.debugElement
      .queryAll(By.css('.item'))
      .map((el) => (el.nativeElement as HTMLElement).getAttribute('data-id') ?? '');

  /** item IDs from..to inclusive */
  const itemIds = (from: number, to: number): string[] =>
    Array.from({ length: to - from + 1 }, (_, i) => `item-${from + i}`);

  beforeAll(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  beforeEach(() => {
    // jsdom has no layout: give the viewport its 300px height (6 rows of 50px)
    jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('in vdnd-virtual-viewport', () => {
    let fixture: ComponentFixture<ContentOffsetViewportHostComponent>;
    let viewportEl: HTMLElement;

    /** Scroll the viewport and let the RAF-throttled scroll binding commit. */
    const scrollViewportTo = async (scrollTop: number): Promise<void> => {
      viewportEl.scrollTop = scrollTop;
      viewportEl.dispatchEvent(new Event('scroll'));
      await nextAnimationFrame();
      fixture.detectChanges();
      fixture.detectChanges();
    };

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [ContentOffsetViewportHostComponent],
      });

      fixture = TestBed.createComponent(ContentOffsetViewportHostComponent);
      fixture.detectChanges();
      viewportEl = fixture.debugElement.query(By.directive(VirtualViewportComponent))
        .nativeElement as HTMLElement;
    });

    afterEach(() => {
      fixture.destroy();
    });

    it('should render the rows in view once scrolled past the offset', async () => {
      // 600 - 400 = 200px into the rows: rows 4-9 are in view, plus 3 overscan on each side
      await scrollViewportTo(600);

      expect(renderedIds(fixture)).toEqual(itemIds(1, 13));
    });

    it('should render from the first row while the offset is still in view', async () => {
      // The rows start 100px below the viewport's top edge: rows 0-3 are in view
      await scrollViewportTo(300);

      expect(renderedIds(fixture)).toEqual(itemIds(0, 9));
    });
  });

  describe('in vdnd-virtual-content', () => {
    it('should subtract the offset once (its scrollTop is already relative to the rows)', () => {
      TestBed.configureTestingModule({
        imports: [ContentOffsetPageHostComponent],
      });
      const fixture = TestBed.createComponent(ContentOffsetPageHostComponent);
      fixture.componentInstance.scrollTop.set(600);
      fixture.detectChanges();
      fixture.detectChanges();

      expect(renderedIds(fixture)).toEqual(itemIds(1, 13));
      fixture.destroy();
    });
  });
});

@Component({
  template: `
    <div class="host-render" [attr.data-count]="countHostRender()"></div>
    <div class="scroller">
      <ng-container
        *vdndVirtualFor="
          let item of items;
          let i = index;
          itemHeight: 50;
          trackBy: trackByFn;
          droppableId: 'list'
        "
      >
        <div
          class="item"
          [attr.data-id]="item.key"
          [attr.data-index]="i"
          [attr.data-selected]="selected() === item.key"
        >
          {{ countRowRender(item.key) }}
        </div>
      </ng-container>
    </div>
  `,
  imports: [VirtualForDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: VDND_SCROLL_CONTAINER, useExisting: RenderCountingHostComponent }],
})
class RenderCountingHostComponent implements VdndScrollContainer {
  readonly items = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}` }));
  readonly trackByFn = (_index: number, item: { key: string }): string => item.key;

  readonly selected = signal<string | null>(null);

  hostRenders = 0;
  readonly rowRenders: string[] = [];

  // 200px of 50px rows: 4 in view, plus 3 overscan on each side
  scrollTop = signal(0);
  containerHeight = signal(200);
  nativeElement = document.createElement('div');
  scrollTo = jest.fn();

  countHostRender(): number {
    return ++this.hostRenders;
  }

  countRowRender(key: string): string {
    this.rowRenders.push(key);
    return key;
  }
}

describe('VirtualForDirective (change detection scope)', () => {
  let fixture: ComponentFixture<RenderCountingHostComponent>;
  let host: RenderCountingHostComponent;
  let dragState: DragStateService;
  let appRef: ApplicationRef;
  const originalResizeObserver = globalThis.ResizeObserver;

  const renderedIds = (): string[] =>
    fixture.debugElement
      .queryAll(By.css('.item'))
      .map((el) => (el.nativeElement as HTMLElement).getAttribute('data-id') ?? '');

  const resetCounts = (): void => {
    host.hostRenders = 0;
    host.rowRenders.length = 0;
  };

  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    TestBed.configureTestingModule({ imports: [RenderCountingHostComponent] });
    fixture = TestBed.createComponent(RenderCountingHostComponent);
    host = fixture.componentInstance;
    dragState = TestBed.inject(DragStateService);
    appRef = TestBed.inject(ApplicationRef);
    fixture.detectChanges();
    appRef.tick();
    resetCounts();
  });

  afterEach(() => {
    dragState.endDrag();
    fixture.destroy();
    globalThis.ResizeObserver = originalResizeObserver;
  });

  const movePlaceholder = (placeholderIndex: number): void => {
    dragState.updateDragPosition({
      cursorPosition: { x: 0, y: 0 },
      activeDroppableId: 'list',
      placeholderId: END_OF_LIST,
      placeholderIndex,
    });
    appRef.tick();
  };

  it('renders the rows in range', () => {
    expect(renderedIds()).toEqual(Array.from({ length: 8 }, (_, i) => `k${i}`));
  });

  it('re-renders neither the host nor any row when only the placeholder moves', () => {
    dragState.startDrag(
      {
        draggableId: 'k0',
        droppableId: 'list',
        element: document.createElement('div'),
        height: 50,
        width: 100,
      },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      null,
      'list',
      END_OF_LIST,
      1,
      0,
    );
    appRef.tick();
    resetCounts();

    movePlaceholder(3);
    movePlaceholder(5);

    expect(fixture.nativeElement.querySelector('.vdnd-drag-placeholder')).not.toBeNull();
    expect(host.hostRenders).toBe(0);
    expect(host.rowRenders).toEqual([]);
  });

  it('re-renders only the rows whose context changed when scrolling', () => {
    // First row in view goes from 0 to 4: the range goes from 0-7 to 1-11
    host.scrollTop.set(200);
    appRef.tick();

    expect(renderedIds()).toEqual(Array.from({ length: 11 }, (_, i) => `k${i + 1}`));
    expect(host.hostRenders).toBe(0);
    // k1 becomes the first row and k7 stops being the last; k8-k11 are new or recycled
    expect([...new Set(host.rowRenders)].sort()).toEqual(
      ['k1', 'k7', 'k8', 'k9', 'k10', 'k11'].sort(),
    );
  });

  it('shows the new item and index in a recycled row', () => {
    host.scrollTop.set(200);
    appRef.tick();

    const rows = fixture.debugElement
      .queryAll(By.css('.item'))
      .map((el) => el.nativeElement as HTMLElement);
    expect(rows.map((row) => row.getAttribute('data-index'))).toEqual(
      Array.from({ length: 11 }, (_, i) => `${i + 1}`),
    );
    expect(rows.map((row) => row.textContent?.trim())).toEqual(renderedIds());
  });

  it('does not recycle the row that holds the dragged element', () => {
    const rows = (): HTMLElement[] =>
      fixture.debugElement.queryAll(By.css('.item')).map((el) => el.nativeElement as HTMLElement);
    const dragged = rows()[0];
    // The drag's ID is not the row's track key, so the list does not keep the row rendered
    dragState.startDrag(
      {
        draggableId: 'row-of-k0',
        droppableId: 'list',
        element: dragged,
        height: 50,
        width: 100,
      },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      null,
      'list',
      END_OF_LIST,
      1,
      0,
    );
    appRef.tick();

    // First row in view 25: rows 22-29. k0 leaves the range
    host.scrollTop.set(1250);
    appRef.tick();

    expect(renderedIds()).toContain('k22');
    expect(rows()).not.toContain(dragged);
  });

  it('renders a pooled row again when it comes back for the same item', () => {
    const selectedAttr = (key: string): string | null | undefined =>
      (fixture.nativeElement as HTMLElement)
        .querySelector(`[data-id="${key}"]`)
        ?.getAttribute('data-selected');

    // First row in view 25: rows 22-29. Then 26: k22 leaves the range and its view is pooled
    host.scrollTop.set(1250);
    appRef.tick();
    // A host re-render renders the rows too (their signal reads now count as the host's)
    host.selected.set('k29');
    appRef.tick();
    host.scrollTop.set(1300);
    appRef.tick();
    expect(selectedAttr('k22')).toBeUndefined();

    // State the row shows changes while its view is detached in the pool
    host.selected.set('k22');
    appRef.tick();

    // Back to 25: the pool hands the same view to k22, with the same context as before
    host.scrollTop.set(1250);
    appRef.tick();

    expect(selectedAttr('k22')).toBe('true');
  });
});

/** `*vdndVirtualFor` directly in a `vdndScrollable` element, with no viewport component */
@Component({
  template: `
    <div class="scroller" vdndScrollable [style.position]="scrollerPosition()">
      <ng-container
        *vdndVirtualFor="
          let item of items();
          itemHeight: 50;
          trackBy: trackByFn;
          droppableId: 'list';
          overscan: overscan()
        "
      >
        <div class="item" [attr.data-id]="item.key">{{ item.key }}</div>
      </ng-container>
    </div>
  `,
  imports: [ScrollableDirective, VirtualForDirective],
})
class StandaloneScrollableHostComponent {
  readonly items = signal(Array.from({ length: 30 }, (_, i) => ({ key: `k${i}` })));
  readonly trackByFn = (_index: number, item: { key: string }): string => item.key;
  readonly scrollerPosition = signal<string | null>(null);
  readonly overscan = signal(3);
}

describe('VirtualForDirective (standalone in vdndScrollable)', () => {
  let fixture: ComponentFixture<StandaloneScrollableHostComponent>;
  let host: StandaloneScrollableHostComponent;
  let dragState: DragStateService;
  let appRef: ApplicationRef;
  const originalResizeObserver = globalThis.ResizeObserver;

  const render = (): void => {
    fixture.detectChanges();
    appRef.tick();
  };

  const scroller = (): HTMLElement => fixture.nativeElement.querySelector('.scroller');
  const placeholder = (): HTMLElement | null =>
    fixture.nativeElement.querySelector('.vdnd-drag-placeholder');
  const spacer = (): HTMLElement => fixture.nativeElement.querySelector('.vdnd-virtual-for-spacer');
  const rowTop = (key: string): string =>
    (fixture.nativeElement.querySelector(`[data-id="${key}"]`) as HTMLElement).style.top;

  const startDrag = (sourceDroppableId: string, placeholderIndex: number, height = 50): void => {
    dragState.startDrag(
      {
        draggableId: sourceDroppableId === 'list' ? 'k0' : 'other-item',
        droppableId: sourceDroppableId,
        element: document.createElement('div'),
        height,
        width: 100,
      },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      null,
      'list',
      END_OF_LIST,
      placeholderIndex,
      sourceDroppableId === 'list' ? 0 : null,
    );
    render();
  };

  const movePlaceholder = (placeholderIndex: number): void => {
    dragState.updateDragPosition({
      cursorPosition: { x: 0, y: 0 },
      activeDroppableId: 'list',
      placeholderId: END_OF_LIST,
      placeholderIndex,
    });
    render();
  };

  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    // jsdom has no layout: give the scroller its 200px height (4 rows of 50px)
    jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
    TestBed.configureTestingModule({ imports: [StandaloneScrollableHostComponent] });
    dragState = TestBed.inject(DragStateService);
    appRef = TestBed.inject(ApplicationRef);
    fixture = TestBed.createComponent(StandaloneScrollableHostComponent);
    host = fixture.componentInstance;
  });

  afterEach(() => {
    dragState.endDrag();
    fixture.destroy();
    jest.restoreAllMocks();
    globalThis.ResizeObserver = originalResizeObserver;
  });

  describe('placeholder', () => {
    beforeEach(() => render());

    it('opens a gap at the placeholder index during a same-list drag', () => {
      // k0 is dragged (hidden, its slot closed up); the placeholder goes before k3
      startDrag('list', 3);

      const el = placeholder();
      expect(el).not.toBeNull();
      expect(el!.style.position).toBe('absolute');
      expect(el!.style.top).toBe('100px');
      expect(el!.style.height).toBe('50px');
      expect(['k1', 'k2', 'k3', 'k4'].map(rowTop)).toEqual(['0px', '50px', '150px', '200px']);
      // The gap fills the dragged item's closed-up slot: the scroll height stays the same
      expect(spacer().style.height).toBe('1500px');
    });

    it('moves the gap with the placeholder', () => {
      startDrag('list', 3);
      movePlaceholder(2);

      expect(placeholder()!.style.top).toBe('50px');
      expect(['k1', 'k2', 'k3'].map(rowTop)).toEqual(['0px', '100px', '150px']);
    });

    it('opens a gap and grows the scroll height for an item dragged in from another list', () => {
      startDrag('other', 2);

      expect(placeholder()!.style.top).toBe('100px');
      expect(['k0', 'k1', 'k2', 'k3'].map(rowTop)).toEqual(['0px', '50px', '150px', '200px']);
      expect(spacer().style.height).toBe('1550px');
    });

    it('closes the gap when the drag ends', () => {
      startDrag('other', 2);
      dragState.endDrag();
      render();

      expect(placeholder()).toBeNull();
      expect(['k1', 'k2', 'k3'].map(rowTop)).toEqual(['50px', '100px', '150px']);
      expect(spacer().style.height).toBe('1500px');
    });
  });

  describe('rendered range', () => {
    const renderedKeys = (): string[] =>
      Array.from(fixture.nativeElement.querySelectorAll('.item') as NodeListOf<HTMLElement>).map(
        (el) => el.getAttribute('data-id') ?? '',
      );

    /** Scrolled 500px down: jsdom has no layout, so the scroller reports that scroll position */
    const renderScrolledTo500 = (): void => {
      jest.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockReturnValue(500);
      render();
    };

    it('renders the row the gap of an incoming placeholder above pushes into view', () => {
      host.overscan.set(0);
      renderScrolledTo500();

      // A 50px gap at index 0 puts k9 at 500-550px, at the top edge
      startDrag('other', 0);

      expect(renderedKeys()).toEqual(['k9', 'k10', 'k11', 'k12', 'k13']);
      expect(rowTop('k9')).toBe('500px');
    });

    it('renders the rows a gap taller than the overscan pushes into view', () => {
      renderScrolledTo500();

      // A 250px gap at index 0 puts k5 at 500-550px and k6 below it
      startDrag('other', 0, 250);

      expect(renderedKeys()).toEqual(expect.arrayContaining(['k5', 'k6', 'k7', 'k8']));
      expect(rowTop('k5')).toBe('500px');
    });

    /** Drag a row of this list while the pointer is over another list: no placeholder here */
    const startDragToOtherList = (index: number): void => {
      dragState.startDrag(
        {
          draggableId: `k${index}`,
          droppableId: 'list',
          element: document.createElement('div'),
          height: 50,
          width: 100,
        },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        null,
        'other',
        END_OF_LIST,
        0,
        index,
      );
      render();
    };

    const renderedExcept = (dragged: string): string[] =>
      renderedKeys().filter((key) => key !== dragged);

    it('renders the rows in view when scrolled past the dragged item and its placeholder', () => {
      host.overscan.set(0);
      jest.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockReturnValue(525);
      render();

      // k0 is dragged, its placeholder fills its slot: k10 to k14 cover 500-750px
      startDrag('list', 1);

      expect(renderedExcept('k0')).toEqual(['k10', 'k11', 'k12', 'k13', 'k14']);
      expect(rowTop('k14')).toBe('700px');
    });

    it('renders the rows in view when scrolled past a dragged item with no placeholder', () => {
      host.overscan.set(0);
      jest.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockReturnValue(525);
      render();

      // k0's slot closes up: k11 to k15 cover 500-750px
      startDragToOtherList(0);

      expect(renderedExcept('k0')).toEqual(['k11', 'k12', 'k13', 'k14', 'k15']);
      expect(rowTop('k15')).toBe('700px');
    });

    it('renders the row the slot of a dragged item in view pulls up into view', () => {
      host.overscan.set(0);
      jest.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockReturnValue(25);
      render();

      // k2's slot closes up: k0, k1, k3, k4 and k5 cover 0-250px, in view from 25 to 225px
      startDragToOtherList(2);

      expect(renderedExcept('k2')).toEqual(['k0', 'k1', 'k3', 'k4', 'k5']);
      expect(rowTop('k5')).toBe('200px');
    });

    it('renders the rows a tall gap in view pushes out of view, as before it opened', () => {
      host.overscan.set(0);
      render();
      const before = renderedKeys();

      // A 250px gap at index 2 spans 100-350px: k2 and k3 move out of view, and stay rendered
      // so that a placeholder move within view leaves every row as it is
      startDrag('other', 2, 250);

      expect(before).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
      expect(renderedKeys()).toEqual(before);
    });

    it('renders from the gap when the scroll position is inside it', () => {
      host.overscan.set(0);
      renderScrolledTo500();

      // A 250px gap at index 8 spans 400-650px: k8 comes next, at 650px
      startDrag('other', 8, 250);

      expect(renderedKeys()).toEqual(['k8', 'k9', 'k10', 'k11', 'k12']);
      expect(rowTop('k8')).toBe('650px');
    });
  });

  describe('scroll container position', () => {
    it('positions a static scroll container so the rows scroll with it', () => {
      render();

      expect(scroller().style.position).toBe('relative');
    });

    it('leaves a positioned scroll container as it is', () => {
      host.scrollerPosition.set('absolute');
      render();

      expect(scroller().style.position).toBe('absolute');
    });

    it('restores the scroll container position when destroyed', () => {
      render();
      const el = scroller();
      fixture.destroy();

      expect(el.style.position).toBe('');
    });

    it('positions a scroll container that joins the page after the first render', () => {
      const root = fixture.nativeElement as HTMLElement;
      const parent = root.parentNode!;
      root.remove();
      render();
      expect(scroller().style.position).toBe('');

      // The next render after it is in the page (here, for an items change) positions it
      parent.appendChild(root);
      host.items.update((items) => [...items]);
      render();

      expect(scroller().style.position).toBe('relative');
    });
  });
});

/** Two `*vdndVirtualFor` lists sharing one `vdndScrollable`, each one removable */
@Component({
  template: `
    <div class="scroller" vdndScrollable>
      @if (showA()) {
        <ng-container
          *vdndVirtualFor="let item of items; itemHeight: 50; trackBy: trackByFn; droppableId: 'a'"
        >
          <div class="item">{{ item.key }}</div>
        </ng-container>
      }
      @if (showB()) {
        <ng-container
          *vdndVirtualFor="let item of items; itemHeight: 50; trackBy: trackByFn; droppableId: 'b'"
        >
          <div class="item">{{ item.key }}</div>
        </ng-container>
      }
    </div>
  `,
  imports: [ScrollableDirective, VirtualForDirective],
})
class SharedScrollableHostComponent {
  readonly items = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}` }));
  readonly trackByFn = (_index: number, item: { key: string }): string => item.key;
  readonly showA = signal(true);
  readonly showB = signal(true);
}

describe('VirtualForDirective (lists sharing a vdndScrollable)', () => {
  let fixture: ComponentFixture<SharedScrollableHostComponent>;
  let appRef: ApplicationRef;
  const originalResizeObserver = globalThis.ResizeObserver;

  const render = (): void => {
    fixture.detectChanges();
    appRef.tick();
  };
  const scroller = (): HTMLElement => fixture.nativeElement.querySelector('.scroller');

  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    TestBed.configureTestingModule({ imports: [SharedScrollableHostComponent] });
    appRef = TestBed.inject(ApplicationRef);
    fixture = TestBed.createComponent(SharedScrollableHostComponent);
    render();
  });

  afterEach(() => {
    fixture.destroy();
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('keeps the scroll container positioned until the last list is destroyed', () => {
    expect(scroller().style.position).toBe('relative');

    fixture.componentInstance.showA.set(false);
    render();
    expect(scroller().style.position).toBe('relative');

    fixture.componentInstance.showB.set(false);
    render();
    expect(scroller().style.position).toBe('');
  });

  it('keeps the scroll container positioned for a list added while another one uses it', () => {
    fixture.componentInstance.showB.set(false);
    render();
    fixture.componentInstance.showB.set(true);
    render();
    fixture.componentInstance.showA.set(false);
    render();

    expect(scroller().style.position).toBe('relative');
  });
});
