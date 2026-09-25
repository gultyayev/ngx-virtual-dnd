import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  DraggableDirective,
  DragPreviewComponent,
  DropEvent,
  DroppableDirective,
  DroppableGroupDirective,
  reorderItems,
} from 'ngx-virtual-dnd';
import { DragStateDebugComponent } from '../drag-state-debug/drag-state-debug';
import { ShadowFieldComponent } from './shadow-field';

interface Row {
  id: string;
  name: string;
}

/**
 * E2E fixture: rows that contain form controls. The controls keep their own mouse and keyboard
 * behavior (Space types a space, clicks the button), and the default drag preview, a clone of
 * the row, must not change their state. The second list holds controls the draggable only finds
 * by looking into shadow DOM or at ARIA roles: a text field inside a web component, an ARIA
 * switch, and a summary.
 */
@Component({
  selector: 'app-interactive-children-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DraggableDirective,
    DroppableDirective,
    DroppableGroupDirective,
    DragPreviewComponent,
    DragStateDebugComponent,
    ShadowFieldComponent,
  ],
  template: `
    <main class="icd">
      <h1 class="icd-title">Interactive children</h1>
      <p class="icd-hint">
        Each row holds a text field, a radio group and a button. They work as usual, and dragging a
        row leaves them unchanged. So do the controls in the second list: a text field inside a web
        component's shadow DOM, a switch built with ARIA, and a disclosure.
      </p>

      <div class="listcard" vdndGroup="interactive">
        <div class="list-hd">
          <span class="list-title">Rows</span>
        </div>
        <div class="list icd-list" vdndDroppable="rows" (drop)="onDrop($event)">
          @for (row of rows(); track row.id) {
            <div class="item" [vdndDraggable]="row.id">
              <div class="item-inner">
                <span class="item-text icd-name" data-testid="row-name">{{ row.name }}</span>
                <input
                  class="input icd-note"
                  type="text"
                  data-testid="row-note"
                  [attr.aria-label]="row.name + ' note'"
                />
                <span
                  class="icd-priority"
                  role="radiogroup"
                  [attr.aria-label]="row.name + ' priority'"
                >
                  <label>
                    <input
                      type="radio"
                      value="low"
                      data-testid="row-priority-low"
                      [name]="'priority-' + row.id"
                    />
                    Low
                  </label>
                  <label>
                    <input
                      type="radio"
                      value="high"
                      checked
                      data-testid="row-priority-high"
                      [name]="'priority-' + row.id"
                    />
                    High
                  </label>
                </span>
                <button
                  type="button"
                  class="btn btn-secondary icd-button"
                  data-testid="row-button"
                  (click)="count(row.id)"
                >
                  Clicked <span data-testid="row-clicks">{{ clicks()[row.id] ?? 0 }}</span>
                </button>
              </div>
            </div>
          }
        </div>
      </div>

      <div class="listcard icd-more" vdndGroup="interactive-more">
        <div class="list-hd">
          <span class="list-title">More controls</span>
        </div>
        <div class="list icd-list" vdndDroppable="more-rows" (drop)="onMoreDrop($event)">
          @for (row of moreRows(); track row.id) {
            <div class="item" [vdndDraggable]="row.id">
              <div class="item-inner">
                <span class="item-text icd-name">{{ row.name }}</span>
                <app-shadow-field
                  class="icd-note"
                  data-testid="row-shadow-field"
                  [label]="row.name + ' note'"
                />
                <span
                  class="icd-switch"
                  role="switch"
                  tabindex="0"
                  data-testid="row-switch"
                  [attr.aria-checked]="switchedOn()[row.id] ?? false"
                  [attr.aria-label]="row.name + ' enabled'"
                  (click)="toggle(row.id)"
                  (keydown.space)="onSwitchSpace($event, row.id)"
                ></span>
                <details class="icd-details" data-testid="row-details">
                  <summary data-testid="row-summary">Details</summary>
                  Notes for {{ row.name }}
                </details>
              </div>
            </div>
          }
        </div>
      </div>
    </main>

    <vdnd-drag-preview />
    <app-drag-state-debug />
  `,
  styles: `
    .icd {
      max-width: 760px;
      margin: 0 auto;
      padding: 32px 16px;
    }

    .icd-title {
      margin: 0 0 8px;
      font-size: 30px;
      font-weight: 700;
      letter-spacing: -0.025em;
      color: var(--ink);
    }

    .icd-hint {
      margin: 0 0 24px;
      font-size: 13.5px;
      color: var(--ink-2);
    }

    .icd-list {
      padding: 8px 0;
    }

    .icd-name {
      flex: 0 0 auto;
    }

    .icd-note {
      flex: 1 1 auto;
      min-width: 0;
      height: 32px;
    }

    .icd-priority {
      display: flex;
      gap: 12px;
      flex: 0 0 auto;
      font-size: 13px;
      color: var(--ink-2);
    }

    .icd-priority label {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .icd-priority input {
      accent-color: var(--accent);
    }

    .icd-button {
      flex: 0 0 auto;
      height: 32px;
    }

    .icd-more {
      margin-top: 24px;
    }

    .icd-switch {
      position: relative;
      flex: 0 0 auto;
      width: 36px;
      height: 20px;
      border-radius: 999px;
      background: var(--border-2);
      cursor: pointer;
      transition: background 0.15s;
    }

    .icd-switch::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--surface);
      box-shadow: var(--shadow-sm);
      transition: transform 0.15s;
    }

    .icd-switch[aria-checked='true'] {
      background: var(--accent);
    }

    .icd-switch[aria-checked='true']::after {
      transform: translateX(16px);
    }

    .icd-switch:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px var(--accent-ring);
    }

    .icd-details {
      flex: 0 0 auto;
      font-size: 13px;
      color: var(--ink-2);
    }

    .icd-details summary {
      cursor: pointer;
    }
  `,
})
export class InteractiveChildrenDemoComponent {
  readonly rows = signal<Row[]>([
    { id: 'row-1', name: 'Row 1' },
    { id: 'row-2', name: 'Row 2' },
    { id: 'row-3', name: 'Row 3' },
  ]);

  /** Button clicks per row (rows not clicked yet are missing). */
  readonly clicks = signal<Partial<Record<string, number>>>({});

  readonly moreRows = signal<Row[]>([
    { id: 'more-1', name: 'Row 4' },
    { id: 'more-2', name: 'Row 5' },
  ]);

  /** Switches turned on, per row (rows never switched are missing). */
  readonly switchedOn = signal<Partial<Record<string, boolean>>>({});

  count(rowId: string): void {
    this.clicks.update((clicks) => ({ ...clicks, [rowId]: (clicks[rowId] ?? 0) + 1 }));
  }

  toggle(rowId: string): void {
    this.switchedOn.update((switchedOn) => ({ ...switchedOn, [rowId]: !switchedOn[rowId] }));
  }

  /** Space toggles a switch, and must not scroll the page. */
  onSwitchSpace(event: Event, rowId: string): void {
    event.preventDefault();
    this.toggle(rowId);
  }

  onDrop(event: DropEvent): void {
    reorderItems(event, this.rows);
  }

  onMoreDrop(event: DropEvent): void {
    reorderItems(event, this.moreRows);
  }
}
