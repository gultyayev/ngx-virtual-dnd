import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { VirtualContentComponent } from './virtual-content.component';
import { ContentHeaderDirective } from '../directives/content-header.directive';
import { VDND_SCROLL_CONTAINER, VdndScrollContainer } from '../tokens/scroll-container.token';

// Mock ResizeObserver for JSDOM — captures callback so tests can simulate resize events
let lastResizeCallback: ResizeObserverCallback | null = null;
let lastObserver: MockResizeObserver | null = null;

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    lastResizeCallback = callback;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastObserver = this;
  }

  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}

@Component({
  template: `
    <vdnd-virtual-content [itemHeight]="50">
      <ng-content />
    </vdnd-virtual-content>
  `,
  imports: [VirtualContentComponent],
  providers: [{ provide: VDND_SCROLL_CONTAINER, useExisting: TestHostComponent }],
})
class TestHostComponent implements VdndScrollContainer {
  scrollTop = signal(0);
  containerHeight = signal(500);
  nativeElement = document.createElement('div');

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  scrollTo(): void {}
}

@Component({
  template: `
    <vdnd-virtual-content [itemHeight]="50">
      <div vdndContentHeader style="height: 100px;">Header</div>
    </vdnd-virtual-content>
  `,
  imports: [VirtualContentComponent, ContentHeaderDirective],
  providers: [{ provide: VDND_SCROLL_CONTAINER, useExisting: TestHostWithHeaderComponent }],
})
class TestHostWithHeaderComponent implements VdndScrollContainer {
  scrollTop = signal(0);
  containerHeight = signal(500);
  nativeElement = document.createElement('div');

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  scrollTo(): void {}
}

@Component({
  template: `
    <vdnd-virtual-content [itemHeight]="50" [contentOffset]="42">
      @if (showHeader()) {
        <div vdndContentHeader>Header</div>
      }
    </vdnd-virtual-content>
  `,
  imports: [VirtualContentComponent, ContentHeaderDirective],
  providers: [
    { provide: VDND_SCROLL_CONTAINER, useExisting: TestHostWithRemovableHeaderComponent },
  ],
})
class TestHostWithRemovableHeaderComponent implements VdndScrollContainer {
  showHeader = signal(true);
  scrollTop = signal(0);
  containerHeight = signal(500);
  nativeElement = document.createElement('div');

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  scrollTo(): void {}
}

@Component({
  template: ` <vdnd-virtual-content [itemHeight]="50" [contentOffset]="42" /> `,
  imports: [VirtualContentComponent],
  providers: [{ provide: VDND_SCROLL_CONTAINER, useExisting: TestHostWithManualOffsetComponent }],
})
class TestHostWithManualOffsetComponent implements VdndScrollContainer {
  scrollTop = signal(0);
  containerHeight = signal(500);
  nativeElement = document.createElement('div');
  scrollTo = jest.fn();
}

