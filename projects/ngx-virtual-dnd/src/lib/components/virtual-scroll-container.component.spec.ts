import {
  ApplicationRef,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Directive,
  inject,
  OnDestroy,
  PLATFORM_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  VirtualScrollContainerComponent,
  VirtualScrollItemContext,
} from './virtual-scroll-container.component';
import { DragStateService } from '../services/drag-state.service';
import { AutoScrollConfig, AutoScrollService } from '../services/auto-scroll.service';
import { PositionCalculatorService } from '../services/position-calculator.service';
import { KeyboardDragService } from '../services/keyboard-drag.service';
import { DraggedItem, END_OF_LIST } from '../models/drag-drop.models';
import { VDND_ANIMATION_CONFIG } from '../tokens/animation-config.token';
import { DragPlaceholderComponent } from './drag-placeholder.component';
import { DropAnimator } from '../utils/drop-animator';
import { DragIndexCalculatorService } from '../services/drag-index-calculator.service';

// Mock ResizeObserver for JSDOM
class MockResizeObserver {
  static instances: MockResizeObserver[] = [];

  disconnected = false;
  /** Elements observed and not unobserved since, in the order they were (last) observed */
  readonly #observed = new Set<Element>();
  observe = jest.fn((element: Element) => {
    this.#observed.delete(element);
    this.#observed.add(element);
  });
  unobserve = jest.fn((element: Element) => {
    this.#observed.delete(element);
  });
  disconnect = jest.fn(() => {
    this.disconnected = true;
    this.#observed.clear();
  });

  constructor(readonly callback: ResizeObserverCallback = () => undefined) {
    MockResizeObserver.instances.push(this);
  }

  /** Report a new border-box height for an element, as the browser would */
  resize(element: Element, blockSize: number): void {
    const entry = { target: element, borderBoxSize: [{ blockSize, inlineSize: 100 }] };
    this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }

  /** Live observers that observed list rows (the container also observes its own size). */
  static measuringRows(): MockResizeObserver[] {
    return MockResizeObserver.instances.filter(
      (observer) =>
        !observer.disconnected &&
        observer.observe.mock.calls.some(([element]) =>
          (element as Element).hasAttribute('data-draggable-id'),
        ),
    );
  }

  /** Elements observed and not unobserved since. */
  observedElements(): Element[] {
    return [...this.#observed];
  }
}

const nextAnimationFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

interface TestItem {
  id: string;
  name: string;
}

@Component({
  template: `
    <ng-template #itemTpl let-item let-index="index" let-isSticky="isSticky">
      <div
        class="item"
        [attr.data-index]="index"
        [attr.data-draggable-id]="item.id"
        [attr.data-sticky]="isSticky"
        [style.height.px]="50"
      >
        {{ item.name }}
      </div>
    </ng-template>
    <ng-template #otherItemTpl let-item let-index="index">
      <div class="item other" [attr.data-index]="index" [attr.data-draggable-id]="item.id">
        {{ item.name }}
      </div>
    </ng-template>

    <vdnd-virtual-scroll
      [items]="items()"
      [itemHeight]="itemHeight()"
      [containerHeight]="containerHeight()"
      [overscan]="overscan()"
      [stickyItemIds]="stickyItemIds()"
      [itemIdFn]="itemIdFn"
      [trackByFn]="trackByFn"
      [itemTemplate]="otherTemplate() ? otherItemTpl : itemTpl"
      [dynamicItemHeight]="dynamicItemHeight()"
      [scrollContainerId]="scrollContainerId()"
      [droppableId]="droppableId()"
      [autoScrollEnabled]="autoScrollEnabled()"
      [autoScrollConfig]="autoScrollConfig()"
      [recycleRows]="recycleRows()"
    >
    </vdnd-virtual-scroll>
  `,
  imports: [VirtualScrollContainerComponent],
})
class TestHostComponent {
  readonly itemTpl = viewChild.required<TemplateRef<VirtualScrollItemContext<TestItem>>>('itemTpl');

  items = signal<TestItem[]>([]);
  containerHeight = signal<number | undefined>(300);
  overscan = signal(3);
  stickyItemIds = signal<string[]>([]);
  scrollContainerId = signal<string | undefined>('test-scroll');
  droppableId = signal<string | undefined>(undefined);
  autoScrollEnabled = signal(true);
  autoScrollConfig = signal<Partial<AutoScrollConfig>>({});
  dynamicItemHeight = signal(false);
  itemHeight = signal(50);
  otherTemplate = signal(false);
  recycleRows = signal(false);

