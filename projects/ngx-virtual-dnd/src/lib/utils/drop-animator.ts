import {
  DEFAULT_DROP_DURATION,
  DEFAULT_DROP_EASING,
  type VdndAnimationConfig,
} from '../tokens/animation-config.token';
import { queryByAttribute } from './attribute-selectors';

/** Where the ghost should land, and the element that stands there. */
export interface DropAnimationTarget {
  /** The dropped item's rendered element (hidden until the ghost lands) */
  element: HTMLElement;
  /** Its viewport rect */
  rect: DOMRect;
}

/**
 * Plays the drop ("settle") animation: the drag preview glides from where it was released
 * into the dropped item's final position, while that item stays invisible underneath.
 *
 * Purely visual. The drag state and the drop events are already final when it starts, so it
 * never delays or changes a drop. Without a target (the item is not rendered, or scrolled out
 * of view) the ghost fades out where it was released.
 * @internal
 */
export class DropAnimator {
  readonly #config: VdndAnimationConfig;

  #ghostAnimation: Animation | null = null;
  #hideAnimation: Animation | null = null;

  constructor(config: VdndAnimationConfig) {
    this.#config = config;
  }

  /** Whether a drop animation would play right now (duration, WAAPI, reduced motion). */
  isEnabled(): boolean {
    if (this.#duration() <= 0) return false;
    if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') {
      return false;
    }
    if (typeof matchMedia !== 'function') return true;
    return !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Animate `ghost` onto `target` (or fade it out without one), then call `onDone`.
   * `onDone` is not called when the animation is cancelled.
   */
  play(ghost: HTMLElement, target: DropAnimationTarget | null, onDone: () => void): void {
    this.cancel();

    const timing: KeyframeAnimationOptions = {
      duration: this.#duration(),
      easing: this.#config.dropEasing ?? DEFAULT_DROP_EASING,
      fill: 'forwards',
    };

    let ghostAnimation: Animation;
    if (target) {
      const from = ghost.getBoundingClientRect();
      const dx = target.rect.left - from.left;
      const dy = target.rect.top - from.top;
      // Travel on top of the preview's own position transform (width/height must not be
      // composited, so the base transform is repeated instead of using composite: 'add').
      const base = ghost.style.transform;
      ghostAnimation = ghost.animate(
        [
          {
            transform: `${base} translate(0px, 0px)`,
            width: `${from.width}px`,
            height: `${from.height}px`,
          },
          {
            transform: `${base} translate(${dx}px, ${dy}px)`,
            width: `${target.rect.width}px`,
            height: `${target.rect.height}px`,
          },
        ],
        timing,
      );
      // Keep the real item invisible until the ghost lands on it, so it is never seen twice.
      this.#hideAnimation = target.element.animate([{ opacity: 0 }, { opacity: 0 }], {
        duration: timing.duration,
      });
    } else {
      ghostAnimation = ghost.animate([{ opacity: 1 }, { opacity: 0 }], timing);
    }

    this.#ghostAnimation = ghostAnimation;
    ghostAnimation.onfinish = () => {
      if (this.#ghostAnimation !== ghostAnimation) return;
      this.cancel();
      onDone();
    };
  }

  /** Stop the running animation immediately and reveal the real item. */
  cancel(): void {
    const ghostAnimation = this.#ghostAnimation;
    const hideAnimation = this.#hideAnimation;
    this.#ghostAnimation = null;
    this.#hideAnimation = null;
    ghostAnimation?.cancel();
    hideAnimation?.cancel();
  }

  #duration(): number {
    return this.#config.dropDuration ?? DEFAULT_DROP_DURATION;
  }
}

/**
 * Find the rendered element of a dropped item: first in the droppable it was dropped on, then
 * in the one it came from (a drop the consumer rejected or has not committed yet leaves it
 * there). Returns null when it is not rendered, or rendered but scrolled out of its list's view.
 */
export function findDropTarget(
  draggableId: string,
  droppableIds: readonly (string | null | undefined)[],
): DropAnimationTarget | null {
  if (typeof document === 'undefined') return null;

  for (const droppableId of droppableIds) {
    if (!droppableId) continue;
    const droppable = queryByAttribute<HTMLElement>(document, 'data-droppable-id', droppableId);
    const element = droppable
      ? queryByAttribute<HTMLElement>(droppable, 'data-draggable-id', draggableId)
      : null;
    if (!droppable || !element) continue;

    const rect = element.getBoundingClientRect();
    // Hidden, or virtualized/scrolled out of the list's visible box: nowhere to land.
    if (rect.width === 0 && rect.height === 0) return null;
    const bounds = droppable.getBoundingClientRect();
    const visible =
      rect.bottom > bounds.top &&
      rect.top < bounds.bottom &&
      rect.right > bounds.left &&
      rect.left < bounds.right;
    return visible ? { element, rect } : null;
  }
  return null;
}
