import { ThemeContext } from '@rspress/core/runtime';
import { type MouseEvent, useContext, useEffect, useState } from 'react';
import { NightIconMoon, NightIconSun } from './icons';
// The replaced component's styles: its sizing and the view-transition rules for the switch.
import '@rspress/core/dist/theme/components/SwitchAppearance/global.css';
import '@rspress/core/dist/theme/components/SwitchAppearance/index.css';

/** Night's dur-settle and ease-out: the theme switch. */
const REVEAL_MS = 360;
const REVEAL_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** A view transition skipped by a newer one rejects its promises; there is nothing to do. */
// eslint-disable-next-line @typescript-eslint/no-empty-function
const ignoreSkipped = (): void => {};

/** A circle growing from (x, y) until it covers the viewport. */
function revealClipPath(x: number, y: number): [string, string] {
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  return [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`];
}

/**
 * Rspress's theme switch as a button: Rspress renders a clickable div, which the keyboard cannot
 * reach. The label names the theme it switches to; the icon shows it (a moon in light, a sun in
 * dark, see index.css). The switch plays a circular reveal on a view transition of the root
 * (Rspress's own reveal, which Rspress plays only with `enableAppearanceAnimation`) from the
 * pointer (from the button's center for a key press), in Night's dur-settle; under reduced
 * motion, or without view transitions, the theme changes at once.
 */
export function SwitchAppearance({ onClick }: { onClick?: () => void }) {
  const { theme, setTheme } = useContext(ThemeContext);
  const next = theme === 'dark' ? 'light' : 'dark';
  // The server renders the light theme, and hydration keeps a server-rendered attribute even when
  // the client's differs (a dark system theme): the label names a theme once mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const toggle = (event: MouseEvent<HTMLButtonElement>): void => {
    const apply = (): void => {
      setTheme?.(next);
      onClick?.();
    };
    const animate =
      typeof document.startViewTransition === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate) {
      apply();
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const fromPointer = event.detail > 0;
    const x = fromPointer ? event.clientX : box.left + box.width / 2;
    const y = fromPointer ? event.clientY : box.top + box.height / 2;
    const root = document.documentElement;
    // global.css: while this class is set, the doc content is part of the root's snapshot.
    root.classList.add('rp-appearance-transition');
    // setTheme switches the root's theme class at once, so the new snapshot is the new theme.
    const transition = document.startViewTransition(apply);
    const clipPath = revealClipPath(x, y);
    // Into dark, the old (light) page shrinks away; into light, the new one grows. A switch
    // started before this one is ready skips it (its ready promise rejects): nothing to reveal.
    transition.ready.then(() => {
      root.animate(
        { clipPath: next === 'dark' ? [...clipPath].reverse() : clipPath },
        {
          duration: REVEAL_MS,
          easing: REVEAL_EASING,
          fill: 'both',
          pseudoElement:
            next === 'dark' ? '::view-transition-old(root)' : '::view-transition-new(root)',
        },
      );
    }, ignoreSkipped);
    const done = (): void => root.classList.remove('rp-appearance-transition');
    transition.finished.then(done, done);
  };

  return (
    <button
      type="button"
      className="rp-switch-appearance"
      aria-label={mounted ? `Switch to the ${next} theme` : 'Switch theme'}
      onClick={toggle}
    >
      <NightIconSun className="rp-switch-appearance__icon rp-switch-appearance__icon--sun" />
      <NightIconMoon className="rp-switch-appearance__icon rp-switch-appearance__icon--moon" />
    </button>
  );
}
