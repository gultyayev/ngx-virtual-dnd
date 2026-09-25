import { inject, Injectable, signal } from '@angular/core';
import { VDND_ANIMATION_CONFIG, VdndAnimationConfig } from 'ngx-virtual-dnd';

/** Shift animation duration used when the demo toggle is switched on. */
export const DEMO_SHIFT_DURATION = 200;

/** Drop animation duration used when the demo toggle is switched on. */
export const DEMO_DROP_DURATION = 200;

/**
 * Demo-wide shift and drop animation durations (0 = off).
 * Initialized from the `?shiftAnimation=<ms>` and `?dropAnimation=<ms>` query params so every
 * demo page can opt in.
 */
@Injectable({ providedIn: 'root' })
export class DemoAnimationSettings {
  readonly shiftDuration = signal(readDurationParam('shiftAnimation'));
  readonly dropDuration = signal(readDurationParam('dropAnimation'));
}

function readDurationParam(name: string): number {
  if (typeof location === 'undefined') return 0;
  const value = Number(new URLSearchParams(location.search).get(name));
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
        get dropDuration() {
          return settings.dropDuration();
        },
      };
    },
  };
}
