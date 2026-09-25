import { ChangeDetectionStrategy, Component, input, ViewEncapsulation } from '@angular/core';

/**
 * A text field rendered in its own open shadow root, like the form controls of UI libraries built
 * on web components (Ionic, Shoelace, Material Web). The global styles don't reach inside it, so
 * it carries its own copy of the `.input` look.
 */
@Component({
  selector: 'app-shadow-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.ShadowDom,
  template: `<input type="text" data-testid="shadow-field-input" [attr.aria-label]="label()" />`,
  styles: `
    :host {
      display: block;
    }

    input {
      box-sizing: border-box;
      width: 100%;
      height: 32px;
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: 9px;
      background: var(--field-bg);
      color: var(--ink);
      font-family: inherit;
      font-size: 14px;
      outline: none;
      transition:
        border-color 0.15s,
        box-shadow 0.15s;
    }

    input:hover {
      border-color: var(--border-2);
    }

    input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-ring);
    }
  `,
})
export class ShadowFieldComponent {
  readonly label = input.required<string>();
}
