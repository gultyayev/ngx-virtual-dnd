import { type Locator } from '@playwright/test';

export type TouchEventType = 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel';

/**
 * Dispatch a one-finger touch event of `type` at (clientX, clientY) on the element `locator`
 * matches. Returns whether a listener called `preventDefault()`.
 */
export async function dispatchTouch(
  locator: Locator,
  type: TouchEventType,
  clientX: number,
  clientY: number,
): Promise<boolean> {
  return locator.evaluate(
    (el, payload) => {
      const { type, clientX, clientY } = payload;

      const touch = {
        identifier: 1,
        target: el,
        clientX,
        clientY,
        pageX: clientX,
        pageY: clientY,
        screenX: clientX,
        screenY: clientY,
      };

      const touches = type === 'touchend' ? [] : [touch];
      const changedTouches = [touch];

      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches, configurable: true });
      Object.defineProperty(event, 'targetTouches', { value: touches, configurable: true });
      Object.defineProperty(event, 'changedTouches', { value: changedTouches, configurable: true });

      el.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { type, clientX, clientY },
  );
}
