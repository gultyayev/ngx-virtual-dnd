import { InjectionToken } from '@angular/core';

/**
 * Animation settings for drag-and-drop lists.
 */
export interface VdndAnimationConfig {
  /**
   * Duration (ms) of the slide animation played when items are displaced by the
   * placeholder during a drag. `0` disables the animation.
   * @default 200
   */
  shiftDuration?: number;

  /**
   * CSS easing function for the shift animation.
   * @default 'cubic-bezier(0.2, 0, 0, 1)'
   */
  shiftEasing?: string;
}

/** Default shift animation duration (ms) used when the config omits `shiftDuration`. */
export const DEFAULT_SHIFT_DURATION = 200;

/** Default shift animation easing used when the config omits `shiftEasing`. */
export const DEFAULT_SHIFT_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Opt-in animation configuration. When provided, items displaced by the placeholder
 * slide into their new position instead of jumping. Resolved through the element
 * injector, so it can be provided app-wide or per component subtree.
 *
 * The animation is skipped when the user prefers reduced motion. Values are read each
 * time an animation starts, so getters can toggle the animation at runtime.
 *
 * @example
 * ```typescript
 * providers: [{ provide: VDND_ANIMATION_CONFIG, useValue: { shiftDuration: 200 } }]
 * ```
 */
export const VDND_ANIMATION_CONFIG = new InjectionToken<VdndAnimationConfig>(
  'VDND_ANIMATION_CONFIG',
);
