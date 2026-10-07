import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ScrollableDirective } from './scrollable.directive';
import { AutoScrollConfig, AutoScrollService } from '../services/auto-scroll.service';
import { DragIndexCalculatorService } from '../services/drag-index-calculator.service';
import { DroppableRegistryService } from '../services/droppable-registry.service';
import { KeyboardDragService } from '../services/keyboard-drag.service';
import { FixedHeightStrategy } from '../strategies/fixed-height.strategy';

class MockResizeObserver {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}

const nextAnimationFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Lay out `element` like a browser would: scrollTop clamps to the scrollable range, and
 * scrollTo() moves it and fires a scroll event (jsdom has no layout and no Element.scrollTo).
 */
function emulateScrollableLayout(element: HTMLElement, scrollHeight: number, clientHeight: number) {
  const maxScroll = scrollHeight - clientHeight;
  let scrollTop = 0;
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.max(0, Math.min(value, maxScroll));
    },
  });
  element.scrollTo = ((options: ScrollToOptions) => {
    element.scrollTop = options.top ?? scrollTop;
    element.dispatchEvent(new Event('scroll'));
  }) as typeof element.scrollTo;
}

@Component({
  template: `
    <div
      vdndScrollable
      [scrollContainerId]="scrollContainerId()"
      [autoScrollEnabled]="autoScrollEnabled()"
      [autoScrollConfig]="autoScrollConfig()"
      [scrollInsetTop]="scrollInsetTop()"
      [scrollInsetBottom]="scrollInsetBottom()"
    >
      Content
    </div>
  `,
  imports: [ScrollableDirective],
})
class TestHostComponent {
  scrollContainerId = signal<string | undefined>('scrollable-container');
  autoScrollEnabled = signal(false);
  autoScrollConfig = signal<Partial<AutoScrollConfig>>({});
  scrollInsetTop = signal(0);
  scrollInsetBottom = signal(0);
}

