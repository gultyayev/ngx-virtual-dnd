import { ApplicationRef, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { VirtualForDirective } from './virtual-for.directive';
import { VirtualViewportComponent } from '../components/virtual-viewport.component';
import { DragStateService } from '../services/drag-state.service';
import { VDND_ANIMATION_CONFIG } from '../tokens/animation-config.token';
import { END_OF_LIST } from '../models/drag-drop.models';

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

describe('VirtualForDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let component: TestHostComponent;
  let originalResizeObserver: typeof ResizeObserver;

  beforeAll(() => {
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    global.ResizeObserver = originalResizeObserver;
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
    });

    fixture = TestBed.createComponent(TestHostComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
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

  it('should not throw when trackBy keys collide', () => {
    component.items.set([
      { id: 'item-1', key: 'a', label: 'A1', parts: ['a'] },
      { id: 'item-2', key: 'b', label: 'B', parts: ['b'] },
      { id: 'item-3', key: 'c', label: 'C', parts: ['c'] },
      { id: 'item-4', key: 'a', label: 'A2', parts: ['a', 'a2'] },
    ]);

    expect(() => fixture.detectChanges()).not.toThrow();
  });

  it('should not throw when replacing the full item list repeatedly', () => {
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

    expect(() => fixture.detectChanges()).not.toThrow();
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

    expect(() => fixture.detectChanges()).not.toThrow();
    expect(fixture.debugElement.queryAll(By.css('.item')).length).toBeGreaterThan(0);
    expect(fixture.debugElement.queryAll(By.css('.part')).length).toBeGreaterThan(0);
  });

  describe('virtual rendering', () => {
    it('should only render visible items plus overscan', () => {
      // 200px viewport / 50px item height = 4 visible items
      // Default overscan = 3, so max rendered = 4 + 3 (below) = 7 for items starting at 0
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: `item-${i}`,
        key: `key-${i}`,
        label: `Item ${i}`,
        parts: [],
      }));
      component.items.set(items);
      fixture.detectChanges();

      const rendered = fixture.debugElement.queryAll(By.css('.item'));
      expect(rendered.length).toBeLessThan(20);
      expect(rendered.length).toBeGreaterThan(0);
    });

    it('should not render all 50 items when only a few fit in the viewport', () => {
      const items = Array.from({ length: 50 }, (_, i) => ({
        id: `item-${i}`,
        key: `key-${i}`,
        label: `Item ${i}`,
        parts: [],
      }));
      component.items.set(items);
      fixture.detectChanges();

      const rendered = fixture.debugElement.queryAll(By.css('.item'));
      // With 200px / 50px = 4 visible + 3 overscan = 7 max
      expect(rendered.length).toBeLessThanOrEqual(10);
      expect(rendered.length).toBeGreaterThanOrEqual(4);
    });

    it('should render all items when list fits entirely in viewport', () => {
      const items = Array.from({ length: 3 }, (_, i) => ({
        id: `item-${i}`,
        key: `key-${i}`,
        label: `Item ${i}`,
        parts: [],
      }));
      component.items.set(items);
      fixture.detectChanges();

      const rendered = fixture.debugElement.queryAll(By.css('.item'));
      expect(rendered.length).toBe(3);
    });

    it('should render zero items for an empty list', () => {
      component.items.set([]);
      fixture.detectChanges();

      const rendered = fixture.debugElement.queryAll(By.css('.item'));
      expect(rendered.length).toBe(0);
    });
  });

  describe('item positioning via viewport wrapper', () => {
    it('should use viewport wrapper transform instead of individual absolute positioning', () => {
      const items = Array.from({ length: 5 }, (_, i) => ({
        id: `item-${i}`,
        key: `key-${i}`,
        label: `Item ${i}`,
        parts: [],
      }));
      component.items.set(items);
      fixture.detectChanges();

      // When inside a VirtualViewportComponent, items are NOT individually positioned.
      // Instead, the viewport's content wrapper uses a single translateY transform.
      const wrapper = fixture.debugElement.query(By.css('.vdnd-viewport-content'));
      expect(wrapper).toBeTruthy();
      const transform = (wrapper.nativeElement as HTMLElement).style.transform;
      expect(transform).toContain('translateY');
    });

    it('should position wrapper at 0 offset when scrolled to top', () => {
      const items = Array.from({ length: 3 }, (_, i) => ({
        id: `item-${i}`,
        key: `key-${i}`,
        label: `Item ${i}`,
        parts: [],
      }));
      component.items.set(items);
      fixture.detectChanges();

      const wrapper = fixture.debugElement.query(By.css('.vdnd-viewport-content'));
      const transform = (wrapper.nativeElement as HTMLElement).style.transform;
      expect(transform).toBe('translateY(0px)');
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

      const beforeCount = fixture.debugElement.queryAll(By.css('.item')).length;

      // Reorder: swap first and last
      component.items.set([
        { id: 'item-3', key: 'c', label: 'C', parts: [] },
        { id: 'item-2', key: 'b', label: 'B', parts: [] },
        { id: 'item-1', key: 'a', label: 'A', parts: [] },
      ]);
      fixture.detectChanges();

      const afterItems = fixture.debugElement.queryAll(By.css('.item'));
      expect(afterItems.length).toBe(beforeCount);

      // Verify reordered content
      expect(afterItems[0].nativeElement.getAttribute('data-id')).toBe('item-3');
      expect(afterItems[1].nativeElement.getAttribute('data-id')).toBe('item-2');
      expect(afterItems[2].nativeElement.getAttribute('data-id')).toBe('item-1');
    });

    it('should update context when item data changes but key remains the same', () => {
      component.items.set([{ id: 'item-1', key: 'a', label: 'Original', parts: [] }]);
      fixture.detectChanges();

      const label = fixture.debugElement.query(By.css('.label'));
      expect(label.nativeElement.textContent.trim()).toBe('Original');

      component.items.set([{ id: 'item-1', key: 'a', label: 'Updated', parts: [] }]);
      fixture.detectChanges();

      const updatedLabel = fixture.debugElement.query(By.css('.label'));
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
      expect(fixture.debugElement.queryAll(By.css('.item')).length).toBe(1);
    });
  });
});

