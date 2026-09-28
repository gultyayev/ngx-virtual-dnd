import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import {
  applyMove,
  DraggableDirective,
  DragPreviewComponent,
  DragStateService,
  DropEvent,
  DroppableDirective,
  DroppableGroupDirective,
  isNoOpDrop,
} from 'ngx-virtual-dnd';
import { DragStateDebugComponent } from '../drag-state-debug/drag-state-debug';

interface Item {
  id: string;
  name: string;
}

/**
 * Demo for issue #23: a droppable that only mounts DURING a drag must still become a
 * valid drop target, even though the candidate snapshot was frozen at drag start. The
 * "Target" list is conditionally rendered while a drag is active (or once it holds
 * items), exercising the mid-drag candidate refresh path.
 */
@Component({
  selector: 'app-mid-drag-mount-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DraggableDirective,
    DroppableDirective,
    DroppableGroupDirective,
    DragPreviewComponent,
    DragStateDebugComponent,
  ],
  template: `
    <main class="mdm">
      <h1>Mid-drag mount</h1>
      <p class="hint">
        The Target list only mounts while a drag is active. Dragging an item from Source onto it
        must drop there — verifying that a droppable added mid-drag becomes a valid target.
      </p>

      <div class="counts">
        Source: <span data-testid="source-count">{{ source().length }}</span> &nbsp;·&nbsp; Target:
        <span data-testid="target-count">{{ target().length }}</span>
      </div>

      <div class="cols" vdndGroup="midmount">
        <section class="col">
          <h2>Source</h2>
          <div class="list" vdndDroppable="source" (drop)="onDrop($event)">
            @for (item of source(); track item.id) {
              <div class="item" [vdndDraggable]="item.id" [vdndDraggableData]="item">
                <span data-testid="item-text">{{ item.name }}</span>
              </div>
            }
          </div>
        </section>

        @if (showTarget()) {
          <section class="col">
            <h2>Target</h2>
            <div class="list target-list" vdndDroppable="target" (drop)="onDrop($event)">
              @for (item of target(); track item.id) {
                <div class="item" [vdndDraggable]="item.id" [vdndDraggableData]="item">
                  <span data-testid="item-text">{{ item.name }}</span>
                </div>
              } @empty {
                <p class="empty">Drop here</p>
              }
            </div>
          </section>
        }
      </div>
    </main>

    <vdnd-drag-preview />
    <app-drag-state-debug />
  `,
  styles: `
    .mdm {
      max-width: 720px;
      margin: 0 auto;
      padding: 24px;
      font-family: system-ui, sans-serif;
    }

    .hint {
      color: #555;
      font-size: 14px;
    }

    .counts {
      margin: 12px 0;
      font-weight: 600;
    }

    .cols {
      display: flex;
      gap: 24px;
      align-items: flex-start;
    }

    .col {
      width: 260px;
      flex: 0 0 auto;
    }

    .list {
      min-height: 320px;
      padding: 8px;
      border: 2px dashed #bbb;
      border-radius: 8px;
      background: #fafafa;
    }

    .target-list {
      border-color: #4f8cff;
      background: #eef4ff;
    }

    .item {
      height: 44px;
      display: flex;
      align-items: center;
      padding: 0 12px;
      margin-bottom: 8px;
      border-radius: 6px;
      background: #fff;
      border: 1px solid #ddd;
      cursor: grab;
      user-select: none;
    }

    .empty {
      color: #4f8cff;
      text-align: center;
      margin-top: 120px;
    }
  `,
})
export class MidDragMountDemoComponent {
  readonly #dragState = inject(DragStateService);

  /** Whether a drag is currently active. */
  readonly isDragging = this.#dragState.isDragging;

  /** Source list items. */
  readonly source = signal<Item[]>([
    { id: 'item-0', name: 'Item 1' },
    { id: 'item-1', name: 'Item 2' },
    { id: 'item-2', name: 'Item 3' },
    { id: 'item-3', name: 'Item 4' },
  ]);

  /** Target list items (starts empty). */
  readonly target = signal<Item[]>([]);

  /**
   * Whether the target list is rendered. It starts hidden (proving the droppable is absent
   * before any drag) and mounts the moment a drag begins. It stays mounted afterwards so a
   * completed drop remains visible.
   */
  readonly showTarget = signal(false);

  constructor() {
    effect(() => {
      if (this.isDragging()) {
        this.showTarget.set(true);
      }
    });
  }

  /** Handle a drop into either list. */
  onDrop(event: DropEvent): void {
    if (isNoOpDrop(event)) {
      return;
    }
    const moved = applyMove(event, {
      source: this.source(),
      target: this.target(),
    });
    this.source.set(moved['source']);
    this.target.set(moved['target']);
  }
}
