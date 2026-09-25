import { Component, signal, TemplateRef, viewChild } from '@angular/core';
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
import { DraggedItem } from '../models/drag-drop.models';

// Mock ResizeObserver for JSDOM
class MockResizeObserver {
  static instances: MockResizeObserver[] = [];

  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();

  constructor() {
    MockResizeObserver.instances.push(this);
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

    <vdnd-virtual-scroll
      [items]="items()"
      [itemHeight]="50"
      [containerHeight]="containerHeight()"
      [overscan]="overscan()"
      [stickyItemIds]="stickyItemIds()"
      [itemIdFn]="itemIdFn"
      [trackByFn]="trackByFn"
      [itemTemplate]="itemTpl"
      [dynamicItemHeight]="dynamicItemHeight()"
      [scrollContainerId]="scrollContainerId()"
      [droppableId]="droppableId()"
      [autoScrollEnabled]="autoScrollEnabled()"
      [autoScrollConfig]="autoScrollConfig()"
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

  readonly itemIdFn = (item: TestItem): string => item.id;
  readonly trackByFn = (_: number, item: TestItem): string => item.id;
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
    it('observes rendered items with selector-sensitive draggable IDs', () => {
      MockResizeObserver.instances.length = 0;
      const unsafeId = 'item-"quoted"\\[one]';
      const dynamicFixture = TestBed.createComponent(TestHostComponent);
      dynamicFixture.componentInstance.items.set([{ id: unsafeId, name: 'Unsafe ID item' }]);
      dynamicFixture.componentInstance.dynamicItemHeight.set(true);

      expect(() => {
        dynamicFixture.detectChanges();
        dynamicFixture.detectChanges();
      }).not.toThrow();

      const itemObserver = MockResizeObserver.instances[0];
      const itemElement = dynamicFixture.nativeElement.querySelector('.item') as HTMLElement | null;

      expect(itemElement?.getAttribute('data-draggable-id')).toBe(unsafeId);
      expect(itemObserver.observe).toHaveBeenCalledWith(itemElement);

      dynamicFixture.destroy();
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
      // It should be strategy.getOffsetForIndex(start)
      // Since item-2 is excluded, offset for 'start' should be (start - 1) * 50
      const wrapper = fixture.debugElement.query(By.css('.vdnd-virtual-scroll-content-wrapper'));
      const expectedOffset = (start - 1) * 50;
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