describe('VirtualContentComponent', () => {
  let originalResizeObserver: typeof ResizeObserver;

  beforeAll(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  describe('no header projected', () => {
    let fixture: ComponentFixture<TestHostComponent>;

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [TestHostComponent],
        providers: [provideZonelessChangeDetection()],
      });

      fixture = TestBed.createComponent(TestHostComponent);
      fixture.detectChanges();
      fixture.detectChanges();
    });

    afterEach(() => {
      fixture.destroy();
    });

    it('should have effectiveContentOffset of 0', () => {
      const virtualContent = fixture.debugElement.query(By.directive(VirtualContentComponent));
      expect(virtualContent.nativeElement.getAttribute('data-content-offset')).toBe('0');
    });

    it('should update fixed-height content transform when excluded index changes', () => {
      const virtualContent = fixture.debugElement.query(By.directive(VirtualContentComponent))
        .componentInstance as VirtualContentComponent;

      virtualContent.setRenderStartIndex(10);
      fixture.detectChanges();

      expect(virtualContent.contentTransform()).toBe('translateY(500px)');

      virtualContent.strategy.setExcludedIndex(2);
      fixture.detectChanges();

      expect(virtualContent.contentTransform()).toBe('translateY(450px)');
    });
  });

  describe('contentOffset input without header projection', () => {
    let fixture: ComponentFixture<TestHostWithManualOffsetComponent>;

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [TestHostWithManualOffsetComponent],
        providers: [provideZonelessChangeDetection()],
      });

      fixture = TestBed.createComponent(TestHostWithManualOffsetComponent);
      fixture.detectChanges();
      fixture.detectChanges();
    });

    afterEach(() => {
      fixture.destroy();
    });

    it('should use contentOffset input when no header is projected', () => {
      const virtualContent = fixture.debugElement.query(By.directive(VirtualContentComponent));
      expect(virtualContent.nativeElement.getAttribute('data-content-offset')).toBe('42');
    });

    it('should report scrollTop relative to the start of the list', () => {
      const virtualContent = fixture.debugElement.query(By.directive(VirtualContentComponent))
        .componentInstance as VirtualContentComponent;

      fixture.componentInstance.scrollTop.set(100);
      expect(virtualContent.scrollTop()).toBe(58);

      // Still inside the content above the list
      fixture.componentInstance.scrollTop.set(30);
      expect(virtualContent.scrollTop()).toBe(0);
    });

    it('should add the offset back when scrolling the parent container', () => {
      const virtualContent = fixture.debugElement.query(By.directive(VirtualContentComponent))
        .componentInstance as VirtualContentComponent;

      virtualContent.scrollTo({ top: 100, behavior: 'smooth' });

      expect(fixture.componentInstance.scrollTo).toHaveBeenCalledWith({
        top: 142,
        behavior: 'smooth',
      });
    });
  });

  describe('header projection', () => {
    let fixture: ComponentFixture<TestHostWithHeaderComponent>;

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [TestHostWithHeaderComponent],
        providers: [provideZonelessChangeDetection()],
      });

      fixture = TestBed.createComponent(TestHostWithHeaderComponent);
      fixture.detectChanges();
      fixture.detectChanges();
    });

    afterEach(() => {
      fixture.destroy();
    });

    it('should render its spacer behind the rows and the rows in their own box', () => {
      const virtualContent = fixture.debugElement.query(By.directive(VirtualContentComponent))
        .nativeElement as HTMLElement;
      const spacer = virtualContent.querySelector('.vdnd-content-spacer');
      const rows = virtualContent.querySelector('.vdnd-content-wrapper');

      expect(spacer?.classList.contains('vdnd-virtual-spacer')).toBe(true);
      expect(rows?.classList.contains('vdnd-virtual-rows')).toBe(true);
      expect(spacer?.nextElementSibling).toBe(rows);
    });

    it('should project header before virtual area', () => {
      const virtualContent = fixture.debugElement.query(By.directive(VirtualContentComponent))
        .nativeElement as HTMLElement;

      const virtualArea = virtualContent.querySelector('.vdnd-virtual-area')!;
      const header = virtualContent.querySelector('[vdndcontentheader]');

      expect(header).not.toBeNull();

      // Header should come before the virtual area in DOM order
      const children = Array.from(virtualContent.children);
      const headerIndex = children.indexOf(header!);
      const virtualAreaIndex = children.indexOf(virtualArea);

      expect(headerIndex).toBeLessThan(virtualAreaIndex);
    });
  });

  describe('space above the header', () => {
    let fixture: ComponentFixture<TestHostWithHeaderComponent>;
    let container: HTMLElement;
    let virtualArea: HTMLElement;
    let virtualContent: HTMLElement;

    /**
     * Lays out the parent scroll container (500px tall, its border box at `containerTop`) and the
     * rows' box (jsdom has no layout). `scale` is a transform on the container, which scales its
     * box on screen but not its layout size.
     */
    function layout(
      containerTop: number,
      rowsTop: number,
      scrollTop: number,
      { borderTop = 0, scale = 1 }: { borderTop?: number; scale?: number } = {},
    ): void {
      container.getBoundingClientRect = () =>
        ({ top: containerTop, height: 500 * scale }) as DOMRect;
      Object.defineProperty(container, 'offsetHeight', { value: 500, configurable: true });
      Object.defineProperty(container, 'clientTop', { value: borderTop, configurable: true });
      Object.defineProperty(container, 'scrollTop', { value: scrollTop, configurable: true });
      virtualArea.getBoundingClientRect = () => ({ top: rowsTop }) as DOMRect;
    }

    /** What the browser reports when the header or the container is laid out or resized. */
    function notifyResize(): void {
      lastResizeCallback!([], {} as ResizeObserver);
      fixture.detectChanges();
    }

    beforeEach(() => {
      lastResizeCallback = null;

      TestBed.configureTestingModule({
        imports: [TestHostWithHeaderComponent],
        providers: [provideZonelessChangeDetection()],
      });

      fixture = TestBed.createComponent(TestHostWithHeaderComponent);
      container = fixture.componentInstance.nativeElement;
      fixture.detectChanges();
      fixture.detectChanges();
      virtualContent = fixture.debugElement.query(By.directive(VirtualContentComponent))
        .nativeElement as HTMLElement;
      virtualArea = virtualContent.querySelector('.vdnd-virtual-area') as HTMLElement;
    });

    afterEach(() => {
      fixture.destroy();
    });

    it('should count padding and borders above the header in the offset', () => {
      // Container at 100; its 24px padding, the list's 1px border and the 80px header put the
      // rows at 205
      layout(100, 205, 0);
      notifyResize();

      expect(virtualContent.getAttribute('data-content-offset')).toBe('105');
    });

    it('should measure the same offset at any scroll position', () => {
      // Scrolled 300px: the rows' box moved up with the content, the offset did not change
      layout(100, -95, 300);
      notifyResize();

      expect(virtualContent.getAttribute('data-content-offset')).toBe('105');
    });

    it("should measure from inside the scroll container's border", () => {
      // A 2px top border: the rows start 103px into the container's content, as contentOffset counts
      layout(100, 205, 0, { borderTop: 2 });
      notifyResize();

      expect(virtualContent.getAttribute('data-content-offset')).toBe('103');
    });

    it('should measure in layout pixels while a transform scales the container', () => {
      // Scaled to 0.8 (a zoom-in animation): the 105px above the rows show as 84px on screen
      layout(100, 184, 0, { scale: 0.8 });
      notifyResize();

      expect(virtualContent.getAttribute('data-content-offset')).toBe('105');
    });

    it('should observe the scroll container as well as the header', () => {
      // The container's width can reflow what sits above the header
      expect(lastObserver!.observe).toHaveBeenCalledWith(container);
      expect(lastObserver!.observe).toHaveBeenCalledWith(
        virtualContent.querySelector('[vdndcontentheader]'),
        { box: 'border-box' },
      );
    });

    it('should measure again when the header resizes', () => {
      layout(100, 205, 0);
      notifyResize();

      layout(100, 255, 0);
      notifyResize();

      expect(virtualContent.getAttribute('data-content-offset')).toBe('155');
    });

    it('should report scrollTop relative to where the rows start', () => {
      layout(100, 205, 0);
      notifyResize();
      const component = fixture.debugElement.query(By.directive(VirtualContentComponent))
        .componentInstance as VirtualContentComponent;

      fixture.componentInstance.scrollTop.set(305);

      expect(component.scrollTop()).toBe(200);
    });
  });

  describe('header removed', () => {
    it('should fall back to the contentOffset input', () => {
      TestBed.configureTestingModule({
        imports: [TestHostWithRemovableHeaderComponent],
        providers: [provideZonelessChangeDetection()],
      });
      const fixture = TestBed.createComponent(TestHostWithRemovableHeaderComponent);
      fixture.detectChanges();
      const virtualContent = fixture.debugElement.query(By.directive(VirtualContentComponent))
        .nativeElement as HTMLElement;

      fixture.componentInstance.showHeader.set(false);
      fixture.detectChanges();
      fixture.detectChanges();

      expect(virtualContent.getAttribute('data-content-offset')).toBe('42');
      fixture.destroy();
    });
  });
});
