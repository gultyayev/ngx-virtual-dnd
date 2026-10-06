import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  DraggableDirective,
  DragPreviewComponent,
  DropEvent,
  DroppableDirective,
  DroppableGroupDirective,
  moveItem,
  ScrollableDirective,
  VirtualForDirective,
} from 'ngx-virtual-dnd';
import { DragStateDebugComponent } from '../drag-state-debug/drag-state-debug';

interface Row {
  id: string;
  name: string;
}

/** A non-negative whole number of rows from the query parameter, else the default 3. */
function parseOverscan(value: string | null): number {
  const overscan = Number(value ?? undefined);
  return Number.isInteger(overscan) && overscan >= 0 ? overscan : 3;
}

/**
 * E2E fixture: two `*vdndVirtualFor` lists, each directly in a `vdndScrollable` droppable, with
 * no viewport component. The scroll containers set no `position`, as in the documented example.
 * `?overscan=` sets the Tasks list's overscan (3 by default).
 */
@Component({
  selector: 'app-scrollable-virtual-for-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DraggableDirective,
    DroppableDirective,
    DroppableGroupDirective,
    ScrollableDirective,
    VirtualForDirective,
    DragPreviewComponent,
    DragStateDebugComponent,
  ],
  template: `
    <main
      class="svf"
      data-testid="scrollable-virtual-for-demo"
      [attr.data-last-drop-source-index]="lastDropSourceIndex()"
      [attr.data-last-drop-destination-index]="lastDropDestinationIndex()"
    >
      <h1 class="svf-title">Virtual for in a scrollable</h1>
      <p class="svf-hint">
        Each list is <code>*vdndVirtualFor</code> directly in a <code>vdndScrollable</code>
        droppable, with no viewport component.
      </p>

      <div class="lists" vdndGroup="scrollable">
        <div class="listcard">
          <div class="list-hd">
            <span class="list-title">Tasks</span>
            <span class="count-badge" data-testid="scrollable-count">{{ tasks().length }}</span>
          </div>
          <div
            class="svf-scroller"
            vdndScrollable
            vdndDroppable="scrollable"
            (drop)="onDrop($event)"
          >
            <ng-container
              *vdndVirtualFor="
                let row of tasks();
                itemHeight: 50;
                trackBy: trackById;
                overscan: tasksOverscan
              "
            >
              <div class="item" [vdndDraggable]="row.id" [vdndDraggableData]="row">
                <div class="item-inner">
                  <span class="item-text">{{ row.name }}</span>
                </div>
              </div>
            </ng-container>
          </div>
        </div>

        <div class="listcard">
          <div class="list-hd">
            <span class="list-title">Backlog</span>
            <span class="count-badge" data-testid="scrollable-b-count">{{ backlog().length }}</span>
          </div>
          <div
            class="svf-scroller"
            vdndScrollable
            vdndDroppable="scrollable-b"
            (drop)="onDrop($event)"
          >
            <ng-container
              *vdndVirtualFor="let row of backlog(); itemHeight: 50; trackBy: trackById"
            >
              <div class="item" [vdndDraggable]="row.id" [vdndDraggableData]="row">
                <div class="item-inner">
                  <span class="item-text">{{ row.name }}</span>
                </div>
              </div>
            </ng-container>
          </div>
        </div>
      </div>
    </main>

    <vdnd-drag-preview />
    <app-drag-state-debug />
  `,
  styles: `
    .svf {
      max-width: 760px;
      margin: 0 auto;
      padding: 32px 16px;
    }

    .svf-title {
      margin: 0 0 8px;
      font-size: 30px;
      font-weight: 700;
      letter-spacing: -0.025em;
      color: var(--ink);
    }

    .svf-hint {
      margin: 0 0 24px;
      font-size: 13.5px;
      color: var(--ink-2);
    }

    .svf-hint code {
      font-family: var(--font-mono);
      font-size: 12.5px;
    }

    .svf-scroller {
      height: 300px;
      overflow: auto;
      background: var(--bg-sunk);
      transition:
        background 0.15s,
        box-shadow 0.15s;
    }

    .svf-scroller.vdnd-droppable-active {
      background: var(--accent-soft);
      box-shadow: inset 0 0 0 1.5px var(--accent-soft-bd);
    }
  `,
})
export class ScrollableVirtualForDemoComponent {
  /** Rows the Tasks list renders above and below the visible ones (`?overscan=0` for none). */
  readonly tasksOverscan = parseOverscan(
    inject(ActivatedRoute).snapshot.queryParamMap.get('overscan'),
  );

  readonly tasks = signal<Row[]>(
    Array.from({ length: 30 }, (_, i) => ({ id: `s-${i + 1}`, name: `Task ${i + 1}` })),
  );
  readonly backlog = signal<Row[]>(
    Array.from({ length: 20 }, (_, i) => ({ id: `b-${i + 1}`, name: `Backlog item ${i + 1}` })),
  );

  /** The last drop, mirrored onto data attributes for the E2E tests. */
  readonly lastDrop = signal<DropEvent | null>(null);
  readonly lastDropSourceIndex = computed(() => this.lastDrop()?.source.index ?? null);
  readonly lastDropDestinationIndex = computed(() => this.lastDrop()?.destination.index ?? null);

  readonly trackById = (_index: number, row: Row): string => row.id;

  onDrop(event: DropEvent): void {
    this.lastDrop.set(event);
    moveItem(event, { scrollable: this.tasks, 'scrollable-b': this.backlog });
  }
}
