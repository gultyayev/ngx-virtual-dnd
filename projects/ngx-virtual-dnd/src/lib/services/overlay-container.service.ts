import { computed, Injectable, OnDestroy, signal } from '@angular/core';

/**
 * Service that manages a shared overlay container appended to `document.body`.
 *
 * Elements placed inside the overlay container escape any ancestor CSS `transform`,
 * `perspective`, or `filter` that would create a new containing block for
 * `position: fixed` children. This ensures viewport-relative positioning works
 * correctly regardless of where the consuming component sits in the DOM tree.
 *
 * Mirrors the strategy used by Angular CDK's `OverlayContainer`.
 */
@Injectable({
  providedIn: 'root',
})
export class OverlayContainerService implements OnDestroy {
  #containerElement: HTMLElement | null = null;

  /** Number of mounted drag previews. */
  readonly #previewCount = signal(0);

  /** Number of mounted drag previews currently rendering via a custom template. */
  readonly #templatePreviewCount = signal(0);

  /** Whether at least one mounted drag preview renders via a custom template. */
  readonly hasTemplatePreview = computed(() => this.#templatePreviewCount() > 0);

  /**
   * Whether a mounted drag preview shows a clone of the dragged element: one without a custom
   * template (see DragPreviewComponent).
   *
   * When false, DraggableDirective/KeyboardDragHandler skip the expensive drag-start element
   * clone, which nothing would show: every mounted preview renders its template, or none is
   * mounted.
   */
  readonly hasClonePreview = computed(() => this.#previewCount() > this.#templatePreviewCount());

  /**
   * Register (`mounted = true`) or unregister (`mounted = false`) a drag preview. Calls must be
   * balanced per preview instance.
   */
  setPreviewMounted(mounted: boolean): void {
    this.#previewCount.update((count) => Math.max(0, count + (mounted ? 1 : -1)));
  }

  /**
   * Register (`active = true`) or unregister (`active = false`) a preview that
   * renders via a custom template. Calls must be balanced per preview instance.
   */
  setTemplatePreviewActive(active: boolean): void {
    this.#templatePreviewCount.update((count) => Math.max(0, count + (active ? 1 : -1)));
  }

  /**
   * Returns the shared overlay container element, lazily creating it on first access.
   * Returns `null` in non-browser environments (SSR).
   */
  getContainerElement(): HTMLElement | null {
    if (typeof document === 'undefined') {
      return null;
    }

    if (!this.#containerElement) {
      this.#containerElement = document.createElement('div');
      this.#containerElement.classList.add('vdnd-overlay-container');
      document.body.appendChild(this.#containerElement);
    }

    return this.#containerElement;
  }

  ngOnDestroy(): void {
    this.#containerElement?.remove();
    this.#containerElement = null;
  }
}
