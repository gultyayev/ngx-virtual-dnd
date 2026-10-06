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
 * E2E fixture: rows that contain form controls and a `no-drag` tag. The controls keep their own
 * mouse and keyboard behavior (Space types a space, clicks the button), presses anywhere in the
 * tag never start a drag, and the default drag preview, a clone of the row, must not change the
 * controls' state. Two more lists hold rows inside a contenteditable region and rows that are
 * buttons themselves: a control around the row, or the row itself, doesn't block a drag. The
 * last list holds rows that are their own editing host: their text takes presses and Space, and
 * their non-editable grip drags them.
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
        Each row holds a text field, a radio group, a <code>no-drag</code> tag and a button. They
        work as usual, pressing the tag never starts a drag, and dragging a row leaves them
        unchanged. Rows inside an editable region and rows that are buttons drag as usual. Editable
        blocks stay editable and drag by their grip.
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
                <span class="tag tag--work no-drag">
                  <span data-testid="row-no-drag-label">Pinned</span>
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

      <div class="listcard icd-card" vdndGroup="editor">
        <div class="list-hd">
          <span class="list-title">Blocks in an editor</span>
        </div>
        <div contenteditable="true" data-testid="editor">
          <div class="list icd-list" vdndDroppable="blocks" (drop)="onBlockDrop($event)">
            @for (block of blocks(); track block.id) {
              <div class="item" [vdndDraggable]="block.id">
                <div class="item-inner">
                  <span class="item-text">{{ block.name }}</span>
                </div>
              </div>
            }
          </div>
        </div>
      </div>

      <div class="listcard icd-card" vdndGroup="buttons">
        <div class="list-hd">
          <span class="list-title">Button rows</span>
        </div>
        <div class="list icd-list" vdndDroppable="buttons" (drop)="onButtonDrop($event)">
          @for (button of buttons(); track button.id) {
            <button type="button" class="item icd-button-row" [vdndDraggable]="button.id">
              <span class="item-inner">
                <span class="item-text">{{ button.name }}</span>
              </span>
            </button>
          }
        </div>
      </div>

      <div class="listcard icd-card" vdndGroup="editable-blocks">
        <div class="list-hd">
          <span class="list-title">Editable blocks</span>
        </div>
        <div
          class="list icd-list"
          vdndDroppable="editable-blocks"
          (drop)="onEditableBlockDrop($event)"
        >
          @for (block of editableBlocks(); track block.id) {
            <div
              class="item use-handle"
              contenteditable="true"
              dragHandle=".item-handle"
              [vdndDraggable]="block.id"
            >
              <div class="item-inner">
                <span
                  class="item-handle"
                  contenteditable="false"
                  tabindex="0"
                  role="button"
                  aria-roledescription="drag handle"
                  data-testid="block-grip"
                  [attr.aria-label]="'Drag ' + block.name"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <circle cx="9" cy="5" r="1.6" />
                    <circle cx="15" cy="5" r="1.6" />
                    <circle cx="9" cy="12" r="1.6" />
                    <circle cx="15" cy="12" r="1.6" />
                    <circle cx="9" cy="19" r="1.6" />
                    <circle cx="15" cy="19" r="1.6" />
                  </svg>
                </span>
                <span class="item-text" data-testid="block-text">{{ block.name }}</span>
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

    .icd-card {
      margin-top: 24px;
    }

    .icd-button-row {
      display: block;
      width: 100%;
      border: 0;
      background: none;
      font: inherit;
      color: inherit;
      text-align: start;
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

  /** Rows inside a contenteditable region, like the blocks of a rich-text editor. */
  readonly blocks = signal<Row[]>([
    { id: 'block-1', name: 'Block 1' },
    { id: 'block-2', name: 'Block 2' },
    { id: 'block-3', name: 'Block 3' },
  ]);

  /** Rows that are themselves buttons. */
  readonly buttons = signal<Row[]>([
    { id: 'button-1', name: 'Button 1' },
    { id: 'button-2', name: 'Button 2' },
    { id: 'button-3', name: 'Button 3' },
  ]);

  /** Rows that are their own editing host, dragged by a non-editable grip. */
  readonly editableBlocks = signal<Row[]>([
    { id: 'editable-block-1', name: 'Editable block 1' },
    { id: 'editable-block-2', name: 'Editable block 2' },
    { id: 'editable-block-3', name: 'Editable block 3' },
  ]);

  /** Button clicks per row (rows not clicked yet are missing). */
  readonly clicks = signal<Partial<Record<string, number>>>({});

  count(rowId: string): void {
    this.clicks.update((clicks) => ({ ...clicks, [rowId]: (clicks[rowId] ?? 0) + 1 }));
  }

  onDrop(event: DropEvent): void {
    reorderItems(event, this.rows);
  }

  onBlockDrop(event: DropEvent): void {
    reorderItems(event, this.blocks);
  }

  onButtonDrop(event: DropEvent): void {
    reorderItems(event, this.buttons);
  }

  onEditableBlockDrop(event: DropEvent): void {
    reorderItems(event, this.editableBlocks);
  }
}
