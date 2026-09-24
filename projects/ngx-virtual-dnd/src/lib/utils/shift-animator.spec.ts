import { ApplicationRef, Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ShiftAnimationEntry, ShiftAnimator } from './shift-animator';
import type { VdndAnimationConfig } from '../tokens/animation-config.token';

interface FakeAnimation {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  progress: number | null;
  cancel: jest.Mock;
  effect: { getComputedTiming: () => { progress: number | null } };
  onfinish: (() => void) | null;
}

describe('ShiftAnimator', () => {
  let injector: Injector;
  let appRef: ApplicationRef;
  let tops: Map<HTMLElement, number>;
  let animations: Map<HTMLElement, FakeAnimation[]>;
  let entries: ShiftAnimationEntry[];
  let scrollElement: HTMLElement;
  const originalAnimate = Element.prototype.animate;

  const createElement = (top: number): HTMLElement => {
    const el = document.createElement('div');
    tops.set(el, top);
    el.getBoundingClientRect = () => {
      const running = animations.get(el)?.at(-1);
      // Visual position = layout position + in-flight animation offset
      let offset = 0;
      if (running && running.cancel.mock.calls.length === 0 && running.progress !== null) {
        const from = /translate\([^,]+, ([-\d.]+)px\)/.exec(String(running.keyframes[0].transform));
        offset = Number(from?.[1] ?? 0) * (1 - running.progress);
      }
      const y = (tops.get(el) ?? 0) + offset;
      const hidden = y < 0;
      return {
        top: y,
        left: 0,
        width: hidden ? 0 : 100,
        height: hidden ? 0 : 50,
      } as DOMRect;
    };
    return el;
  };

  const lastAnimation = (el: HTMLElement): FakeAnimation | undefined => animations.get(el)?.at(-1);
  const fromY = (animation: FakeAnimation | undefined): number =>
    Number(/translate\([^,]+, ([-\d.]+)px\)/.exec(String(animation?.keyframes[0].transform))?.[1]);

  const createAnimator = (config: VdndAnimationConfig = { shiftDuration: 200 }): ShiftAnimator =>
    new ShiftAnimator({
      config,
      injector,
      getScrollElement: () => scrollElement,
      getEntries: () => entries,
    });

  /** Render cycle: snapshot, apply layout change, flush afterNextRender. */
  const render = (
    animator: ShiftAnimator,
    isDragging: boolean,
    placeholderIndex: number,
    applyLayout: () => void = () => undefined,
  ): void => {
    animator.beforeUpdate(isDragging, placeholderIndex);
    applyLayout();
    appRef.tick();
  };

  beforeEach(() => {
    tops = new Map();
    animations = new Map();
    entries = [];
    scrollElement = document.createElement('div');
    scrollElement.getBoundingClientRect = () => ({ top: 0, left: 0 }) as DOMRect;

    Element.prototype.animate = function (
      this: HTMLElement,
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions,
    ) {
      const animation: FakeAnimation = {
        keyframes,
        options,
        progress: 0,
        cancel: jest.fn(),
        effect: { getComputedTiming: () => ({ progress: animation.progress }) },
        onfinish: null,
      };
      const list = animations.get(this) ?? [];
      list.push(animation);
      animations.set(this, list);
      return animation as unknown as Animation;
    } as typeof Element.prototype.animate;

    injector = TestBed.inject(Injector);
    appRef = TestBed.inject(ApplicationRef);
  });

  afterEach(() => {
    Element.prototype.animate = originalAnimate;
  });

  it('does not animate the drag start render', () => {
    const a = createElement(0);
    entries = [['a', a]];
    const animator = createAnimator();

    render(animator, true, 1, () => tops.set(a, 50));

    expect(animations.size).toBe(0);
  });

  it('slides displaced items from their previous position', () => {
    const a = createElement(0);
    const b = createElement(50);
    entries = [
      ['a', a],
      ['b', b],
    ];
    const animator = createAnimator({ shiftDuration: 150, shiftEasing: 'linear' });
    render(animator, true, 1);

    // Placeholder moves above b: b is pushed down by one item height
    render(animator, true, 2, () => tops.set(b, 100));

    expect(animations.has(a)).toBe(false);
    const animation = lastAnimation(b);
    expect(fromY(animation)).toBe(-50);
    expect(animation?.keyframes[1].transform).toBe('translate(0px, 0px)');
    expect(animation?.options).toEqual(
      expect.objectContaining({ duration: 150, easing: 'linear', composite: 'add' }),
    );
  });

  it('retargets an in-flight animation from the current visual position', () => {
    const b = createElement(50);
    entries = [['b', b]];
    const animator = createAnimator();
    render(animator, true, 1);
    render(animator, true, 2, () => tops.set(b, 100));
    const first = lastAnimation(b)!;
    first.progress = 0.75; // 25% of the -50px offset remains: visually at 87.5

    // Placeholder moves back: b returns to 50
    render(animator, true, 1, () => tops.set(b, 50));

    expect(first.cancel).toHaveBeenCalled();
    // From the current visual spot (87.5) relative to the new layout (50)
    expect(fromY(lastAnimation(b))).toBe(37.5);
  });

  it('leaves a running animation alone when its target did not change', () => {
    const a = createElement(0);
    const b = createElement(50);
    entries = [
      ['a', a],
      ['b', b],
    ];
    const animator = createAnimator();
    render(animator, true, 5);
    render(animator, true, 1, () => tops.set(a, 50));
    const running = lastAnimation(a)!;
    running.progress = 0.5;

    render(animator, true, 2, () => tops.set(b, 100));

    expect(running.cancel).not.toHaveBeenCalled();
    expect(animations.get(a)?.length).toBe(1);
    expect(fromY(lastAnimation(b))).toBe(-50);
  });

  it('ignores scroll offset changes between the two measurements', () => {
    const b = createElement(50);
    entries = [['b', b]];
    const animator = createAnimator();
    render(animator, true, 1);

    render(animator, true, 2, () => {
      // Programmatic scroll by 40px in the same tick moves everything up visually
      scrollElement.scrollTop = 40;
      scrollElement.getBoundingClientRect = () => ({ top: 0, left: 0 }) as DOMRect;
      tops.set(b, 100 - 40);
    });

    expect(fromY(lastAnimation(b))).toBe(-50);
  });

  it('cancels instead of animating an element recycled for another item', () => {
    const el = createElement(50);
    entries = [['b', el]];
    const animator = createAnimator();
    render(animator, true, 1);
    render(animator, true, 2, () => tops.set(el, 100));
    const running = lastAnimation(el)!;

    render(animator, true, 3, () => {
      entries = [['z', el]];
      tops.set(el, 300);
    });

    expect(running.cancel).toHaveBeenCalled();
    expect(animations.get(el)?.length).toBe(1);
  });

  it('skips hidden elements such as the dragged item', () => {
    const hidden = createElement(-1);
    entries = [['dragged', hidden]];
    const animator = createAnimator();
    render(animator, true, 1);

    render(animator, true, 2, () => tops.set(hidden, 100));

    expect(animations.has(hidden)).toBe(false);
  });

  it('cancels running animations when the drag ends', () => {
    const b = createElement(50);
    entries = [['b', b]];
    const animator = createAnimator();
    render(animator, true, 1);
    render(animator, true, 2, () => tops.set(b, 100));
    const running = lastAnimation(b)!;

    render(animator, false, -1, () => tops.set(b, 0));

    expect(running.cancel).toHaveBeenCalled();
    expect(animations.get(b)?.length).toBe(1);
  });

  it('does nothing when the duration is 0', () => {
    const b = createElement(50);
    entries = [['b', b]];
    const animator = createAnimator({ shiftDuration: 0 });
    render(animator, true, 1);

    render(animator, true, 2, () => tops.set(b, 100));

    expect(animations.size).toBe(0);
  });

  it('respects prefers-reduced-motion', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = jest.fn().mockReturnValue({ matches: true });
    try {
      const b = createElement(50);
      entries = [['b', b]];
      const animator = createAnimator();
      render(animator, true, 1);

      render(animator, true, 2, () => tops.set(b, 100));

      expect(animations.size).toBe(0);
      expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('measures the "before" state once when several updates land in the same render', () => {
    const b = createElement(50);
    entries = [['b', b]];
    const animator = createAnimator();
    render(animator, true, 1);

    animator.beforeUpdate(true, 2);
    tops.set(b, 100);
    animator.beforeUpdate(true, 3);
    tops.set(b, 150);
    appRef.tick();

    expect(animations.get(b)?.length).toBe(1);
    expect(fromY(lastAnimation(b))).toBe(-100);
  });
});
