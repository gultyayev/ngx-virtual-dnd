import type { VdndScrollContainer } from '../tokens/scroll-container.token';

/**
 * A scroll container that tells the lists inside it about each scroll position it commits, in the
 * scroll event, so they can render the rows for it before the browser paints it (see
 * `bindScrollTopSignal`). The built-in containers implement it; `*vdndVirtualFor` listens when its
 * container does, and renders from its effect otherwise (a frame later). They implement it
 * without declaring it, so it stays out of the package's types (as VdndOffsetRowsViewport does).
 * @internal
 */
export interface VdndScrollCommits {
  /** Call `listener` after each scroll position the container commits. Returns the unsubscribe. */
  onScrollCommit(listener: () => void): () => void;
}

/** Whether a scroll container tells about its scroll commits (the built-in ones do). */
export function hasScrollCommits(
  container: VdndScrollContainer,
): container is VdndScrollContainer & VdndScrollCommits {
  return typeof (container as Partial<VdndScrollCommits>).onScrollCommit === 'function';
}

/** The listeners of a scroll container's scroll commits. */
export class ScrollCommitListeners implements VdndScrollCommits {
  readonly #listeners = new Set<() => void>();

  onScrollCommit(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Tell every listener about a committed scroll position. */
  notify(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
