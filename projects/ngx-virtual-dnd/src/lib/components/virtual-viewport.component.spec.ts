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
});
