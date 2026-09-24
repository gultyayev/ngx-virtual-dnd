import { inject, Injectable, signal } from '@angular/core';
import { VDND_ANIMATION_CONFIG, VdndAnimationConfig } from 'ngx-virtual-dnd';

/** Duration used when the demo toggle is switched on. */
export const DEMO_SHIFT_DURATION = 200;

/**
 * Demo-wide shift animation duration (0 = off).
 * Initialized from the `?shiftAnimation=<ms>` query param so every demo page can opt in.
 */
@Injectable({ providedIn: 'root' })
export class DemoAnimationSettings {
  readonly shiftDuration = signal(readDurationParam());
}

function readDurationParam(): number {
  if (typeof location === 'undefined') return 0;
  const value = Number(new URLSearchParams(location.search).get('shiftAnimation'));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Provides VDND_ANIMATION_CONFIG backed by the runtime demo setting. */
export function provideDemoAnimationConfig() {
  return {
    provide: VDND_ANIMATION_CONFIG,
    useFactory: (): VdndAnimationConfig => {
      const settings = inject(DemoAnimationSettings);
      // Config values are read on every animation, so a getter toggles it at runtime.
      return {
        get shiftDuration() {
          return settings.shiftDuration();
        },
      };
    },
  };
}
