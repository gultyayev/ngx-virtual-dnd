import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { VirtualViewportComponent } from './virtual-viewport.component';
import { AutoScrollConfig, AutoScrollService } from '../services/auto-scroll.service';

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
    <vdnd-virtual-viewport
      [itemHeight]="50"
      [scrollContainerId]="scrollContainerId()"
      [autoScrollEnabled]="autoScrollEnabled()"
      [autoScrollConfig]="autoScrollConfig()"
    />
  `,
  imports: [VirtualViewportComponent],
})
class TestHostComponent {
  scrollContainerId = signal<string | undefined>('viewport-scroll');
  autoScrollEnabled = signal(false);
  autoScrollConfig = signal<Partial<AutoScrollConfig>>({});
}

describe('VirtualViewportComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let hostComponent: TestHostComponent;
  let component: VirtualViewportComponent;
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
    component = fixture.debugElement.query(By.directive(VirtualViewportComponent))
      .componentInstance as VirtualViewportComponent;
    autoScrollService = TestBed.inject(AutoScrollService);
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should mark its host for the drag index calculator', () => {
    const host = component.nativeElement;

    expect(host.hasAttribute('data-virtual-viewport')).toBe(true);
    expect(host.getAttribute('data-content-offset')).toBe('0');
  });

  it('should update fixed-height content transform when excluded index changes', () => {
    component.setRenderStartIndex(10);
    fixture.detectChanges();

    expect(component.contentTransform()).toBe('translateY(500px)');

    component.strategy.setExcludedIndex(2);
    fixture.detectChanges();

    expect(component.contentTransform()).toBe('translateY(450px)');
  });

  it('should register when autoScrollEnabled changes to true after init', () => {
    const registerSpy = jest.spyOn(autoScrollService, 'registerContainer');
    registerSpy.mockClear();

    hostComponent.autoScrollConfig.set({ maxSpeed: 25 });
    hostComponent.autoScrollEnabled.set(true);
    fixture.detectChanges();

    expect(registerSpy).toHaveBeenCalledWith('viewport-scroll', component.nativeElement, {
      maxSpeed: 25,
    });
  });

  it('should re-register when scroll ID changes', () => {
    const registerSpy = jest.spyOn(autoScrollService, 'registerContainer');
    const unregisterSpy = jest.spyOn(autoScrollService, 'unregisterContainer');

    hostComponent.autoScrollEnabled.set(true);
    fixture.detectChanges();
    registerSpy.mockClear();
    unregisterSpy.mockClear();

    hostComponent.scrollContainerId.set('updated-viewport-scroll');
    fixture.detectChanges();

    expect(unregisterSpy).toHaveBeenCalledWith('viewport-scroll');
    expect(registerSpy).toHaveBeenCalledWith(
      'updated-viewport-scroll',
      component.nativeElement,
      {},
    );
  });
  describe('scrollBy', () => {
    let element: HTMLElement;

    beforeEach(() => {
      element = component.nativeElement;
      emulateScrollableLayout(element, 5000, 300);
    });

    it('should add up two calls in one task', () => {
      component.scrollBy(100);
      component.scrollBy(100);

      expect(element.scrollTop).toBe(200);
    });

    it('should add up steps smaller than the scroll signal threshold', async () => {
      for (let i = 0; i < 20; i++) {
        component.scrollBy(2);
        await nextAnimationFrame();
      }

      expect(element.scrollTop).toBe(40);
    });

    it('should start from a small user scroll', async () => {
      element.scrollTop = 3;
      element.dispatchEvent(new Event('scroll'));
      await nextAnimationFrame();

      component.scrollBy(50);

      expect(element.scrollTop).toBe(53);
    });

    it('should start from a scrollTo() in the same task', () => {
      component.scrollTo({ top: 1000 });
      component.scrollBy(50);

      expect(element.scrollTop).toBe(1050);
    });

    it('should clamp to the scrollable range', () => {
      // Assert the requested target: the emulated element clamps too, so its scrollTop can't tell.
      const scrollToSpy = jest.spyOn(element, 'scrollTo');

      component.scrollBy(-100);
      expect(scrollToSpy).toHaveBeenLastCalledWith({ top: 0 });

      component.scrollBy(10_000);
      expect(scrollToSpy).toHaveBeenLastCalledWith({ top: 5000 - 300 });
    });
  });
});
