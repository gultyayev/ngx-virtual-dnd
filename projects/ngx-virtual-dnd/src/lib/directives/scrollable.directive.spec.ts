import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ScrollableDirective } from './scrollable.directive';
import { AutoScrollConfig, AutoScrollService } from '../services/auto-scroll.service';

class MockResizeObserver {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}

@Component({
  template: `
    <div
      vdndScrollable
      [scrollContainerId]="scrollContainerId()"
      [autoScrollEnabled]="autoScrollEnabled()"
      [autoScrollConfig]="autoScrollConfig()"
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
}

describe('ScrollableDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let hostComponent: TestHostComponent;
  let scrollableEl: HTMLElement;
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

    scrollableEl = fixture.debugElement.query(By.directive(ScrollableDirective))
      .nativeElement as HTMLElement;
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
});