  readonly itemIdFn = (item: TestItem): string => item.id;
  readonly trackByFn = (_: number, item: TestItem): string => item.id;
}

/** Dynamic heights, with rows that render their item ID twice: on the row and inside it */
@Component({
  template: `
    <ng-template #itemTpl let-item>
      <div class="row" [attr.data-draggable-id]="item.id">
        <span class="badge" [attr.data-draggable-id]="item.id">{{ item.name }}</span>
      </div>
    </ng-template>

    <vdnd-virtual-scroll
      [items]="items()"
      [itemHeight]="50"
      [containerHeight]="300"
      [dynamicItemHeight]="true"
      [itemIdFn]="itemIdFn"
      [itemTemplate]="itemTpl"
    >
    </vdnd-virtual-scroll>
  `,
  imports: [VirtualScrollContainerComponent],
})
class NestedIdHostComponent {
  items = signal<TestItem[]>([]);
  readonly itemIdFn = (item: TestItem): string => item.id;
}

/** Counts the calls of its itemIdFn */
@Component({
  template: `
    <ng-template #itemTpl let-item let-index="index">
      <div class="item" [attr.data-draggable-id]="item.id" [attr.data-index]="index">
        {{ item.name }}
      </div>
    </ng-template>

    <vdnd-virtual-scroll
      [items]="items()"
      [itemHeight]="50"
      [containerHeight]="300"
      [dynamicItemHeight]="dynamicItemHeight()"
      [stickyItemIds]="stickyItemIds()"
      [droppableId]="'list'"
      [itemIdFn]="itemIdFn"
      [itemTemplate]="itemTpl"
    >
    </vdnd-virtual-scroll>
  `,
  imports: [VirtualScrollContainerComponent],
})
class IdCountingHostComponent {
  items = signal<TestItem[]>([]);
  dynamicItemHeight = signal(false);
  stickyItemIds = signal<string[]>([]);
  idCalls = 0;
  readonly itemIdFn = (item: TestItem): string => {
    this.idCalls++;
    return item.id;
  };
}

describe('VirtualScrollContainerComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let component: TestHostComponent;
  let virtualScrollComponent: VirtualScrollContainerComponent<TestItem>;
  let virtualScrollEl: HTMLElement;
  let dragStateService: DragStateService;
  let autoScrollService: AutoScrollService;
  let originalResizeObserver: typeof ResizeObserver;

  const generateItems = (count: number): TestItem[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `item-${i}`,
      name: `Item ${i}`,
    }));

  beforeAll(() => {
    // Store original and set mock
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    // Restore original
    globalThis.ResizeObserver = originalResizeObserver;
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [DragStateService, AutoScrollService, PositionCalculatorService],
    });

    fixture = TestBed.createComponent(TestHostComponent);
    component = fixture.componentInstance;
    component.items.set(generateItems(100)); // 100 items, each 50px = 5000px total
    fixture.detectChanges();
    fixture.detectChanges(); // Double detection to settle

    const virtualScrollDebug = fixture.debugElement.query(
      By.directive(VirtualScrollContainerComponent),
    );
    virtualScrollComponent = virtualScrollDebug.componentInstance;
    virtualScrollEl = virtualScrollDebug.nativeElement;
    dragStateService = TestBed.inject(DragStateService);
    autoScrollService = TestBed.inject(AutoScrollService);
  });

  afterEach(() => {
    dragStateService.endDrag();
    fixture.destroy();
  });

  const renderedIndices = (): number[] =>
    fixture.debugElement
      .queryAll(By.css('.item'))
      .map((item) => parseInt(item.nativeElement.getAttribute('data-index'), 10));

  /** indices from..to inclusive */
  const range = (from: number, to: number): number[] =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);

  /** Scroll the container and let the RAF-throttled scroll binding commit. */
  const scrollContainerTo = async (scrollTop: number): Promise<void> => {
    virtualScrollEl.scrollTop = scrollTop;
    virtualScrollEl.dispatchEvent(new Event('scroll'));
    await nextAnimationFrame();
    fixture.detectChanges();
    fixture.detectChanges();
  };

  describe('initialization', () => {
    it('should have vdnd-virtual-scroll class (provides overflow and position via CSS)', () => {
      expect(virtualScrollEl.classList.contains('vdnd-virtual-scroll')).toBe(true);
    });

    it('should set container height from input', () => {
      expect(virtualScrollEl.style.height).toBe('300px');
    });

    it('should have data-item-height attribute', () => {
      expect(virtualScrollEl.getAttribute('data-item-height')).toBe('50');
    });
  });

  describe('virtual rendering', () => {
    it('should render only visible items plus overscan', () => {
      // 300px / 50px = 6 visible, + 3 overscan below (none above at the top) → items 0-9
      expect(renderedIndices()).toEqual(range(0, 9));
    });

    it('should render the window around the scroll position', async () => {
      await scrollContainerTo(2000);

      // First visible = 40 → 37 (overscan) through 40 + 6 + 3 = 49
      expect(renderedIndices()).toEqual(range(37, 49));
    });
  });

  describe('overscan', () => {
    it('should render extra items based on overscan', () => {
      component.overscan.set(5);
      fixture.detectChanges();
      fixture.detectChanges();

      expect(renderedIndices()).toEqual(range(0, 11));
    });

    it('should respect overscan=0', () => {
      component.overscan.set(0);
      fixture.detectChanges();
      fixture.detectChanges();

      // 6 visible + 1 for the partially visible next row
      expect(renderedIndices()).toEqual(range(0, 6));
    });
  });

  describe('sticky items', () => {
    it('should keep rendering a sticky item scrolled out of the window', async () => {
      component.stickyItemIds.set(['item-0']);
      fixture.detectChanges();

      await scrollContainerTo(4000);

      // First visible = 80 → window 77-89; item 0 is appended only because it is sticky
      expect(renderedIndices()).toEqual([...range(77, 89), 0]);
    });

    it('should drop a non-sticky item once it leaves the window', async () => {
      await scrollContainerTo(4000);

      expect(renderedIndices()).not.toContain(0);
    });

    it('should mark only sticky items with isSticky context', () => {
      component.stickyItemIds.set(['item-0']);
      fixture.detectChanges();
      fixture.detectChanges();

      const stickyItem = fixture.debugElement.query(By.css('.item[data-index="0"]'));
      const regularItem = fixture.debugElement.query(By.css('.item[data-index="1"]'));
      expect(stickyItem.nativeElement.getAttribute('data-sticky')).toBe('true');
      expect(regularItem.nativeElement.getAttribute('data-sticky')).toBe('false');
    });
  });

  describe('total height calculation', () => {
    it('should size the single spacer to the total height', () => {
      const spacer = fixture.debugElement.query(By.css('.vdnd-virtual-scroll-spacer'));
      // 100 items * 50px
      expect(virtualScrollComponent.getScrollHeight()).toBe(5000);
      expect(spacer.nativeElement.style.height).toBe('5000px');
    });

    it('should keep the total height while an item is dragged (hidden item still counted)', () => {
      const item: DraggedItem = {
        draggableId: 'item-5',
        droppableId: 'list',
        element: document.createElement('div'),
        height: 50,
        width: 200,
      };

      dragStateService.startDrag(item);
      fixture.detectChanges();
      fixture.detectChanges();

      const spacer = fixture.debugElement.query(By.css('.vdnd-virtual-scroll-spacer'));
      expect(virtualScrollComponent.getScrollHeight()).toBe(5000);
      expect(spacer.nativeElement.style.height).toBe('5000px');

      dragStateService.endDrag();
      fixture.detectChanges();
      fixture.detectChanges();

      expect(virtualScrollComponent.getScrollHeight()).toBe(5000);
    });
  });

  describe('render entries', () => {
    // renderedItems is protected, so its entry type is part of what subclasses see
    it('should flag the entry of the dragged item', () => {
      dragStateService.startDrag({
        draggableId: 'item-2',
        droppableId: 'list',
        element: document.createElement('div'),
        height: 50,
        width: 200,
      });
      fixture.detectChanges();

      const draggedEntries = virtualScrollComponent['renderedItems']()
        .filter((entry) => entry.isDragging)
        .map((entry) => entry.index);
      expect(draggedEntries).toEqual([2]);
    });
  });

  describe('content transform', () => {
    it('should have transform at 0 initially', () => {
      const wrapper = fixture.debugElement.query(By.css('.vdnd-virtual-scroll-content-wrapper'));
      expect(wrapper.nativeElement.style.transform).toBe('translateY(0px)');
    });

    it('should offset the wrapper to the first rendered item when scrolled', async () => {
      await scrollContainerTo(1000);

      // First visible = 20, first rendered = 17 (overscan 3) → 17 * 50px
      const wrapper = fixture.debugElement.query(By.css('.vdnd-virtual-scroll-content-wrapper'));
      expect(wrapper.nativeElement.style.transform).toBe('translateY(850px)');
    });
  });

  describe('public methods', () => {
    describe('scrollTo', () => {
      it('should scroll to specified position', () => {
        virtualScrollComponent.scrollTo(500);
        fixture.detectChanges();
        fixture.detectChanges();

        expect(virtualScrollEl.scrollTop).toBe(500);
        expect(virtualScrollComponent.getScrollTop()).toBe(500);
      });

      it('should render the rows in view when asked to scroll past the end', () => {
        // Browsers clamp scrollTop to the scrollable range (and fire no scroll event when that
        // leaves it unchanged); jsdom stores any value, so emulate the browser.
        const maxScroll = 5000 - 300; // totalHeight - containerHeight
        let scrollTop = 0;
        Object.defineProperty(virtualScrollEl, 'scrollTop', {
          configurable: true,
          get: () => scrollTop,
          set: (value: number) => {
            scrollTop = Math.max(0, Math.min(value, maxScroll));
          },
        });

        virtualScrollComponent.scrollTo(maxScroll);
        virtualScrollComponent.scrollToIndex(99); // offset 4950, past the end
        fixture.detectChanges();

        expect(virtualScrollComponent.getScrollTop()).toBe(maxScroll);
        // Rows 94-99 fill the viewport at the bottom
        expect(renderedIndices()).toEqual(expect.arrayContaining([94, 95, 96, 97, 98, 99]));
      });
    });

    describe('scrollToIndex', () => {
      it('should scroll to specified item index', () => {
        virtualScrollComponent.scrollToIndex(10);
        fixture.detectChanges();
        fixture.detectChanges();

        expect(virtualScrollEl.scrollTop).toBe(500); // 10 * 50px
      });
    });

    describe('scrollBy', () => {
      it('should scroll by delta amount', () => {
        virtualScrollComponent.scrollTo(100);
        fixture.detectChanges();

        virtualScrollComponent.scrollBy(200);
        fixture.detectChanges();
        fixture.detectChanges();

        expect(virtualScrollComponent.getScrollTop()).toBe(300);
      });

      it('should not scroll below 0', () => {
        virtualScrollComponent.scrollTo(50);
        fixture.detectChanges();

        virtualScrollComponent.scrollBy(-100);
        fixture.detectChanges();
        fixture.detectChanges();

        expect(virtualScrollComponent.getScrollTop()).toBe(0);
      });

      it('should not scroll past max', () => {
        const maxScroll = 5000 - 300; // totalHeight - containerHeight
        virtualScrollComponent.scrollTo(maxScroll - 50);
        fixture.detectChanges();

        virtualScrollComponent.scrollBy(100);
        fixture.detectChanges();
        fixture.detectChanges();

        expect(virtualScrollComponent.getScrollTop()).toBe(maxScroll);
      });
    });
  });

  describe('auto-scroll registration', () => {
    it('should register with auto-scroll service on init', () => {
      const registerSpy = jest.spyOn(autoScrollService, 'registerContainer');
      registerSpy.mockClear();

      const newFixture = TestBed.createComponent(TestHostComponent);
      newFixture.componentInstance.items.set(generateItems(100));
      newFixture.componentInstance.scrollContainerId.set('new-test-scroll');
      newFixture.detectChanges();
      newFixture.detectChanges();

      expect(registerSpy).toHaveBeenCalledWith(
        'new-test-scroll',
        expect.any(HTMLElement),
        expect.any(Object),
      );

      newFixture.destroy();
    });

    it('should unregister from auto-scroll on destroy', () => {
      const unregisterSpy = jest.spyOn(autoScrollService, 'unregisterContainer');

      fixture.destroy();

      expect(unregisterSpy).toHaveBeenCalledWith('test-scroll');
    });

    it('should unregister when autoScrollEnabled changes to false', () => {
      const unregisterSpy = jest.spyOn(autoScrollService, 'unregisterContainer');
      unregisterSpy.mockClear();

      component.autoScrollEnabled.set(false);
      fixture.detectChanges();

      expect(unregisterSpy).toHaveBeenCalledWith('test-scroll');
    });

    it('should re-register when scroll ID and auto-scroll config change', () => {
      const registerSpy = jest.spyOn(autoScrollService, 'registerContainer');
      const unregisterSpy = jest.spyOn(autoScrollService, 'unregisterContainer');
      registerSpy.mockClear();
      unregisterSpy.mockClear();

      component.autoScrollConfig.set({ threshold: 90, maxSpeed: 25 });
      component.scrollContainerId.set('updated-scroll');
      fixture.detectChanges();

      expect(unregisterSpy).toHaveBeenCalledWith('test-scroll');
      expect(registerSpy).toHaveBeenCalledWith('updated-scroll', virtualScrollEl, {
        threshold: 90,
        maxSpeed: 25,
      });
    });

    it('should not register if autoScrollEnabled is false', () => {
      const registerSpy = jest.spyOn(autoScrollService, 'registerContainer');
      registerSpy.mockClear();

      const newFixture = TestBed.createComponent(TestHostComponent);
      newFixture.componentInstance.items.set(generateItems(100));
      newFixture.componentInstance.autoScrollEnabled.set(false);
      newFixture.componentInstance.scrollContainerId.set('disabled-scroll');
      newFixture.detectChanges();
      newFixture.detectChanges();

      const calls = registerSpy.mock.calls.filter((call) => call[0] === 'disabled-scroll');
      expect(calls.length).toBe(0);

      newFixture.destroy();
    });
  });

  describe('empty list', () => {
    it('should handle empty items array', () => {
      component.items.set([]);
      fixture.detectChanges();
      fixture.detectChanges();

      const items = fixture.debugElement.queryAll(By.css('.item'));
      expect(items.length).toBe(0);
      expect(virtualScrollComponent.getScrollHeight()).toBe(0);
    });
  });

  describe('single item', () => {
    it('should render single item correctly', () => {
      component.items.set([{ id: 'single', name: 'Single Item' }]);
      fixture.detectChanges();
      fixture.detectChanges();

      const items = fixture.debugElement.queryAll(By.css('.item'));
      expect(items.length).toBe(1);
      expect(virtualScrollComponent.getScrollHeight()).toBe(50);
    });
  });

  describe('container height changes', () => {
    it('should render more rows when the container grows', () => {
      component.containerHeight.set(600);
      fixture.detectChanges();
      fixture.detectChanges();

      // 600px / 50px = 12 visible + 3 overscan → items 0-15 (was 0-9 at 300px)
      expect(renderedIndices()).toEqual(range(0, 15));
      expect(virtualScrollEl.style.height).toBe('600px');
    });
  });

  describe('item template context', () => {
    it('should provide the item, its index and sticky flag to the item template', () => {
      const second = fixture.debugElement.queryAll(By.css('.item'))[1].nativeElement as HTMLElement;

      expect(second.textContent?.trim()).toBe('Item 1');
      expect(second.getAttribute('data-draggable-id')).toBe('item-1');
      expect(second.getAttribute('data-index')).toBe('1');
      expect(second.getAttribute('data-sticky')).toBe('false');
    });
  });

  describe('dynamic item measurement', () => {
    beforeEach(() => {
      // Drop the observers that earlier fixtures disconnected
      MockResizeObserver.instances = MockResizeObserver.instances.filter(
        (observer) => !observer.disconnected,
      );
    });

    it('observes rendered items with selector-sensitive draggable IDs', () => {
      const unsafeId = 'item-"quoted"\\[one]';
      const dynamicFixture = TestBed.createComponent(TestHostComponent);
      dynamicFixture.componentInstance.items.set([{ id: unsafeId, name: 'Unsafe ID item' }]);
      dynamicFixture.componentInstance.dynamicItemHeight.set(true);

      expect(() => {
        dynamicFixture.detectChanges();
        dynamicFixture.detectChanges();
      }).not.toThrow();

      const [itemObserver] = MockResizeObserver.measuringRows();
      const itemElement = dynamicFixture.nativeElement.querySelector('.item') as HTMLElement | null;

      expect(itemElement?.getAttribute('data-draggable-id')).toBe(unsafeId);
      expect(itemObserver.observe).toHaveBeenCalledWith(itemElement);

      dynamicFixture.destroy();
    });

    const renderedItems = (): Element[] =>
      fixture.debugElement
        .queryAll(By.css('[data-draggable-id]'))
        .map((el) => el.nativeElement as Element);

    const byDraggableId = (a: Element, b: Element): number =>
      (a.getAttribute('data-draggable-id') ?? '').localeCompare(
        b.getAttribute('data-draggable-id') ?? '',
      );

    const setDynamic = (dynamic: boolean): void => {
      component.dynamicItemHeight.set(dynamic);
      fixture.detectChanges();
      fixture.detectChanges();
    };

    it('should not measure rows while heights are fixed', () => {
      expect(renderedItems().length).toBeGreaterThan(0);
      expect(MockResizeObserver.measuringRows()).toEqual([]);
    });

    it('should start measuring the rendered rows when dynamic heights are turned on', () => {
      setDynamic(true);

      const observers = MockResizeObserver.measuringRows();
      expect(observers.length).toBe(1);
      expect(observers[0].observedElements()).toEqual(renderedItems());
    });

    it('should stop measuring when dynamic heights are turned off', () => {
      setDynamic(true);
      const [observer] = MockResizeObserver.measuringRows();

      setDynamic(false);

      expect(observer.disconnect).toHaveBeenCalled();
      expect(MockResizeObserver.measuringRows()).toEqual([]);
    });

    it('should measure rows added by a render', () => {
      component.items.set(generateItems(2));
      setDynamic(true);
      expect(MockResizeObserver.measuringRows()[0].observedElements().length).toBe(2);

      component.items.set(generateItems(4));
      fixture.detectChanges();

      const [observer] = MockResizeObserver.measuringRows();
      expect(observer.observedElements()).toEqual(renderedItems());
      expect(renderedItems().length).toBe(4);
    });

    it('should find the rows to measure with one query per render, not one per row', async () => {
      setDynamic(true);
      const querySelectorAll = jest.spyOn(Element.prototype, 'querySelectorAll');

      await scrollContainerTo(2000);

      const rowQueries = querySelectorAll.mock.calls.filter(
        ([selector]) => selector === '[data-draggable-id]',
      );
      querySelectorAll.mockRestore();
      const [observer] = MockResizeObserver.measuringRows();
      expect(renderedItems().length).toBeGreaterThan(1);
      expect(observer.observedElements()).toEqual(renderedItems());
      expect(rowQueries.length).toBe(1);
    });

    it('should measure the first element rendered with an item ID', () => {
      // The row template renders the ID twice: on the row and on a nested element
      const nestedFixture = TestBed.createComponent(NestedIdHostComponent);
      nestedFixture.componentInstance.items.set(generateItems(3));
      nestedFixture.detectChanges();
      nestedFixture.detectChanges();

      const [observer] = MockResizeObserver.measuringRows();
      const rows: Element[] = Array.from(nestedFixture.nativeElement.querySelectorAll('.row'));
      expect(rows.length).toBe(3);
      expect(observer.observedElements()).toEqual(rows);

      nestedFixture.destroy();
    });

    it('should measure every rendered row into the new strategy when itemHeight changes', () => {
      setDynamic(true);
      const [first] = MockResizeObserver.measuringRows();

      component.itemHeight.set(80);
      fixture.detectChanges();
      fixture.detectChanges();

      const observers = MockResizeObserver.measuringRows();
      expect(first.disconnected).toBe(true);
      expect(observers.length).toBe(1);
      expect(observers[0].observedElements()).toEqual(renderedItems());
    });

    it('should not measure rows during server rendering', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [TestHostComponent],
        providers: [
          DragStateService,
          AutoScrollService,
          PositionCalculatorService,
          { provide: PLATFORM_ID, useValue: 'server' },
        ],
      });
      MockResizeObserver.instances = [];
      const serverFixture = TestBed.createComponent(TestHostComponent);
      serverFixture.componentInstance.items.set(generateItems(4));
      serverFixture.componentInstance.dynamicItemHeight.set(true);
      serverFixture.detectChanges();
      serverFixture.detectChanges();

      expect(MockResizeObserver.measuringRows()).toEqual([]);
      serverFixture.destroy();
    });

    it('should measure the rows a new item template renders, and stop measuring the old ones', () => {
      setDynamic(true);
      const [observer] = MockResizeObserver.measuringRows();
      const before = renderedItems();

      component.otherTemplate.set(true);
      fixture.detectChanges();
      fixture.detectChanges();

      const after = renderedItems();
      // The new template renders every row anew
      expect(after.length).toBe(before.length);
      expect(after.some((element) => before.includes(element))).toBe(false);
      expect(observer.observedElements()).toEqual(after);
    });

    it('should measure a recycled row for the item it renders now', async () => {
      component.droppableId.set('list');
      component.recycleRows.set(true);
      setDynamic(true);
      const [observer] = MockResizeObserver.measuringRows();
      const before = renderedItems();

      // Rows 0-9 scroll out and rows 37-49 in: the views of rows 0-9 render 10 of them
      await scrollContainerTo(2000);

      const after = renderedItems();
      const recycled = after.find((element) => before.includes(element));
      expect(recycled).toBeDefined();
      expect([...observer.observedElements()].sort(byDraggableId)).toEqual(
        [...after].sort(byDraggableId),
      );

      // Its height goes to the item it renders now, not to the one it rendered before
      const id = recycled!.getAttribute('data-draggable-id')!;
      const index = Number(id.replace('item-', ''));
      expect(index).toBeGreaterThanOrEqual(37);
      observer.resize(recycled!, 80);
      const strategy = TestBed.inject(DragIndexCalculatorService).getStrategyForDroppable('list');
      expect(strategy?.getItemHeight(index)).toBe(80);
      expect(virtualScrollComponent.getScrollHeight()).toBe(5000 + 30);
    });

    it('should measure every rendered row again when dynamic heights are turned back on', () => {
      setDynamic(true);
      setDynamic(false);

      setDynamic(true);

      const observers = MockResizeObserver.measuringRows();
      expect(observers.length).toBe(1);
      expect(observers[0].observedElements()).toEqual(renderedItems());
    });
  });

  describe('keyboard drag autoscroll', () => {
    /** Keyboard drag of `item-${sourceIndex}` inside this list (droppable 'list'). */
    const startSameListKeyboardDrag = (sourceIndex: number): void => {
      component.droppableId.set('list');
      fixture.detectChanges();
      const item: DraggedItem = {
        draggableId: `item-${sourceIndex}`,
        droppableId: 'list',
        element: document.createElement('div'),
        height: 50,
        width: 200,
      };
      // The placeholder starts in the item's own slot (placeholder index = source + 1)
      dragStateService.startDrag(
        item,
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        null,
        'list',
        null,
        sourceIndex + 1,
        sourceIndex,
        true,
      );
      fixture.detectChanges();
    };

    it('should keep the placeholder in view when moving down past the source', () => {
      startSameListKeyboardDrag(0);

      // Target 10 → placeholder index 11. Item 0's slot is excluded, so the placeholder
      // renders at [500, 550); the 300px viewport must end at its bottom edge.
      dragStateService.setKeyboardTargetIndex(10);
      fixture.detectChanges();

      expect(virtualScrollComponent.getScrollTop()).toBe(550 - 300);
      expect(virtualScrollEl.scrollTop).toBe(250);
    });

    it('should keep the placeholder in view when moving up above the source', () => {
      virtualScrollComponent.scrollTo(2000);
      startSameListKeyboardDrag(50);

      // Target 10 (above the source) → placeholder index 10, rendered at [500, 550)
      dragStateService.setKeyboardTargetIndex(10);
      fixture.detectChanges();

      expect(virtualScrollComponent.getScrollTop()).toBe(500);
    });

    it('should scroll on the arrow key itself, before change detection runs', () => {
      component.droppableId.set('list');
      fixture.detectChanges();
      const keyboardDrag = TestBed.inject(KeyboardDragService);
      keyboardDrag.startKeyboardDrag(
        {
          draggableId: 'item-0',
          droppableId: 'list',
          element: document.createElement('div'),
          height: 50,
          width: 200,
        },
        0,
        100,
        'list',
      );
      fixture.detectChanges();

      // A drop can arrive before the next render, so each move must scroll right away.
      // Target 10 → placeholder at [500, 550) → the 300px viewport ends at 550.
      for (let i = 0; i < 10; i++) {
        keyboardDrag.moveDown();
      }

      expect(virtualScrollEl.scrollTop).toBe(250);
      expect(virtualScrollComponent.getScrollTop()).toBe(250);
    });

    it('should scroll the list a keyboard drag moves into, before change detection runs', () => {
      component.droppableId.set('list');
      fixture.detectChanges();
      const keyboardDrag = TestBed.inject(KeyboardDragService);
      keyboardDrag.startKeyboardDrag(
        {
          draggableId: 'other-0',
          droppableId: 'other',
          element: document.createElement('div'),
          height: 50,
          width: 200,
        },
        0,
        100,
        'other',
      );
      dragStateService.setKeyboardTargetIndex(20);
      fixture.detectChanges();

      // Target 20 in another list → placeholder at [1000, 1050)
      keyboardDrag.moveToDroppable('list', 20, 100);

      expect(virtualScrollEl.scrollTop).toBe(1050 - 300);
    });

    it('should not scroll to the placeholder during a pointer drag', () => {
      component.droppableId.set('list');
      fixture.detectChanges();
      dragStateService.startDrag(
        {
          draggableId: 'item-0',
          droppableId: 'list',
          element: document.createElement('div'),
          height: 50,
          width: 200,
        },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        null,
        'list',
        null,
        30,
        0,
        false,
      );
      fixture.detectChanges();
      fixture.detectChanges();

      expect(virtualScrollEl.scrollTop).toBe(0);
    });
  });

  describe('regressions', () => {
    it('should have correct contentTransform when dragged item is above visible range (Issue 5)', async () => {
      // 1. Scroll down so item 0-10 are out of view
      virtualScrollEl.scrollTop = 1000;
      virtualScrollEl.dispatchEvent(new Event('scroll'));
      await nextAnimationFrame();
      fixture.detectChanges();

      const firstItemBeforeDrag = fixture.debugElement.query(By.css('.item'));
      const start = parseInt(firstItemBeforeDrag.nativeElement.getAttribute('data-index'), 10);
      expect(start).toBeGreaterThan(5);

      // 2. Drag item 2 (which is above visible range)
      const item: DraggedItem = {
        draggableId: 'item-2',
        droppableId: 'test-scroll',
        element: document.createElement('div'),
        height: 50,
        width: 200,
      };

      dragStateService.startDrag(item);
      fixture.detectChanges();

      // 3. Verify content transform
      // item-2's slot closes up, so the first row in view, and the render start with it, move one
      // on: the content starts at strategy.getOffsetForIndex(start + 1), which skips item-2
      const wrapper = fixture.debugElement.query(By.css('.vdnd-virtual-scroll-content-wrapper'));
      const expectedOffset = start * 50;
      expect(wrapper.nativeElement.style.transform).toBe(`translateY(${expectedOffset}px)`);

      dragStateService.endDrag();
    });

    it('should keep scroll stable at bottom during drag (Issue 4)', async () => {
      // Use fewer items to reach bottom easily
      component.items.set(generateItems(20)); // 1000px total height
      fixture.detectChanges();

      // 1. Scroll to bottom
      const maxScroll = 1000 - 300;
      virtualScrollEl.scrollTop = maxScroll;
      virtualScrollEl.dispatchEvent(new Event('scroll'));
      await nextAnimationFrame();
      fixture.detectChanges();

      // 2. Start drag of an item
      const item: DraggedItem = {
        draggableId: 'item-10',
        droppableId: 'test-scroll',
        element: document.createElement('div'),
        height: 50,
        width: 200,
      };
      dragStateService.startDrag(item);
      fixture.detectChanges();

      // During drag, total height stays at 1000px (no longer shrinks).
      // Scroll should NOT be clamped — it stays at 700px.
      expect(virtualScrollEl.scrollTop).toBe(700);

      // 3. End drag
      dragStateService.endDrag();
      fixture.detectChanges();

      // Wait for afterNextRender
      await new Promise((resolve) => setTimeout(resolve, 50));
      fixture.detectChanges();

      // Scroll stays at 700px (no height change to compensate for)
      expect(virtualScrollEl.scrollTop).toBe(700);
    });
  });
});

