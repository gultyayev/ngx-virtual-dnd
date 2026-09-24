import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DragStateDebugComponent } from '../drag-state-debug/drag-state-debug';

/**
 * Chrome-less host for the single-purpose examples embedded in the docs site
 * (`<LiveDemo>` iframes). Owns the shared example styling so each example component
 * stays a copy-pasteable snippet, and renders the hidden drag-state mirror the E2E
 * helpers synchronize on.
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
export class ExamplesShellComponent {}
