import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  DraggableDirective,
  DragPreviewComponent,
  DroppableDirective,
  DroppableGroupDirective,
  VirtualForDirective,
  VirtualSortableListComponent,
  VirtualViewportComponent,
} from 'ngx-virtual-dnd';

interface Row {
  id: string;
  name: string;
  /** Whether the row fades out when it leaves (`animate.leave`) */
  fades: boolean;
}

function createRows(prefix: string, label: string, count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    name: `${label} ${i}`,
    fades: i % 2 === 0,
  }));
}

/**
 * E2E fixture: even rows play a leave animation (`animate.leave`), odd rows don't. Angular removes
 * a leaving row's element only when that animation ends, so the view of a row that fades out
 * must not render a row that scrolls in; the views of the other rows are recycled. "Rows" is a
 * `vdnd-sortable-list` with `recycleRows`; "Viewport rows" renders its rows with
 * `*vdndVirtualFor`, which always recycles.
 */
@Component({
  selector: 'app-row-leave-animation-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    VirtualSortableListComponent,
    VirtualViewportComponent,
    VirtualForDirective,
    DroppableDirective,
    DroppableGroupDirective,
    DraggableDirective,
    DragPreviewComponent,
  ],
  template: `
    <main class="rla">
      <h1 class="rla-title">Row leave animation</h1>
      <p class="rla-hint">
        Even rows fade out when they leave the list, including when they scroll out of range. Both
        lists recycle the rows that don't fade out.
      </p>
      <div class="lists">
        <div class="listcard" vdndGroup="leave-animation">
          <div class="list-hd">
            <span class="list-title">Rows</span>
          </div>
          <vdnd-sortable-list
            droppableId="rows"
            [items]="rows()"
            [itemHeight]="50"
            [containerHeight]="400"
            [itemIdFn]="rowId"
            [itemTemplate]="rowTpl"
            [recycleRows]="true"
          />
          <!-- Declared inside vdndGroup so the rendered draggables inherit the group. -->
          <ng-template #rowTpl let-row>
            @if (row.fades) {
              <div class="item" animate.leave="rla-leave" [vdndDraggable]="row.id">
                <div class="item-inner">
                  <span class="item-text">{{ row.name }}</span>
                </div>
              </div>
            } @else {
              <div class="item" [vdndDraggable]="row.id">
                <div class="item-inner">
                  <span class="item-text">{{ row.name }}</span>
                </div>
              </div>
            }
          </ng-template>
        </div>

        <div class="listcard" vdndGroup="leave-animation-viewport">
          <div class="list-hd">
            <span class="list-title">Viewport rows</span>
          </div>
          <vdnd-virtual-viewport
            class="rla-viewport"
            vdndDroppable="viewport-rows"
            [itemHeight]="50"
          >
            <ng-container *vdndVirtualFor="let row of viewportRows(); trackBy: trackById">
              @if (row.fades) {
                <div class="item" animate.leave="rla-leave" [vdndDraggable]="row.id">
                  <div class="item-inner">
                    <span class="item-text">{{ row.name }}</span>
                  </div>
                </div>
              } @else {
                <div class="item" [vdndDraggable]="row.id">
                  <div class="item-inner">
                    <span class="item-text">{{ row.name }}</span>
                  </div>
                </div>
              }
            </ng-container>
          </vdnd-virtual-viewport>
        </div>
      </div>
    </main>

    <vdnd-drag-preview />
  `,
  styles: `
    .rla {
      max-width: 760px;
      margin: 0 auto;
      padding: 32px 16px;
    }
    .rla-title {
      margin: 0 0 8px;
      font-size: 30px;
      font-weight: 700;
      letter-spacing: -0.025em;
      color: var(--ink);
    }
    .rla-hint {
      margin: 0 0 24px;
      font-size: 13.5px;
      color: var(--ink-2);
    }
    .rla-viewport {
      height: 400px;
      background: var(--bg-sunk);
    }
    .rla-leave {
      animation: rla-fade-out 300ms linear;
    }
    @keyframes rla-fade-out {
      to {
        opacity: 0;
      }
    }
  `,
})
export class RowLeaveAnimationDemoComponent {
  readonly rows = signal<Row[]>(createRows('row', 'Row', 100));
  readonly viewportRows = signal<Row[]>(createRows('vrow', 'Viewport row', 100));

  readonly rowId = (row: Row): string => row.id;
  readonly trackById = (_index: number, row: Row): string => row.id;
}
