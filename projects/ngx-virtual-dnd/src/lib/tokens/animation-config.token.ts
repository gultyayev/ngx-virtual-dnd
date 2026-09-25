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

  /**
   * Duration (ms) of the drop animation: on drop or cancel, the drag preview glides into
   * the dropped item's final position instead of disappearing. `0` disables it.
   * @default 200
   */
  dropDuration?: number;

  /**
   * CSS easing function for the drop animation.
   * @default 'cubic-bezier(0.2, 0, 0, 1)'
   */
  dropEasing?: string;
}

/** Default shift animation duration (ms) used when the config omits `shiftDuration`. */
export const DEFAULT_SHIFT_DURATION = 200;

/** Default shift animation easing used when the config omits `shiftEasing`. */
export const DEFAULT_SHIFT_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

/** Default drop animation duration (ms) used when the config omits `dropDuration`. */
export const DEFAULT_DROP_DURATION = 200;

/** Default drop animation easing used when the config omits `dropEasing`. */
export const DEFAULT_DROP_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Opt-in animation configuration. When provided, items displaced by the placeholder
 * slide into their new position instead of jumping, and on drop the drag preview glides
 * into the item's final position. Resolved through the element
 * injector, so it can be provided app-wide or per component subtree.
 *
 * Animations are skipped when the user prefers reduced motion. Values are read each
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
