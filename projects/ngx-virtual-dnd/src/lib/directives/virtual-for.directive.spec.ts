import { ApplicationRef, Component, PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { VirtualForDirective } from './virtual-for.directive';
import { VirtualViewportComponent } from '../components/virtual-viewport.component';
import { VirtualContentComponent } from '../components/virtual-content.component';
import { DragStateService } from '../services/drag-state.service';
import { VDND_ANIMATION_CONFIG } from '../tokens/animation-config.token';
import { VDND_SCROLL_CONTAINER, VdndScrollContainer } from '../tokens/scroll-container.token';
import { END_OF_LIST } from '../models/drag-drop.models';

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
