/**
 * Whether an animator may play its animations: one per animator, shared by the shift and the
 * drop animation so both follow the same rules.
 * @internal
 */
export class MotionPreference {
  /** The reduced-motion media query, created on first use (null without `matchMedia`) */
  #reducedMotionQuery: MediaQueryList | null | undefined;

  /**
   * Whether an animation of `duration` ms would play right now: it has a duration, the Web
   * Animations API exists (it does not on the server) and the user has not asked for reduced
   * motion.
   */
  allows(duration: number): boolean {
    if (duration <= 0) return false;
    if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') {
      return false;
    }
    return !this.#prefersReducedMotion();
  }

  /** One media query for every check: it is live, so it follows a change of the preference. */
  #prefersReducedMotion(): boolean {
    if (this.#reducedMotionQuery === undefined) {
      this.#reducedMotionQuery =
        typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    }
    return this.#reducedMotionQuery?.matches ?? false;
  }
}
