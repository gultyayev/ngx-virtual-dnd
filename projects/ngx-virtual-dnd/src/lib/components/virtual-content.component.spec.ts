import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { VirtualContentComponent } from './virtual-content.component';
import { ContentHeaderDirective } from '../directives/content-header.directive';
import { VDND_SCROLL_CONTAINER, VdndScrollContainer } from '../tokens/scroll-container.token';

// Mock ResizeObserver for JSDOM — captures callback so tests can simulate resize events
let lastResizeCallback: ResizeObserverCallback | null = null;

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    lastResizeCallback = callback;
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

  describe('ResizeObserver updates', () => {
    let fixture: ComponentFixture<TestHostWithHeaderComponent>;

    beforeEach(() => {
      lastResizeCallback = null;

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

    it('should update effectiveContentOffset when header resizes', () => {
      const virtualContent = fixture.debugElement.query(By.directive(VirtualContentComponent));
      const headerEl = (virtualContent.nativeElement as HTMLElement).querySelector(
        '[vdndcontentheader]',
      ) as HTMLElement;

      expect(headerEl).not.toBeNull();
      expect(lastResizeCallback).not.toBeNull();

      // Simulate a ResizeObserver callback with a new height
      lastResizeCallback!(
        [
          {
            target: headerEl,
            borderBoxSize: [{ blockSize: 150, inlineSize: 0 }],
          } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );

      fixture.detectChanges();
      fixture.detectChanges();

      expect(virtualContent.nativeElement.getAttribute('data-content-offset')).toBe('150');
    });
  });
});
