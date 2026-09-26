/**
 * @jest-environment node
 */
import { NgZone, signal } from '@angular/core';
import { KeyboardDragDeps, KeyboardDragHandler } from './handlers/keyboard-drag.handler';
import { PointerDragDeps, PointerDragHandler } from './handlers/pointer-drag.handler';
import {
  bindRafThrottledScrollTopSignal,
  bindResizeObserverHeightSignal,
} from './utils/dom-signal-bindings';

/**
 * Server rendering has no global `document` or `window` (Angular renders into its own DOCUMENT),
 * and its elements have no layout. This file runs in Node for that reason: the jsdom specs
 * always have both.
 */
describe('Server rendering (no global document)', () => {
  const ngZone = { runOutsideAngular: <T>(fn: () => T): T => fn() } as unknown as NgZone;

  it('runs without a global document', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('should let a pointer drag handler be destroyed', () => {
    const handler = new PointerDragHandler({
      ngZone,
      callbacks: {
        onDragStart: jest.fn(),
        onDragMove: jest.fn(),
        onDragEnd: jest.fn(),
        onPendingChange: jest.fn(),
        isDragging: () => false,
      },
      getContext: jest.fn(),
    } as unknown as PointerDragDeps);

    expect(() => handler.destroy()).not.toThrow();
  });

  it('should let a keyboard drag handler be destroyed', () => {
    const handler = new KeyboardDragHandler({} as KeyboardDragDeps);

    expect(() => handler.destroy()).not.toThrow();
  });

  describe('DOM signal bindings on an element without layout', () => {
    // A server element: it accepts listeners but has no scroll position or size
    const serverElement = (): HTMLElement =>
      ({
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      }) as unknown as HTMLElement;

    it('should read a missing scroll position as 0', () => {
      const scrollTop = signal(-1);

      const cleanup = bindRafThrottledScrollTopSignal({
        element: serverElement(),
        ngZone,
        scrollTop,
      });

      expect(scrollTop()).toBe(0);
      expect(() => cleanup()).not.toThrow();
    });

    it('should read a missing height as 0', () => {
      const height = signal(-1);

      const cleanup = bindResizeObserverHeightSignal({ element: serverElement(), ngZone, height });

      expect(height()).toBe(0);
      expect(() => cleanup()).not.toThrow();
    });
  });
});