describe('VirtualForDirective (dynamic height)', () => {
  let fixture: ComponentFixture<DynamicHeightTestHostComponent>;
  let component: DynamicHeightTestHostComponent;
  let originalResizeObserver: typeof ResizeObserver;

  beforeAll(() => {
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    global.ResizeObserver = originalResizeObserver;
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

  it('should render items in dynamic height mode without errors', () => {
    component.items.set([
      { id: 'item-1', key: 'a', label: 'Short', height: 30 },
      { id: 'item-2', key: 'b', label: 'Tall', height: 100 },
      { id: 'item-3', key: 'c', label: 'Medium', height: 60 },
    ]);

    expect(() => fixture.detectChanges()).not.toThrow();

    const rendered = fixture.debugElement.queryAll(By.css('.item'));
    expect(rendered.length).toBeGreaterThan(0);
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

    expect(() => fixture.detectChanges()).not.toThrow();
    const rendered = fixture.debugElement.queryAll(By.css('.item'));
    expect(rendered.length).toBe(3);
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
  const originalResizeObserver = global.ResizeObserver;
  const originalAnimate = Element.prototype.animate;
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  const render = (): void => {
    fixture.detectChanges();
    appRef.tick();
  };

  beforeEach(() => {
    global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
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
    global.ResizeObserver = originalResizeObserver;
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

  it('cancels running animations when the drag ends', () => {
    movePlaceholder(3);
    const running = [...animationsByKey.values()].flat();

    dragState.endDrag();
    render();

    expect(running.every((animation) => animation.cancel.mock.calls.length > 0)).toBe(true);
  });
});
