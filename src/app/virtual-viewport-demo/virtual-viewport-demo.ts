import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import {
  DraggableDirective,
  DragPreviewComponent,
  DropEvent,
  DroppableDirective,
  DroppableGroupDirective,
  moveItem,
  VirtualForDirective,
  VirtualViewportComponent,
} from 'ngx-virtual-dnd';
import { DragStateDebugComponent } from '../drag-state-debug/drag-state-debug';

interface Row {
  id: string;
  name: string;
}

function createRows(prefix: string, label: string, count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    name: `${label} ${i + 1}`,
  }));
}

/**
 * E2E fixture: two self-scrolling `vdnd-virtual-viewport` lists that are also the droppables,
 * rendering their rows with `*vdndVirtualFor`. The second one reserves space above its rows with
 * `contentOffset`.
 */
@Component({
  selector: 'app-virtual-viewport-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DraggableDirective,
    DroppableDirective,
    DroppableGroupDirective,
    VirtualViewportComponent,
    VirtualForDirective,
    DragPreviewComponent,
    DragStateDebugComponent,
  ],
  template: `
    <main
      class="vvd"
      data-testid="viewport-demo"
      [attr.data-last-drop-source-index]="lastDropSourceIndex()"
      [attr.data-last-drop-destination-index]="lastDropDestinationIndex()"
    >
      <h1 class="vvd-title">Virtual viewport</h1>
      <p class="vvd-hint">
        Both lists are <code>vdnd-virtual-viewport</code> droppables that render their rows with
        <code>*vdndVirtualFor</code>. Backlog reserves {{ contentOffset }}px above its rows with
        <code>contentOffset</code>.
      </p>

      <div class="lists" vdndGroup="viewport">
        <div class="listcard">
          <div class="list-hd">
            <span class="list-title">Tasks</span>
            <span class="count-badge" data-testid="viewport-a-count">{{ tasks().length }}</span>
          </div>
          <vdnd-virtual-viewport
            class="vvd-viewport"
            vdndDroppable="viewport-a"
            [itemHeight]="50"
            (drop)="onDrop($event)"
          >
            <ng-container *vdndVirtualFor="let row of tasks(); trackBy: trackById">
              <div class="item" [vdndDraggable]="row.id" [vdndDraggableData]="row">
                <div class="item-inner">
                  <span class="item-text">{{ row.name }}</span>
                </div>
              </div>
            </ng-container>
          </vdnd-virtual-viewport>
        </div>

        <div class="listcard">
          <div class="list-hd">
            <span class="list-title">Backlog</span>
            <span class="count-badge" data-testid="viewport-b-count">{{ backlog().length }}</span>
          </div>
          <vdnd-virtual-viewport
            class="vvd-viewport"
            vdndDroppable="viewport-b"
            [itemHeight]="50"
            [contentOffset]="contentOffset"
            (drop)="onDrop($event)"
          >
            <ng-container *vdndVirtualFor="let row of backlog(); trackBy: trackById">
              <div class="item" [vdndDraggable]="row.id" [vdndDraggableData]="row">
                <div class="item-inner">
                  <span class="item-text">{{ row.name }}</span>
                </div>
              </div>
            </ng-container>
          </vdnd-virtual-viewport>
        </div>
      </div>
    </main>

    <vdnd-drag-preview />
    <app-drag-state-debug />
  `,
  styles: `
    .vvd {
      max-width: 760px;
      margin: 0 auto;
      padding: 32px 16px;
    }

    .vvd-title {
      margin: 0 0 8px;
      font-size: 30px;
      font-weight: 700;
      letter-spacing: -0.025em;
      color: var(--ink);
    }

    .vvd-hint {
      margin: 0 0 24px;
      font-size: 13.5px;
      color: var(--ink-2);
    }

    .vvd-hint code {
      font-family: var(--font-mono);
      font-size: 12.5px;
    }

    .vvd-viewport {
      height: 300px;
      background: var(--bg-sunk);
      transition:
        background 0.15s,
        box-shadow 0.15s;
    }

    .vvd-viewport.vdnd-droppable-active {
      background: var(--accent-soft);
      box-shadow: inset 0 0 0 1.5px var(--accent-soft-bd);
    }
  `,
})
export class VirtualViewportDemoComponent {
  /** Space (px) the Backlog viewport reserves above its rows. */
  readonly contentOffset = 80;

  readonly tasks = signal<Row[]>(createRows('a', 'Task', 60));
  readonly backlog = signal<Row[]>(createRows('b', 'Backlog item', 30));

  /** The last drop, mirrored onto data attributes for the E2E tests. */
  readonly lastDrop = signal<DropEvent | null>(null);
  readonly lastDropSourceIndex = computed(() => this.lastDrop()?.source.index ?? null);
  readonly lastDropDestinationIndex = computed(() => this.lastDrop()?.destination.index ?? null);

  readonly trackById = (_index: number, row: Row): string => row.id;

  onDrop(event: DropEvent): void {
    this.lastDrop.set(event);
    moveItem(event, { 'viewport-a': this.tasks, 'viewport-b': this.backlog });
  }
}