/** Row views created and destroyed (counted by a directive on each row) */
const rowViews = { created: 0, destroyed: 0 };

@Directive({ selector: '[vdndTestRowView]' })
class RowViewDirective implements OnDestroy {
  constructor() {
    rowViews.created++;
  }

  ngOnDestroy(): void {
    rowViews.destroyed++;
  }
}

@Component({
  template: `
    <div class="host-render" [attr.data-count]="countHostRender()"></div>
    <ng-template #itemTpl let-item let-index="index" let-isSticky="isSticky">
      <div
        class="item"
        vdndTestRowView
        [attr.data-draggable-id]="item.id"
        [attr.data-index]="index"
        [attr.data-sticky]="isSticky"
        [attr.data-name]="item.name"
        [attr.data-selected]="selectedId === item.id"
      >
        {{ countRowRender(item.id) }}
      </div>
    </ng-template>
    <!-- Its root is a control flow block: the view lists the block's anchor before its row -->
    <ng-template #controlFlowTpl let-item let-index="index">
      @if (item) {
        <div class="item" [attr.data-draggable-id]="item.id" [attr.data-index]="index">
          {{ countRowRender(item.id) }}
        </div>
      }
    </ng-template>
    <vdnd-virtual-scroll
      [items]="items()"
      [itemHeight]="50"
      [containerHeight]="200"
      [itemIdFn]="itemIdFn"
      [trackByFn]="trackByFn()"
      [itemTemplate]="
        template() === 'controlFlow' ? controlFlowTpl : template() === 'none' ? noTemplate : itemTpl
      "
      [recycleRows]="recycleRows()"
      [autoStickyDraggedItem]="autoStickyDraggedItem()"
      droppableId="list"
    />
  `,
  imports: [VirtualScrollContainerComponent, RowViewDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class RenderCountingHostComponent {
  readonly #changeDetector = inject(ChangeDetectorRef);
  // 200px of 50px rows: 4 in view plus 3 overscan below, so rows 0-7
  readonly items = signal<TestItem[]>(
    Array.from({ length: 30 }, (_, i) => ({ id: `item-${i}`, name: `Item ${i}` })),
  );
  readonly template = signal<'plain' | 'controlFlow' | 'none'>('plain');
  readonly trackByFn = signal<((index: number, item: TestItem) => string) | undefined>(undefined);
  readonly recycleRows = signal(false);
  readonly autoStickyDraggedItem = signal(true);
  readonly itemIdFn = (item: TestItem): string => item.id;
  /** A plain field: the rows show it when this component renders them */
  selectedId: string | null = null;
  // A misconfigured list: the template input is required, but a bound value can still be missing
  readonly noTemplate = undefined as unknown as TemplateRef<VirtualScrollItemContext<TestItem>>;

  hostRenders = 0;
  readonly rowRenders: string[] = [];

  countHostRender(): number {
    return ++this.hostRenders;
  }

  countRowRender(id: string): string {
    this.rowRenders.push(id);
    return id;
  }

  select(id: string): void {
    this.selectedId = id;
    this.#changeDetector.markForCheck();
  }
}

describe('VirtualScrollContainerComponent (item IDs)', () => {
  let fixture: ComponentFixture<IdCountingHostComponent>;
  let host: IdCountingHostComponent;
  let dragState: DragStateService;
  const originalResizeObserver = globalThis.ResizeObserver;

  const makeItems = (count: number): TestItem[] =>
    Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, name: `Item ${i}` }));

  const render = (): void => {
    fixture.detectChanges();
    fixture.detectChanges();
  };

  const renderedIndices = (): number[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.item')).map((row) =>
      Number(row.getAttribute('data-index')),
    );

  const renderedIds = (): string[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.item')).map(
      (row) => row.getAttribute('data-draggable-id') ?? '',
    );

  /** The list's strategy, as drag and drop sees it */
  const strategy = () =>
    TestBed.inject(DragIndexCalculatorService).getStrategyForDroppable('list')!;

  /** Move the first item to the end, as a drop does */
  const moveFirstToEnd = (): void => {
    const [first, ...rest] = host.items();
    host.items.set([...rest, first]);
  };

  /** A drag of `id` from `droppableId`, which found the item at `sourceIndex` */
  const startDragOf = (id: string, sourceIndex?: number, droppableId = 'list'): void => {
    dragState.startDrag(
      {
        draggableId: id,
        droppableId,
        element: document.createElement('div'),
        height: 50,
        width: 100,
      },
      undefined,
      undefined,
      null,
      droppableId,
      null,
      null,
      sourceIndex ?? null,
    );
    render();
  };

  const scrollTo = async (scrollTop: number): Promise<void> => {
    const list = fixture.debugElement.query(By.directive(VirtualScrollContainerComponent))
      .nativeElement as HTMLElement;
    list.scrollTop = scrollTop;
    list.dispatchEvent(new Event('scroll'));
    await nextAnimationFrame();
    render();
  };

  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    TestBed.configureTestingModule({ imports: [IdCountingHostComponent] });
    fixture = TestBed.createComponent(IdCountingHostComponent);
    host = fixture.componentInstance;
    dragState = TestBed.inject(DragStateService);
    host.items.set(makeItems(1000));
    render();
  });

  afterEach(() => {
    dragState.endDrag();
    fixture.destroy();
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('computes only the IDs of the rendered rows when fixed-height items change', () => {
    host.idCalls = 0;

    moveFirstToEnd();
    render();

    expect(renderedIds()).toEqual(Array.from({ length: 10 }, (_, i) => `item-${i + 1}`));
    // Not one per item: a fixed-height strategy needs only the count
    expect(host.idCalls).toBeLessThan(100);
    expect(strategy().getItemCount()).toBe(1000);
  });

  it('computes each item ID once when dynamic-height items change', () => {
    host.dynamicItemHeight.set(true);
    render();
    host.idCalls = 0;

    moveFirstToEnd();
    render();

    // The height cache needs every ID, and gets them once
    expect(host.idCalls).toBeGreaterThanOrEqual(1000);
    expect(host.idCalls).toBeLessThan(1100);
    expect(strategy().getItemCount()).toBe(1000);
  });

  it('gives a dynamic-height strategy the item IDs in their new order', () => {
    host.dynamicItemHeight.set(true);
    render();

    moveFirstToEnd();
    render();
    strategy().setMeasuredHeight('item-0', 200);

    expect(strategy().getItemHeight(999)).toBe(200);
    expect(strategy().getItemHeight(0)).toBe(50);
  });

  it.each([
    ['fixed', false],
    ['dynamic', true],
  ])('collapses the slot of the item dragged in the list (%s heights)', (_heights, dynamic) => {
    host.dynamicItemHeight.set(dynamic);
    render();

    startDragOf('item-5');

    expect(strategy().getOffsetForIndex(5)).toBe(250);
    expect(strategy().getOffsetForIndex(6)).toBe(250);
    // The spacer keeps every item
    expect(strategy().getTotalHeight(1000)).toBe(50_000);
  });

  it('finds the dragged item at the source index of the drag without computing every item ID', () => {
    host.idCalls = 0;

    startDragOf('item-5', 5);

    expect(host.idCalls).toBeLessThan(100);
    expect(strategy().getOffsetForIndex(6)).toBe(250);
  });

  it('finds the dragged item when the source index of the drag is not its index', () => {
    startDragOf('item-5', 7);

    expect(strategy().getOffsetForIndex(6)).toBe(250);
    expect(strategy().getOffsetForIndex(8)).toBe(350);
  });

  it('does not look for the item of a drag from another list', () => {
    host.idCalls = 0;

    startDragOf('elsewhere-5', 5, 'other-list');

    expect(host.idCalls).toBeLessThan(100);
    expect(strategy().getOffsetForIndex(6)).toBe(300);
  });

  it('keeps rendering the dragged item once it scrolls out of the rendered rows', async () => {
    startDragOf('item-5');

    await scrollTo(2000);

    expect(renderedIndices()).toContain(5);
    expect(renderedIndices()).toContain(40);
  });

  it('keeps rendering a sticky item outside the rendered rows', () => {
    host.stickyItemIds.set(['item-500']);
    render();

    expect(renderedIndices()).toEqual([...Array.from({ length: 10 }, (_, i) => i), 500]);
  });

  it('follows a sticky item to its new index when the items change', () => {
    host.stickyItemIds.set(['item-500']);
    render();

    moveFirstToEnd();
    render();

    expect(renderedIndices()).toEqual([...Array.from({ length: 10 }, (_, i) => i), 499]);
  });
});