describe('ScrollableDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let hostComponent: TestHostComponent;
  let scrollableEl: HTMLElement;
  let scrollable: ScrollableDirective;
  let autoScrollService: AutoScrollService;
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
      imports: [TestHostComponent],
      providers: [provideZonelessChangeDetection()],
    });

    fixture = TestBed.createComponent(TestHostComponent);
    hostComponent = fixture.componentInstance;
    fixture.detectChanges();

    const scrollableDebug = fixture.debugElement.query(By.directive(ScrollableDirective));
    scrollableEl = scrollableDebug.nativeElement as HTMLElement;
    scrollable = scrollableDebug.injector.get(ScrollableDirective);
    autoScrollService = TestBed.inject(AutoScrollService);
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should register when autoScrollEnabled changes to true after init', () => {
    const registerSpy = jest.spyOn(autoScrollService, 'registerContainer');
    registerSpy.mockClear();

    hostComponent.autoScrollConfig.set({ threshold: 75 });
    hostComponent.autoScrollEnabled.set(true);
    fixture.detectChanges();

    expect(registerSpy).toHaveBeenCalledWith('scrollable-container', scrollableEl, {
      threshold: 75,
    });
  });

  it('should re-register when scroll ID changes', () => {
    const registerSpy = jest.spyOn(autoScrollService, 'registerContainer');
    const unregisterSpy = jest.spyOn(autoScrollService, 'unregisterContainer');

    hostComponent.autoScrollEnabled.set(true);
    fixture.detectChanges();
    registerSpy.mockClear();
    unregisterSpy.mockClear();

    hostComponent.scrollContainerId.set('updated-scrollable-container');
    fixture.detectChanges();

    expect(unregisterSpy).toHaveBeenCalledWith('scrollable-container');
    expect(registerSpy).toHaveBeenCalledWith('updated-scrollable-container', scrollableEl, {});
  });
  describe('scroll insets', () => {
    it('should not mark the element while nothing covers its edges', () => {
      expect(scrollableEl.hasAttribute('data-scroll-inset-top')).toBe(false);
      expect(scrollableEl.hasAttribute('data-scroll-inset-bottom')).toBe(false);
    });

    it('should mark the element with the space covered at its edges, for the drag to read', () => {
      hostComponent.scrollInsetTop.set(64);
      hostComponent.scrollInsetBottom.set(48.5);
      fixture.detectChanges();

      expect(scrollableEl.getAttribute('data-scroll-inset-top')).toBe('64');
      expect(scrollableEl.getAttribute('data-scroll-inset-bottom')).toBe('48.5');
    });

    it('should remove the mark when the space goes back to 0', () => {
      hostComponent.scrollInsetTop.set(64);
      fixture.detectChanges();
      hostComponent.scrollInsetTop.set(0);
      fixture.detectChanges();

      expect(scrollableEl.hasAttribute('data-scroll-inset-top')).toBe(false);
    });

    it('should keep a keyboard placeholder in view when the space covered at the top grows', async () => {
      // The element is its own list (as *vdndVirtualFor in it): 100 rows of 50px in 300px
      emulateScrollableLayout(scrollableEl, 5000, 300);
      scrollableEl.getBoundingClientRect = () => new DOMRect(0, 0, 200, 300);
      scrollableEl.setAttribute('data-droppable-id', 'list');
      const unregister = TestBed.inject(DroppableRegistryService).register(
        scrollableEl,
        'list',
        'g',
      );
      const strategy = new FixedHeightStrategy(50);
      strategy.setItemCount(100);
      const indexCalculator = TestBed.inject(DragIndexCalculatorService);
      indexCalculator.registerStrategy('list', strategy);
      const keyboardDrag = TestBed.inject(KeyboardDragService);
      try {
        hostComponent.scrollInsetTop.set(40);
        fixture.detectChanges();
        scrollableEl.scrollTop = 2000;
        const element = document.createElement('div');
        element.getBoundingClientRect = () => new DOMRect(0, 0, 200, 50);
        keyboardDrag.startKeyboardDrag(
          { draggableId: 'row-50', droppableId: 'list', element, height: 50, width: 200 },
          50,
          100,
          'list',
        );
        // Target 10 (above the source): the placeholder before row 10 at [500, 550)
        keyboardDrag.moveToIndex(10);
        await fixture.whenStable();
        expect(scrollableEl.scrollTop).toBe(460);

        // The header grows over the placeholder while the keyboard drag rests
        hostComponent.scrollInsetTop.set(100);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(scrollableEl.scrollTop).toBe(400);
      } finally {
        keyboardDrag.cancelKeyboardDrag();
        indexCalculator.unregisterStrategy('list');
        unregister();
      }
    });
  });

  describe('scrollBy', () => {
    let element: HTMLElement;

    beforeEach(() => {
      element = scrollableEl;
      emulateScrollableLayout(element, 5000, 300);
    });

    it('should add up two calls in one task', () => {
      scrollable.scrollBy(100);
      scrollable.scrollBy(100);

      expect(element.scrollTop).toBe(200);
    });

    it('should add up steps smaller than the scroll signal threshold', async () => {
      for (let i = 0; i < 20; i++) {
        scrollable.scrollBy(2);
        await nextAnimationFrame();
      }

      expect(element.scrollTop).toBe(40);
    });

    it('should start from a small user scroll', async () => {
      element.scrollTop = 3;
      element.dispatchEvent(new Event('scroll'));
      await nextAnimationFrame();

      scrollable.scrollBy(50);

      expect(element.scrollTop).toBe(53);
    });

    it('should start from a scrollTo() in the same task', () => {
      scrollable.scrollTo({ top: 1000 });
      scrollable.scrollBy(50);

      expect(element.scrollTop).toBe(1050);
    });

    it('should clamp to the scrollable range', () => {
      // Assert the requested target: the emulated element clamps too, so its scrollTop can't tell.
      const scrollToSpy = jest.spyOn(element, 'scrollTo');

      scrollable.scrollBy(-100);
      expect(scrollToSpy).toHaveBeenLastCalledWith({ top: 0 });

      scrollable.scrollBy(10_000);
      expect(scrollToSpy).toHaveBeenLastCalledWith({ top: 5000 - 300 });
    });
  });
});
