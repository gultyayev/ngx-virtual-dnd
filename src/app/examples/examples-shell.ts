import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  NgZone,
  ViewEncapsulation,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DragStateDebugComponent } from '../drag-state-debug/drag-state-debug';

/** Posted to the embedding docs page whenever the example's height changes. */
export interface ExampleSizeMessage {
  type: 'vdnd-example-size';
  height: number;
}

/**
 * Chrome-less host for the single-purpose examples embedded in the docs site
 * (`<LiveDemo>` iframes). Owns the shared example styling so each example component
 * stays a copy-pasteable snippet, and renders the hidden drag-state mirror the E2E
 * helpers synchronize on.
 *
 * When framed, it reports its height to the parent (`{ type: 'vdnd-example-size' }`), so
 * `<LiveDemo>` sizes the iframe to the example at any width.
 *
 * Styles are unencapsulated but scoped to `app-examples-shell`, because they must
 * reach elements rendered by library components (droppable wrappers, placeholders).
 */
@Component({
  selector: 'app-examples-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [RouterOutlet, DragStateDebugComponent],
  template: `
    <router-outlet />
    <app-drag-state-debug />
  `,
  styleUrl: './examples-shell.scss',
})
export class ExamplesShellComponent {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #ngZone = inject(NgZone);
  readonly #destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => this.#reportSizeToEmbeddingPage());
  }

  #reportSizeToEmbeddingPage(): void {
    if (window.parent === window || typeof ResizeObserver === 'undefined') return;

    let lastHeight = -1;
    const report = (): void => {
      const height = Math.ceil(this.#host.nativeElement.getBoundingClientRect().height);
      if (height === lastHeight) return;
      lastHeight = height;
      const message: ExampleSizeMessage = { type: 'vdnd-example-size', height };
      window.parent.postMessage(message, '*');
    };

    this.#ngZone.runOutsideAngular(() => {
      const observer = new ResizeObserver(report);
      observer.observe(this.#host.nativeElement);
      this.#destroyRef.onDestroy(() => observer.disconnect());
    });
    report();
  }
}
