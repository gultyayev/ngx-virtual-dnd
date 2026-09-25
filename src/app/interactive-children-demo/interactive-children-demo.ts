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

interface Row {
  id: string;
  name: string;
}

/**
 * E2E fixture: rows that contain form controls. The controls keep their own mouse and keyboard
 * behavior (Space types a space, clicks the button), and the default drag preview, a clone of
 * the row, must not change their state.
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
  ],
  template: `
    <main class="icd">
      <h1 class="icd-title">Interactive children</h1>
      <p class="icd-hint">
        Each row holds a text field, a radio group and a button. They work as usual, and dragging a
        row leaves them unchanged.
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

  count(rowId: string): void {
    this.clicks.update((clicks) => ({ ...clicks, [rowId]: (clicks[rowId] ?? 0) + 1 }));
  }

  onDrop(event: DropEvent): void {
    reorderItems(event, this.rows);
  }
}
