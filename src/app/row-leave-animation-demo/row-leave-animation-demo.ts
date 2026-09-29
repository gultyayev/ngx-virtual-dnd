import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  DraggableDirective,
  DragPreviewComponent,
  VirtualSortableListComponent,
} from 'ngx-virtual-dnd';

interface Row {
  id: string;
  name: string;
}

/**
 * E2E fixture: a list with `recycleRows` whose rows play a leave animation (`animate.leave`).
 * Angular removes a leaving row's element only when that animation ends, so the view of a row
 * that scrolls out must not render a row that scrolls in.
 */
@Component({
  selector: 'app-row-leave-animation-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VirtualSortableListComponent, DraggableDirective, DragPreviewComponent],
  template: `
    <main class="rla">
      <h1 class="rla-title">Row leave animation</h1>
      <p class="rla-hint">
        The list recycles its rows, and each row fades out when it leaves the list, including when
        it scrolls out of range.
      </p>
      <div class="listcard">
        <div class="list-hd">
          <span class="list-title">Rows</span>
        </div>
        <vdnd-sortable-list
          droppableId="rows"
          group="leave-animation"
          [items]="rows"
          [itemHeight]="50"
          [containerHeight]="400"
          [itemIdFn]="rowId"
          [itemTemplate]="rowTpl"
          [recycleRows]="true"
        />
      </div>
      <ng-template #rowTpl let-row>
        <div class="item" animate.leave="rla-leave" [vdndDraggable]="row.id">
          <div class="item-inner">
            <span class="item-text" data-testid="row-name">{{ row.name }}</span>
          </div>
        </div>
      </ng-template>
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
  readonly rows: Row[] = Array.from({ length: 100 }, (_, i) => ({
    id: `row-${i}`,
    name: `Row ${i + 1}`,
  }));

  readonly rowId = (row: Row): string => row.id;
}
