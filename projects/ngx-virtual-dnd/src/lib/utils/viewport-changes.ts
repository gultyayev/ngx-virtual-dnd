import type { VdndScrollContainer } from '../tokens/scroll-container.token';

/**
 * A scroll container that tells the lists inside it right away when what they show changes: a
 * scroll position committed in its scroll event, or a size or restored scroll position its
 * ResizeObserver reports. Both arrive before the browser paints the frame that shows them, so a
 * list can render its rows for them in that frame (see `bindScrollTopSignal`). The built-in
 * containers implement it; `*vdndVirtualFor` listens when its container does, and renders from its
 * effect otherwise (a frame later). They implement it without declaring it, so it stays out of
 * the package's types (as VdndOffsetRowsViewport does).
 * @internal
 */
export interface VdndViewportChanges {
  /** Call `listener` after each change of what the container shows. Returns the unsubscribe. */
  onViewportChange(listener: () => void): () => void;
}

/** Whether a scroll container tells about the changes of what it shows (the built-in ones do). */
export function hasViewportChanges(
  container: VdndScrollContainer,
): container is VdndScrollContainer & VdndViewportChanges {
  return typeof (container as Partial<VdndViewportChanges>).onViewportChange === 'function';
}

/** The listeners of a scroll container's viewport changes. */
export class ViewportChangeListeners implements VdndViewportChanges {
  readonly #listeners = new Set<() => void>();

  onViewportChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Tell every listener that what the container shows changed. */
  notify(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
