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
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    // Restore original
    global.ResizeObserver = originalResizeObserver;
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

  describe('initialization', () => {
    it('should create the component', () => {
      expect(virtualScrollComponent).toBeTruthy();
    });

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
      // Container is 300px, items are 50px each = 6 visible + 3 overscan each side = max 12 items
      const renderedItems = fixture.debugElement.queryAll(By.css('.item'));

      // With overscan=3, start=0, and visible=6, we should render items 0-9 (10 items)
      expect(renderedItems.length).toBeLessThan(20);
      expect(renderedItems.length).toBeGreaterThan(5);
    });

    it('should render items from the beginning initially', () => {
      const firstItem = fixture.debugElement.query(By.css('.item'));
      expect(firstItem.nativeElement.getAttribute('data-index')).toBe('0');
    });

    it('should update rendered items on scroll', async () => {
      // Scroll to middle of list
      virtualScrollEl.scrollTop = 2000; // Position for item 40
      virtualScrollEl.dispatchEvent(new Event('scroll'));
      await nextAnimationFrame(); // raf-throttled scroll binding
      fixture.detectChanges();
      fixture.detectChanges();

      const items = fixture.debugElement.queryAll(By.css('.item'));
      const indices = items.map((item) =>
        parseInt(item.nativeElement.getAttribute('data-index'), 10),
      );

      // Should include items around index 40
      expect(indices).toContain(40);
    });
  });

  describe('overscan', () => {
    it('should render extra items based on overscan', () => {
      component.overscan.set(5);
      fixture.detectChanges();
      fixture.detectChanges();

      const items = fixture.debugElement.queryAll(By.css('.item'));
      // With overscan=5, we should have more items
      expect(items.length).toBeGreaterThan(6); // At least visible count
    });

    it('should respect overscan=0', () => {
      component.overscan.set(0);
      fixture.detectChanges();
      fixture.detectChanges();

      const items = fixture.debugElement.queryAll(By.css('.item'));
      // Should only render visible items (6 for 300px container with 50px items)
      expect(items.length).toBeLessThanOrEqual(7);
    });
  });

  describe('sticky items', () => {
    it('should always render sticky items even if not in viewport', () => {
      // Make item-0 sticky
      component.stickyItemIds.set(['item-0']);
      fixture.detectChanges();
      fixture.detectChanges();

      // Scroll to bottom
      virtualScrollEl.scrollTop = 4000;
      virtualScrollEl.dispatchEvent(new Event('scroll'));
      fixture.detectChanges();
      fixture.detectChanges();

      // Item 0 should still be rendered
      const items = fixture.debugElement.queryAll(By.css('.item'));
      const indices = items.map((item) =>
        parseInt(item.nativeElement.getAttribute('data-index'), 10),
      );

      expect(indices).toContain(0);
    });

    it('should mark sticky items with isSticky context', () => {
      component.stickyItemIds.set(['item-0']);
      fixture.detectChanges();
      fixture.detectChanges();

      const firstItem = fixture.debugElement.query(By.css('.item[data-index="0"]'));
      expect(firstItem.nativeElement.getAttribute('data-sticky')).toBe('true');
    });
  });

  describe('total height calculation', () => {
    it('should calculate correct total height', () => {
      // 100 items * 50px = 5000px
      expect(virtualScrollComponent.getScrollHeight()).toBe(5000);
    });

    it('should NOT reduce total height when dragging (spacer stays constant)', () => {
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

      // Height stays at 100 items * 50px = 5000px during drag
      // (getTotalHeight no longer excludes dragged item)
      expect(virtualScrollComponent.getScrollHeight()).toBe(5000);

      dragStateService.endDrag();
    });
  });

  describe('content transform', () => {
    it('should have transform at 0 initially', () => {
      const wrapper = fixture.debugElement.query(By.css('.vdnd-virtual-scroll-content-wrapper'));
      expect(wrapper.nativeElement.style.transform).toBe('translateY(0px)');
    });

    it('should update transform when scrolled', async () => {
      virtualScrollEl.scrollTop = 1000;
      virtualScrollEl.dispatchEvent(new Event('scroll'));
      await nextAnimationFrame(); // raf-throttled scroll binding
      fixture.detectChanges();
      fixture.detectChanges();

      const wrapper = fixture.debugElement.query(By.css('.vdnd-virtual-scroll-content-wrapper'));
      const transform = wrapper.nativeElement.style.transform;
      const match = transform.match(/translateY\((\d+)px\)/);
      expect(match).toBeTruthy();
      const offset = parseInt(match![1], 10);
      expect(offset).toBeGreaterThan(0);
    });

    it('should have single spacer with total height', () => {
      const spacer = fixture.debugElement.query(By.css('.vdnd-virtual-scroll-spacer'));
      expect(spacer.nativeElement.style.height).toBe('5000px'); // 100 items * 50px
    });

    it('should NOT reduce spacer height when dragging (stays constant)', () => {
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
      // Height stays at 100 items * 50px = 5000px during drag
      expect(spacer.nativeElement.style.height).toBe('5000px');

      dragStateService.endDrag();
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

    describe('getScrollTop', () => {
      it('should return current scroll position', () => {
        virtualScrollComponent.scrollTo(250);

        expect(virtualScrollComponent.getScrollTop()).toBe(250);
      });
    });

    describe('getScrollHeight', () => {
      it('should return total scrollable height', () => {
        expect(virtualScrollComponent.getScrollHeight()).toBe(5000);
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
    it('should update rendering when container height changes', () => {
      const initialItems = fixture.debugElement.queryAll(By.css('.item')).length;

      component.containerHeight.set(600);
      fixture.detectChanges();
      fixture.detectChanges();

      const newItems = fixture.debugElement.queryAll(By.css('.item')).length;
      // Should render more items with larger container
      expect(newItems).toBeGreaterThanOrEqual(initialItems);
    });
  });

  describe('item template context', () => {
    it('should provide correct context to item template', () => {
      const items = fixture.debugElement.queryAll(By.css('.item'));

      // Check first item
      expect(items[0].nativeElement.getAttribute('data-index')).toBe('0');

      // Check second item
      expect(items[1].nativeElement.getAttribute('data-index')).toBe('1');
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

  describe('drag state integration', () => {
    it('should exclude dragged item from height calculation', () => {
      const item: DraggedItem = {
        draggableId: 'item-50',
        droppableId: 'list',
        element: document.createElement('div'),
        height: 50,
        width: 200,
      };

      const heightBefore = virtualScrollComponent.getScrollHeight();

      dragStateService.startDrag(item);
      fixture.detectChanges();
      fixture.detectChanges();

      const heightDuring = virtualScrollComponent.getScrollHeight();

      // Height should stay the same (getTotalHeight no longer excludes dragged item)
      expect(heightDuring).toBe(heightBefore);

      dragStateService.endDrag();
      fixture.detectChanges();
      fixture.detectChanges();

      // Height stays the same after drag end
      expect(virtualScrollComponent.getScrollHeight()).toBe(heightBefore);
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
