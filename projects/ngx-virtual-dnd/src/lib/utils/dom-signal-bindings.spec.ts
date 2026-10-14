import { NgZone, signal } from '@angular/core';
import {
  bindRafThrottledScrollTopSignal,
  bindResizeObserverHeightSignal,
} from './dom-signal-bindings';

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

describe('DOM signal bindings', () => {
  const ngZone = { runOutsideAngular: <T>(fn: () => T): T => fn() } as unknown as NgZone;
  let originalResizeObserver: typeof ResizeObserver;
  let element: HTMLElement;
  let offset: number;
  let frameCallbacks: FrameRequestCallback[];

  beforeAll(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  beforeEach(() => {
    lastResizeCallback = null;
    offset = 0;
    element = document.createElement('div');
    // jsdom has no layout: scrollTop reads whatever the test last scrolled to
    Object.defineProperty(element, 'scrollTop', { get: () => offset, configurable: true });
    frameCallbacks = [];
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => frameCallbacks.push(callback));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** A resize the observer reports for the element. */
  function resize(height: number): void {
    lastResizeCallback?.(
      [{ target: element, contentRect: { height } } as unknown as ResizeObserverEntry],
      {} as ResizeObserver,
    );
  }

  /** Scroll the element and run the animation frame that follows. */
  function scrollTo(top: number): void {
    offset = top;
    element.dispatchEvent(new Event('scroll'));
    const callbacks = frameCallbacks;
    frameCallbacks = [];
    callbacks.forEach((callback) => callback(0));
  }

  describe('bindResizeObserverHeightSignal', () => {
    it('should re-read the scroll offset on a resize', () => {
      // A re-attached element is back at the top, and the browser fires no scroll event
      const height = signal(0);
      const scrollTop = signal(1000);
      offset = 1000;
      bindResizeObserverHeightSignal({ element, ngZone, height, scrollTop });

      offset = 0;
      resize(300);

      expect(scrollTop()).toBe(0);
    });

    it('should pick up an offset restored without a scroll event', () => {
      // The element read 0 while hidden; shown again, the browser restored its offset silently
      const height = signal(0);
      const scrollTop = signal(0);
      bindResizeObserverHeightSignal({ element, ngZone, height, scrollTop });

      offset = 1200;
      resize(300);

      expect(scrollTop()).toBe(1200);
      expect(height()).toBe(300);
    });

    it('should not touch a scroll offset it was not given', () => {
      const height = signal(0);
      const scrollTop = signal(500);
      bindResizeObserverHeightSignal({ element, ngZone, height });

      offset = 0;
      resize(300);

      expect(scrollTop()).toBe(500);
      expect(height()).toBe(300);
    });
  });

  describe('bindRafThrottledScrollTopSignal', () => {
    it('should commit a scroll of at least the threshold', () => {
      const scrollTop = signal(-1);
      bindRafThrottledScrollTopSignal({ element, ngZone, scrollTop });

      scrollTo(400);

      expect(scrollTop()).toBe(400);
    });

    it('should not commit a scroll below the threshold', () => {
      const scrollTop = signal(-1);
      bindRafThrottledScrollTopSignal({ element, ngZone, scrollTop });

      scrollTo(3);

      expect(scrollTop()).toBe(0);
    });

    it('should measure the threshold from the signal when it was set elsewhere', () => {
      const scrollTop = signal(-1);
      bindRafThrottledScrollTopSignal({ element, ngZone, scrollTop });
      scrollTo(1000);

      // A resize re-read the offset of a re-attached element (back at the top)
      scrollTop.set(0);
      scrollTo(1002);

      expect(scrollTop()).toBe(1002);
    });
  });
});