describe('VirtualScrollContainerComponent (change detection scope)', () => {
  let fixture: ComponentFixture<RenderCountingHostComponent>;
  let host: RenderCountingHostComponent;
  let dragState: DragStateService;
  let appRef: ApplicationRef;
  const originalResizeObserver = globalThis.ResizeObserver;

  const listElement = (): HTMLElement =>
    (fixture.nativeElement as HTMLElement).querySelector('vdnd-virtual-scroll') as HTMLElement;

  const rowElement = (id: string): HTMLElement | null =>
    listElement().querySelector<HTMLElement>(`[data-draggable-id="${id}"]`);

  const placeholder = (): HTMLElement | null =>
    listElement().querySelector<HTMLElement>('vdnd-drag-placeholder');

  /** Rendered rows and the placeholder, in DOM order (`P` for the placeholder) */
  const renderedOrder = (): string[] =>
    Array.from(
      listElement().querySelectorAll<HTMLElement>('[data-draggable-id], vdnd-drag-placeholder'),
    ).map((el) => el.getAttribute('data-draggable-id') ?? 'P');

  const items = (from: number, to: number): string[] =>
    Array.from({ length: to - from + 1 }, (_, i) => `item-${from + i}`);

  const resetCounts = (): void => {
    host.hostRenders = 0;
    host.rowRenders.length = 0;
  };

  const render = (): void => {
    appRef.tick();
  };

  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    TestBed.configureTestingModule({ imports: [RenderCountingHostComponent] });
    fixture = TestBed.createComponent(RenderCountingHostComponent);
    host = fixture.componentInstance;
    dragState = TestBed.inject(DragStateService);
    appRef = TestBed.inject(ApplicationRef);
    fixture.detectChanges();
    render();
    resetCounts();
  });

  afterEach(() => {
    dragState.endDrag();
    fixture.destroy();
    globalThis.ResizeObserver = originalResizeObserver;
  });

  const startDrag = (activeDroppableId: string, placeholderIndex: number | null): void => {
    dragState.startDrag(
      {
        draggableId: 'item-0',
        droppableId: 'list',
        element: document.createElement('div'),
        height: 50,
        width: 100,
      },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      null,
      activeDroppableId,
      END_OF_LIST,
      placeholderIndex,
      0,
    );
    render();
    resetCounts();
  };

  const movePlaceholder = (activeDroppableId: string | null, placeholderIndex: number): void => {
    dragState.updateDragPosition({
      cursorPosition: { x: 0, y: 0 },
      activeDroppableId,
      placeholderId: END_OF_LIST,
      placeholderIndex,
    });
    render();
  };

  /** From now on, record the rows the DOM removes (moved or destroyed); call to read them */
  const watchRemovedRows = (): (() => string[]) => {
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((delivered) => records.push(...delivered));
    observer.observe(listElement(), { childList: true, subtree: true });
    return () => {
      records.push(...observer.takeRecords());
      observer.disconnect();
      return records
        .flatMap((record) => Array.from(record.removedNodes))
        .filter((node): node is HTMLElement => node instanceof HTMLElement)
        .map((node) => node.getAttribute('data-draggable-id') ?? '')
        .filter((id) => id !== '');
    };
  };

  const scrollTo = async (scrollTop: number): Promise<void> => {
    listElement().scrollTop = scrollTop;
    listElement().dispatchEvent(new Event('scroll'));
    await nextAnimationFrame();
    render();
  };

  it('renders the rows in range', () => {
    expect(renderedOrder()).toEqual(items(0, 7));
  });

  it('re-renders neither the host nor any row when only the placeholder moves', () => {
    // item-0 is dragged within the list; the placeholder starts in its own slot
    startDrag('list', 1);

    movePlaceholder('list', 3);
    movePlaceholder('list', 5);

    // The placeholder renders before the item at its index. item-0's slot closes up, so the
    // range reaches one row further
    expect(renderedOrder()).toEqual([...items(0, 4), 'P', ...items(5, 8)]);
    expect(host.hostRenders).toBe(0);
    expect(host.rowRenders).toEqual([]);
  });

  it('re-renders no row when the placeholder enters or leaves the list', () => {
    // item-0 is dragged over another list
    startDrag('other', 0);

    // item-0's slot closes up, so the range reaches one row further
    movePlaceholder('list', 2);
    expect(renderedOrder()).toEqual([...items(0, 1), 'P', ...items(2, 8)]);

    movePlaceholder('other', 0);
    expect(placeholder()).toBeNull();

    expect(host.hostRenders).toBe(0);
    expect(host.rowRenders).toEqual([]);
  });

  it('renders only the dragged row when a drag starts (it becomes sticky)', () => {
    dragState.startDrag(
      {
        draggableId: 'item-2',
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
      3,
      2,
    );
    render();

    expect(host.rowRenders).toEqual(['item-2']);
    expect(rowElement('item-2')?.getAttribute('data-sticky')).toBe('true');
    expect(rowElement('item-1')?.getAttribute('data-sticky')).toBe('false');
  });

  it('renders only the rows that scroll in', async () => {
    const kept = rowElement('item-5');

    // First row in view goes from 0 to 4: the range goes from 0-7 to 1-11
    await scrollTo(200);

    expect(renderedOrder()).toEqual(items(1, 11));
    expect([...host.rowRenders].sort()).toEqual(items(8, 11).sort());
    expect(host.hostRenders).toBe(0);
    // A row still in range keeps its element
    expect(rowElement('item-5')).toBe(kept);
    const wrapper = listElement().querySelector<HTMLElement>(
      '.vdnd-virtual-scroll-content-wrapper',
    );
    expect(wrapper?.style.transform).toBe('translateY(50px)');
  });

  it('never gives a row view to another item: a row that leaves and returns is rendered anew', async () => {
    const first = rowElement('item-0');
    await scrollTo(1000);
    expect(rowElement('item-0')).toBeNull();

    await scrollTo(0);

    expect(rowElement('item-0')).not.toBeNull();
    expect(rowElement('item-0')).not.toBe(first);
  });

  it('moves the rows of reordered items and shows their new index', () => {
    const moved = rowElement('item-6');
    const reordered = [...host.items()];
    const [item6] = reordered.splice(6, 1);
    reordered.splice(1, 0, item6);
    host.items.set(reordered);
    render();

    expect(renderedOrder()).toEqual(['item-0', 'item-6', ...items(1, 5), 'item-7']);
    expect(rowElement('item-6')).toBe(moved);
    expect(rowElement('item-6')?.getAttribute('data-index')).toBe('1');
    expect(rowElement('item-5')?.getAttribute('data-index')).toBe('6');
  });

  it('shows a replaced item in the row of its track key', () => {
    const row = rowElement('item-3');
    host.items.set(
      host.items().map((item) => (item.id === 'item-3' ? { ...item, name: 'Renamed' } : item)),
    );
    resetCounts();
    render();

    expect(rowElement('item-3')).toBe(row);
    expect(rowElement('item-3')?.getAttribute('data-name')).toBe('Renamed');
  });

  it('renders every row anew when the item template changes', () => {
    const before = rowElement('item-0');

    host.template.set('controlFlow');
    render();

    expect(renderedOrder()).toEqual(items(0, 7));
    expect(rowElement('item-0')).not.toBe(before);
  });

  it('places the placeholder before a row whose template starts with a control flow block', () => {
    host.template.set('controlFlow');
    render();
    startDrag('list', 1);

    movePlaceholder('list', 5);

    expect(renderedOrder()).toEqual([...items(0, 4), 'P', ...items(5, 8)]);
    expect(host.rowRenders).toEqual([]);
  });

  it('renders the placeholder after the rows when its index is past the last item', () => {
    host.items.set(host.items().slice(0, 3));
    render();
    startDrag('list', 1);

    movePlaceholder('list', 3);

    expect(renderedOrder()).toEqual([...items(0, 2), 'P']);
  });

  it('does not render the placeholder when its index is outside the rendered rows', () => {
    startDrag('list', 1);

    movePlaceholder('list', 20);

    expect(placeholder()).toBeNull();
  });

  it('renders the placeholder as a DragPlaceholderComponent sized like an item', () => {
    startDrag('list', 2);

    // Found through the debug tree too, as consumers' own tests may look for it
    const debugPlaceholder = fixture.debugElement.query(By.css('vdnd-drag-placeholder'));
    expect(debugPlaceholder.componentInstance).toBeInstanceOf(DragPlaceholderComponent);
    const element = debugPlaceholder.nativeElement as HTMLElement;
    expect(element).toBe(placeholder());
    expect(element.classList.contains('vdnd-drag-placeholder')).toBe(true);
    expect(element.classList.contains('vdnd-drag-placeholder-visible')).toBe(true);
    expect(element.style.height).toBe('50px');
  });

  it('removes the placeholder when the drag ends', () => {
    startDrag('list', 2);
    expect(placeholder()).not.toBeNull();

    dragState.endDrag();
    render();

    expect(placeholder()).toBeNull();
    expect(renderedOrder()).toEqual(items(0, 7));
  });

  it('removes the placeholder when the list is destroyed during a drag', () => {
    startDrag('list', 2);
    const element = placeholder();
    expect(element?.isConnected).toBe(true);

    fixture.destroy();

    expect(element?.isConnected).toBe(false);
  });

  it('keeps the placeholder in renderedItems for subclasses', () => {
    startDrag('list', 1);
    movePlaceholder('list', 3);

    const list = fixture.debugElement.query(By.directive(VirtualScrollContainerComponent))
      .componentInstance as VirtualScrollContainerComponent<TestItem>;
    const entries = list['renderedItems']().map((entry) =>
      entry.type === 'placeholder' ? 'P' : (entry.data as TestItem).id,
    );
    expect(entries).toEqual([...items(0, 2), 'P', ...items(3, 8)]);
  });

  it('renders every item of a duplicated track key and warns once', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const duplicated = [...host.items()];
    duplicated[2] = { id: 'item-1', name: 'Duplicate' };
    host.items.set(duplicated);
    render();
    host.items.set([...duplicated]);
    render();

    expect(renderedOrder()).toEqual(['item-0', 'item-1', 'item-1', ...items(3, 7)]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('renders each row once when the list first renders', () => {
    const other = TestBed.createComponent(RenderCountingHostComponent);
    other.detectChanges();

    expect([...other.componentInstance.rowRenders].sort()).toEqual(items(0, 7).sort());
    other.destroy();
  });

  it('renders each row once when the items change', () => {
    const reordered = [...host.items()];
    const [first] = reordered.splice(0, 1);
    reordered.splice(3, 0, first);
    host.items.set(reordered);
    render();

    expect([...host.rowRenders].sort()).toEqual(items(0, 7).sort());
  });

  it('moves only the row of an item moved down the list', () => {
    const removedRows = watchRemovedRows();
    const reordered = [...host.items()];
    const [first] = reordered.splice(0, 1);
    reordered.splice(6, 0, first);
    host.items.set(reordered);
    render();

    expect(renderedOrder()).toEqual([...items(1, 6), 'item-0', 'item-7']);
    expect(removedRows()).toEqual(['item-0']);
  });

  it('renders any mix of removals, insertions and moves in order, keeping the rows that stay', () => {
    // A seeded pseudo-random sequence; at most 8 items, so every item renders
    let seed = 7;
    const random = (count: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % count;
    };
    let added = 0;
    let list = host.items().slice(0, 6);
    host.items.set(list);
    render();

    for (let step = 0; step < 60; step++) {
      const elements = new Map(list.map((item) => [item.id, rowElement(item.id)]));
      const next = [...list];
      if (next.length > 2 && random(3) === 0) {
        next.splice(random(next.length), 1);
      }
      if (next.length < 8 && random(2) === 0) {
        next.splice(random(next.length + 1), 0, { id: `new-${added}`, name: `New ${added++}` });
      }
      const [moved] = next.splice(random(next.length), 1);
      next.splice(random(next.length + 1), 0, moved);
      host.items.set(next);
      render();

      expect(renderedOrder()).toEqual(next.map((item) => item.id));
      for (const item of next) {
        if (elements.has(item.id)) {
          expect(rowElement(item.id)).toBe(elements.get(item.id));
        }
      }
      list = next;
    }
  });

  it('moves only the dragged row when the rows before it scroll out of range', async () => {
    // item-0 is dragged (and kept rendered as a sticky row)
    startDrag('list', 1);
    const removedRows = watchRemovedRows();

    // item-0's slot closes up, so the first row in view is 6: rows 3-13 in range, then item-0
    await scrollTo(250);

    expect(renderedOrder()).toEqual([...items(3, 13), 'item-0']);
    expect(removedRows().sort()).toEqual(['item-0', 'item-1', 'item-2']);
  });

  it('keeps the rows when the track function changes', async () => {
    const row = rowElement('item-5');

    // The same items get other keys
    host.trackByFn.set((_index, item) => item.name);
    render();
    await scrollTo(200);

    expect(rowElement('item-5')).toBe(row);
  });

  it('renders no row, without throwing, while it has no item template', () => {
    host.template.set('none');
    render();
    expect(renderedOrder()).toEqual([]);

    startDrag('list', 2);
    expect(renderedOrder()).toEqual(['P']);

    host.template.set('plain');
    render();
    expect(renderedOrder()).toEqual([...items(0, 1), 'P', ...items(2, 8)]);
  });

  describe('with recycleRows', () => {
    beforeEach(() => {
      host.recycleRows.set(true);
      render();
      resetCounts();
      rowViews.created = 0;
      rowViews.destroyed = 0;
    });

    it('renders the rows that scroll in with the views of the rows that scroll out', async () => {
      const views = items(0, 7).map(rowElement);

      // First row in view 20: rows 17-27. Rows 0-7 leave, so only 3 views are new
      await scrollTo(1000);

      expect(renderedOrder()).toEqual(items(17, 27));
      const rows = items(17, 27).map(rowElement);
      expect(views.every((view) => rows.includes(view))).toBe(true);
      expect(rowViews).toEqual({ created: 3, destroyed: 0 });
      expect([...host.rowRenders].sort()).toEqual(items(17, 27).sort());
      expect(host.hostRenders).toBe(0);
    });

    it('shows the item, index and sticky flag of the row a recycled view renders now', async () => {
      await scrollTo(1000);

      for (let i = 17; i <= 27; i++) {
        const row = rowElement(`item-${i}`);
        expect(row?.getAttribute('data-index')).toBe(`${i}`);
        expect(row?.getAttribute('data-name')).toBe(`Item ${i}`);
        expect(row?.getAttribute('data-sticky')).toBe('false');
      }
    });

    it('keeps the view of a row while its item stays rendered', async () => {
      const kept = items(1, 7).map(rowElement);

      // Rows 1-11: item-0 leaves, and its view renders one of rows 8-11
      await scrollTo(200);

      expect(items(1, 7).map(rowElement)).toEqual(kept);
      expect(rowViews).toEqual({ created: 3, destroyed: 0 });
    });

    it('renders a pooled view again when it comes back for the same item', async () => {
      await scrollTo(1000);
      // Back at the top only rows 0-7 render: the views of rows 17-19 wait in the pool
      await scrollTo(0);
      expect(rowViews).toEqual({ created: 3, destroyed: 0 });

      // What the rows show changes while those views are detached
      host.select('item-17');
      render();
      expect(rowElement('item-0')?.getAttribute('data-selected')).toBe('false');

      // Rows 17-19 get their own views back, with the context they had
      await scrollTo(1000);

      expect(rowElement('item-17')?.getAttribute('data-selected')).toBe('true');
      expect(rowViews).toEqual({ created: 3, destroyed: 0 });
    });

    it('moves only the view that renders another row', async () => {
      const first = rowElement('item-0');
      const removedRows = watchRemovedRows();

      await scrollTo(200);

      // The view of item-0 moves to the end, to render the last new row
      expect(rowElement('item-11')).toBe(first);
      expect(removedRows()).toEqual(['item-11']);
    });

    it('destroys the row of the dragged item instead of recycling it', async () => {
      host.autoStickyDraggedItem.set(false);
      render();
      // item-0 is dragged, and not kept rendered when it scrolls out
      startDrag('list', 1);
      const dragged = rowElement('item-0');

      await scrollTo(1000);

      expect(rowElement('item-0')).toBeNull();
      expect(items(17, 27).map(rowElement)).not.toContain(dragged);
      expect(rowViews.destroyed).toBe(1);
    });

    it('destroys the row that holds the dragged element when its ID is not the item ID', async () => {
      host.autoStickyDraggedItem.set(false);
      render();
      // The draggable ID of the row is not what itemIdFn returns for its item
      const dragged = rowElement('item-0')!;
      dragState.startDrag(
        {
          draggableId: 'row-of-item-0',
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
      render();

      await scrollTo(1000);

      expect(items(17, 27).map(rowElement)).not.toContain(dragged);
      expect(rowViews.destroyed).toBe(1);
    });

    it('destroys the pooled views when recycling is turned off', () => {
      // Rows 5-7 leave: their views wait in the pool
      host.items.set(host.items().slice(0, 5));
      render();
      expect(rowViews.destroyed).toBe(0);

      host.recycleRows.set(false);
      render();

      expect(rowViews.destroyed).toBe(3);
    });

    it('destroys the pooled views with the list', () => {
      host.items.set(host.items().slice(0, 5));
      render();

      fixture.destroy();

      expect(rowViews.destroyed).toBe(8);
    });

    it('destroys the pooled views when the item template changes', () => {
      host.items.set(host.items().slice(0, 5));
      render();

      host.template.set('controlFlow');
      render();

      // The 5 rendered views and the 3 pooled ones
      expect(rowViews.destroyed).toBe(8);
    });

    it('renders any mix of removals, insertions and moves in order', () => {
      let seed = 11;
      const random = (count: number): number => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % count;
      };
      let added = 0;
      let list = host.items().slice(0, 6);
      host.items.set(list);
      render();

      for (let step = 0; step < 60; step++) {
        const next = [...list];
        if (next.length > 2 && random(3) === 0) {
          next.splice(random(next.length), 1);
        }
        if (next.length < 8 && random(2) === 0) {
          next.splice(random(next.length + 1), 0, { id: `new-${added}`, name: `New ${added++}` });
        }
        const [moved] = next.splice(random(next.length), 1);
        next.splice(random(next.length + 1), 0, moved);
        host.items.set(next);
        render();

        expect(renderedOrder()).toEqual(next.map((item) => item.id));
        next.forEach((item, index) => {
          expect(rowElement(item.id)?.getAttribute('data-name')).toBe(item.name);
          expect(rowElement(item.id)?.getAttribute('data-index')).toBe(`${index}`);
        });
        list = next;
      }
    });
  });
});

@Component({
  template: `
    <ng-template #itemTpl let-item>
      <div class="item" [attr.data-draggable-id]="item.id">{{ item.name }}</div>
    </ng-template>
    <vdnd-virtual-scroll
      [items]="items"
      [itemHeight]="50"
      [containerHeight]="200"
      [itemIdFn]="itemIdFn"
      [itemTemplate]="itemTpl"
      droppableId="list"
    />
  `,
  imports: [VirtualScrollContainerComponent],
  providers: [{ provide: VDND_ANIMATION_CONFIG, useValue: { shiftDuration: 200 } }],
})
class AnimatedHostComponent {
  readonly items: TestItem[] = Array.from({ length: 6 }, (_, i) => ({
    id: `item-${i}`,
    name: `Item ${i}`,
  }));
  readonly itemIdFn = (item: TestItem): string => item.id;
}

/** A subclass that renders renderedItems() with a template of its own (the one before #103) */
@Component({
  selector: 'vdnd-test-legacy-template-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, DragPlaceholderComponent],
  template: `
    <div class="vdnd-virtual-scroll-spacer" [style.height.px]="totalHeight()"></div>
    <div class="vdnd-virtual-scroll-content-wrapper" [style.transform]="contentTransform()">
      @for (entry of renderedItems(); track trackEntry($index, entry)) {
        @if (entry.type === 'placeholder') {
          <vdnd-drag-placeholder [itemHeight]="placeholderHeight()" />
        } @else {
          <ng-container
            *ngTemplateOutlet="
              itemTemplate();
              context: { $implicit: entry.data, index: entry.index, isSticky: entry.isSticky }
            "
          />
        }
      }
    </div>
  `,
})
class LegacyTemplateListComponent<T> extends VirtualScrollContainerComponent<T> {}

@Component({
  template: `
    <ng-template #itemTpl let-item>
      <div class="item" [attr.data-draggable-id]="item.id">{{ item.name }}</div>
    </ng-template>
    <vdnd-test-legacy-template-list
      [items]="items"
      [itemHeight]="50"
      [containerHeight]="200"
      [itemIdFn]="itemIdFn"
      [itemTemplate]="itemTpl"
      droppableId="list"
    />
  `,
  imports: [LegacyTemplateListComponent],
  providers: [{ provide: VDND_ANIMATION_CONFIG, useValue: { shiftDuration: 200 } }],
})
class LegacyTemplateAnimatedHostComponent extends AnimatedHostComponent {}

describe.each([
  ['vdnd-virtual-scroll', AnimatedHostComponent],
  ['a subclass rendering its own template', LegacyTemplateAnimatedHostComponent],
])('VirtualScrollContainerComponent (shift animation, %s)', (_name, hostType) => {
  let fixture: ComponentFixture<AnimatedHostComponent>;
  let dragState: DragStateService;
  let appRef: ApplicationRef;
  let animated: string[];
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalAnimate = Element.prototype.animate;
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    animated = [];
    // jsdom has no layout: place each element by its position among its siblings
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const index = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0;
      return { top: index * 50, left: 0, width: 100, height: 50 } as DOMRect;
    };
    Element.prototype.animate = function (this: Element) {
      animated.push(this.getAttribute('data-draggable-id') ?? 'P');
      return {
        cancel: jest.fn(),
        effect: { getComputedTiming: () => ({ progress: 0 }) },
        onfinish: null,
      } as unknown as Animation;
    } as typeof Element.prototype.animate;

    TestBed.configureTestingModule({ imports: [hostType] });
    fixture = TestBed.createComponent(hostType);
    dragState = TestBed.inject(DragStateService);
    appRef = TestBed.inject(ApplicationRef);
    fixture.detectChanges();
    appRef.tick();

    // Drag item-0 within the list; the placeholder starts in its own slot
    dragState.startDrag(
      {
        draggableId: 'item-0',
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
  });

  afterEach(() => {
    dragState.endDrag();
    fixture.destroy();
    globalThis.ResizeObserver = originalResizeObserver;
    Element.prototype.animate = originalAnimate;
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('does not animate the drag start render', () => {
    expect(animated).toEqual([]);
  });

  it('animates the rows a placeholder move displaces, and the placeholder', () => {
    // The placeholder moves from before item-1 to before item-3: item-1 and item-2 move up past it
    dragState.updateDragPosition({
      cursorPosition: { x: 0, y: 0 },
      activeDroppableId: 'list',
      placeholderId: END_OF_LIST,
      placeholderIndex: 3,
    });
    appRef.tick();

    expect([...animated].sort()).toEqual(['P', 'item-1', 'item-2']);
  });
});

@Component({
  template: `
    <ng-template #itemTpl let-item>
      <div class="item" [attr.data-draggable-id]="item.id">{{ item.name }}</div>
    </ng-template>
    <vdnd-virtual-scroll
      [items]="items()"
      [itemHeight]="50"
      [containerHeight]="200"
      [itemIdFn]="itemIdFn"
      [itemTemplate]="itemTpl"
      [recycleRows]="true"
      droppableId="list"
    />
  `,
  imports: [VirtualScrollContainerComponent],
  providers: [{ provide: VDND_ANIMATION_CONFIG, useValue: { shiftDuration: 200 } }],
})
class RecyclingAnimatedHostComponent {
  readonly items = signal<TestItem[]>(
    Array.from({ length: 6 }, (_, i) => ({ id: `item-${i}`, name: `Item ${i}` })),
  );
  readonly itemIdFn = (item: TestItem): string => item.id;
}

describe('VirtualScrollContainerComponent (shift animation of recycled rows)', () => {
  let fixture: ComponentFixture<RecyclingAnimatedHostComponent>;
  let host: RecyclingAnimatedHostComponent;
  let dragState: DragStateService;
  let appRef: ApplicationRef;
  /** The animations started, by the item their element rendered when each started */
  let animations: { id: string; animation: { cancel: jest.Mock } }[];
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalAnimate = Element.prototype.animate;
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  const movePlaceholder = (placeholderIndex: number): void => {
    dragState.updateDragPosition({
      cursorPosition: { x: 0, y: 0 },
      activeDroppableId: 'list',
      placeholderId: END_OF_LIST,
      placeholderIndex,
    });
  };

  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    animations = [];
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
      animations.push({ id: this.getAttribute('data-draggable-id') ?? 'P', animation });
      return animation as unknown as Animation;
    } as typeof Element.prototype.animate;

    TestBed.configureTestingModule({ imports: [RecyclingAnimatedHostComponent] });
    fixture = TestBed.createComponent(RecyclingAnimatedHostComponent);
    host = fixture.componentInstance;
    dragState = TestBed.inject(DragStateService);
    appRef = TestBed.inject(ApplicationRef);
    fixture.detectChanges();
    appRef.tick();

    // Drag item-0 within the list; the placeholder starts in its own slot
    dragState.startDrag(
      {
        draggableId: 'item-0',
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
  });

  afterEach(() => {
    dragState.endDrag();
    fixture.destroy();
    globalThis.ResizeObserver = originalResizeObserver;
    Element.prototype.animate = originalAnimate;
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('does not slide a recycled row from where the item it rendered before was', () => {
    // item-1 leaves and a new item comes in, in the render that moves the placeholder: the view
    // of item-1 renders the new item, at the end of the list
    const [item0, , ...rest] = host.items();
    host.items.set([item0, ...rest, { id: 'item-new', name: 'New' }]);
    movePlaceholder(3);
    appRef.tick();

    const animated = animations.map(({ id }) => id);
    expect(animated).not.toContain('item-new');
    // The rows that did move still slide
    expect(animated).toContain('item-2');
  });

  it('cancels the shift animation of a row whose view is pooled', () => {
    // The placeholder moves from before item-1 to before item-3: item-1 slides up
    movePlaceholder(3);
    appRef.tick();
    const slide = animations.find(({ id }) => id === 'item-1')?.animation;
    expect(slide?.cancel).not.toHaveBeenCalled();

    // item-1 leaves the list: its view waits in the pool, to render another item later
    host.items.set(host.items().filter((item) => item.id !== 'item-1'));
    appRef.tick();

    expect(slide?.cancel).toHaveBeenCalled();
  });

  it('shows again a row the drop animation hides when its view is pooled', () => {
    const row = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-draggable-id="item-1"]',
    )!;
    new DropAnimator({ dropDuration: 200 }).play(
      document.createElement('div'),
      { element: row, rect: row.getBoundingClientRect() },
      () => undefined,
    );
    const hide = animations.at(-1)!;
    expect(hide.id).toBe('item-1');
    expect(hide.animation.cancel).not.toHaveBeenCalled();

    // item-1 leaves the list: its view is pooled, to render another item that must not stay hidden
    host.items.set(host.items().filter((item) => item.id !== 'item-1'));
    appRef.tick();

    expect(hide.animation.cancel).toHaveBeenCalled();
  });
});
