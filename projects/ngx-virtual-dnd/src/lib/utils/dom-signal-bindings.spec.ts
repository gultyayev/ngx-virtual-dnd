import { NgZone, signal } from '@angular/core';
import { bindScrollTopSignal, bindResizeObserverHeightSignal } from './dom-signal-bindings';

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
  let shownHeight: number;

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
    shownHeight = 0;
    element = document.createElement('div');
    // jsdom has no layout: scrollTop reads whatever the test last scrolled to, and clientHeight
    // the height the last resize gave the element
    Object.defineProperty(element, 'scrollTop', { get: () => offset, configurable: true });
    Object.defineProperty(element, 'clientHeight', { get: () => shownHeight, configurable: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * A resize the observer reports for the element: it now shows `height` px (its padding box,
   * `clientHeight`), `padding` px of which are its vertical padding (the observer reports the
   * content box, without them).
   */
  function resize(height: number, padding = 0): void {
    shownHeight = height;
    lastResizeCallback?.(
      [
        {
          target: element,
          contentRect: { height: height - padding },
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    );
  }

  /** Scroll the element as a browser does: move it, then dispatch its scroll event. */
  function scrollTo(top: number): void {
    offset = top;
    element.dispatchEvent(new Event('scroll'));
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

    it('should measure the height the element shows, its vertical padding included', () => {
      // Rows scroll through the padding of a scroll container too: a height without it renders
      // too few of them
      const height = signal(0);
      bindResizeObserverHeightSignal({ element, ngZone, height });

      resize(300, 180);

      expect(height()).toBe(300);
    });

    it('should commit a new height in the observer callback', () => {
      // The observer reports after layout, before paint: what onCommit renders shows in that frame
      const height = signal(0);
      const onCommit = jest.fn(() => expect(height()).toBe(700));
      offset = 0;
      bindResizeObserverHeightSignal({ element, ngZone, height, onCommit });

      resize(700);

      expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it('should commit a scroll offset restored without a scroll event', () => {
      const height = signal(300);
      const scrollTop = signal(0);
      const onCommit = jest.fn(() => expect(scrollTop()).toBe(1200));
      bindResizeObserverHeightSignal({ element, ngZone, height, scrollTop, onCommit });
      height.set(300);

      offset = 1200;
      resize(300);

      expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it('should not commit a resize that changes neither the height nor the scroll offset', () => {
      const height = signal(0);
      const scrollTop = signal(0);
      const onCommit = jest.fn();
      bindResizeObserverHeightSignal({ element, ngZone, height, scrollTop, onCommit });
      resize(300);
      onCommit.mockClear();

      // A width change, or a height change within the tolerance
      resize(300.5);

      expect(onCommit).not.toHaveBeenCalled();
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

  describe('bindScrollTopSignal', () => {
    it('should commit a scroll of at least the threshold in its scroll event', () => {
      // The frame that dispatches the event paints the position: rows rendered for it any later
      // leave that frame blank where the scroll moved past them
      const requestFrame = jest.spyOn(window, 'requestAnimationFrame');
      const scrollTop = signal(-1);
      const onCommit = jest.fn();
      bindScrollTopSignal({ element, ngZone, scrollTop, onCommit });

      scrollTo(400);

      expect(scrollTop()).toBe(400);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(400);
      expect(requestFrame).not.toHaveBeenCalled();
    });

    it('should hand onCommit the committed position, already in the signal', () => {
      const scrollTop = signal(-1);
      let committed: number | null = null;
      bindScrollTopSignal({
        element,
        ngZone,
        scrollTop,
        onCommit: () => (committed = scrollTop()),
      });

      scrollTo(400);

      expect(committed).toBe(400);
    });

    it('should not commit a scroll below the threshold', () => {
      const scrollTop = signal(-1);
      const onCommit = jest.fn();
      bindScrollTopSignal({ element, ngZone, scrollTop, onCommit });

      scrollTo(3);

      expect(scrollTop()).toBe(0);
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('should stop committing once cleaned up', () => {
      const scrollTop = signal(-1);
      const onCommit = jest.fn();
      const cleanup = bindScrollTopSignal({ element, ngZone, scrollTop, onCommit });

      cleanup();
      scrollTo(400);

      expect(scrollTop()).toBe(0);
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('should measure the threshold from the signal when it was set elsewhere', () => {
      const scrollTop = signal(-1);
      bindScrollTopSignal({ element, ngZone, scrollTop });
      scrollTo(1000);

      // A resize re-read the offset of a re-attached element (back at the top)
      scrollTop.set(0);
      scrollTo(1002);

      expect(scrollTop()).toBe(1002);
    });
  });
});
