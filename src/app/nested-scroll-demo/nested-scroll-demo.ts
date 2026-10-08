import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
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
  VirtualSortableListComponent,
} from 'ngx-virtual-dnd';
import { DragStateDebugComponent } from '../drag-state-debug/drag-state-debug';

interface Row {
  id: string;
  name: string;
}

const createRows = (prefix: string, name: string, count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i + 1}`, name: `${name} ${i + 1}` }));

/**
 * E2E fixture for scroll insets:
 * - a page scroller whose 80px sticky header covers its top (`scrollInsetTop`), holding a column
 *   scroller (a `vdndScrollable` list) and below it a `vdnd-sortable-list`, both scrolling under
 *   that header with the page;
 * - beside it, a `vdnd-sortable-list` with a 40px header and a 30px footer overlaid on its rows
 *   (`scrollInsetTop` and `scrollInsetBottom` on the list);
 * - below them, a list of plain `@for` rows in a scroller with a 40px sticky header.
 *
 * `?constrain=true` keeps drags inside their list (`constrainToContainer`).
 */
@Component({
  selector: 'app-nested-scroll-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DraggableDirective,
    DroppableDirective,
    DroppableGroupDirective,
    ScrollableDirective,
    VirtualForDirective,
    VirtualSortableListComponent,
    DragPreviewComponent,
    DragStateDebugComponent,
  ],
  template: `
    <main class="ns" data-testid="nested-scroll-demo">
      <h1 class="ns-title">Scroll insets</h1>
      <p class="ns-hint">
        Left: a list scrolling inside a page with a sticky header. Right: a list with a header and a
        footer overlaid on its rows.
      </p>

      <div class="ns-panes" vdndGroup="nested">
        <div class="ns-page" vdndScrollable [scrollInsetTop]="80" data-testid="nested-page">
          <header class="ns-page-header" data-testid="nested-page-header">Page header</header>
          <div class="ns-intro">Content above the list</div>
          <div
            class="ns-column"
            vdndScrollable
            vdndDroppable="column"
            [constrainToContainer]="constrain"
            data-testid="nested-column"
            (drop)="onDrop($event)"
          >
            <ng-container *vdndVirtualFor="let row of column(); itemHeight: 50; trackBy: trackById">
              <div class="item" [vdndDraggable]="row.id" [vdndDraggableData]="row">
                <div class="item-inner">
                  <span class="item-text">{{ row.name }}</span>
                </div>
              </div>
            </ng-container>
          </div>
          <vdnd-sortable-list
            class="ns-inner"
            droppableId="inner"
            data-testid="nested-inner-list"
            [items]="inner()"
            [itemHeight]="50"
            [containerHeight]="360"
            [itemIdFn]="rowId"
            [itemTemplate]="rowTpl"
            [constrainToContainer]="constrain"
            (drop)="onDrop($event)"
          />
          <div class="ns-filler">Content below the lists</div>
        </div>

        <div class="ns-side">
          <div class="ns-overlay" data-testid="side-overlay">Overlaid header</div>
          <vdnd-sortable-list
            droppableId="side"
            data-testid="side-list"
            [items]="side()"
            [itemHeight]="50"
            [containerHeight]="360"
            [itemIdFn]="rowId"
            [itemTemplate]="rowTpl"
            [constrainToContainer]="constrain"
            [scrollInsetTop]="40"
            [scrollInsetBottom]="30"
            (drop)="onDrop($event)"
          />
          <div class="ns-overlay-footer" data-testid="side-overlay-footer">Overlaid footer</div>
        </div>

        <ng-template #rowTpl let-row>
          <div class="item" [vdndDraggable]="row.id" [vdndDraggableData]="row">
            <div class="item-inner">
              <span class="item-text">{{ row.name }}</span>
            </div>
          </div>
        </ng-template>
      </div>

      <div
        class="ns-plain"
        vdndGroup="plain"
        vdndScrollable
        [scrollInsetTop]="40"
        data-testid="plain-scroller"
      >
        <header class="ns-plain-header" data-testid="plain-header">Plain list header</header>
        <div vdndDroppable="plain" [constrainToContainer]="constrain" (drop)="onDrop($event)">
          @for (row of plain(); track row.id) {
            <div class="item" [vdndDraggable]="row.id" [vdndDraggableData]="row">
              <div class="item-inner">
                <span class="item-text">{{ row.name }}</span>
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
    .ns {
      max-width: 900px;
      margin: 0 auto;
      padding: 24px 16px;
    }

    .ns-title {
      margin: 0 0 8px;
      font-size: 30px;
      font-weight: 700;
      letter-spacing: -0.025em;
      color: var(--ink);
    }

    .ns-hint {
      margin: 0 0 16px;
      font-size: 13.5px;
      color: var(--ink-2);
    }

    .ns-panes {
      display: flex;
      gap: 24px;
      align-items: flex-start;
    }

    .ns-page {
      flex: 1;
      height: 520px;
      overflow: auto;
      background: var(--surface);
      border-radius: 12px;
    }

    .ns-page-header {
      position: sticky;
      top: 0;
      z-index: 2;
      height: 80px;
      display: flex;
      align-items: center;
      padding: 0 16px;
      font-size: 15px;
      font-weight: 600;
      color: var(--ink);
      background: var(--surface-2);
    }

    .ns-intro,
    .ns-filler {
      padding: 16px;
      font-size: 13px;
      color: var(--ink-2);
    }

    .ns-intro {
      height: 240px;
    }

    .ns-filler {
      height: 1200px;
    }

    .ns-column {
      height: 360px;
      margin: 0 16px;
      overflow: auto;
      background: var(--bg-sunk);
    }

    .ns-inner {
      display: block;
      margin: 16px 16px 0;
      background: var(--bg-sunk);
    }

    .ns-plain {
      height: 300px;
      margin-top: 24px;
      overflow: auto;
      background: var(--bg-sunk);
      border-radius: 12px;
    }

    .ns-plain-header {
      position: sticky;
      top: 0;
      z-index: 2;
      height: 40px;
      display: flex;
      align-items: center;
      padding: 0 16px;
      font-size: 13px;
      font-weight: 600;
      color: var(--ink);
      background: var(--surface-2);
    }

    .ns-plain .item {
      height: 50px;
    }

    .ns-side {
      position: relative;
      flex: 1;
      background: var(--bg-sunk);
    }

    .ns-overlay,
    .ns-overlay-footer {
      position: absolute;
      left: 0;
      right: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      padding: 0 16px;
      font-size: 13px;
      font-weight: 600;
      color: var(--ink);
      background: var(--surface-2);
    }

    .ns-overlay {
      top: 0;
      height: 40px;
    }

    .ns-overlay-footer {
      bottom: 0;
      height: 30px;
    }
  `,
})
export class NestedScrollDemoComponent {
  /** Drags kept inside their list (`?constrain=true`) */
  readonly constrain = inject(ActivatedRoute).snapshot.queryParamMap.get('constrain') === 'true';

  readonly column = signal<Row[]>(createRows('column', 'Column row', 40));
  readonly inner = signal<Row[]>(createRows('inner', 'Inner row', 40));
  readonly side = signal<Row[]>(createRows('side', 'Side row', 40));
  readonly plain = signal<Row[]>(createRows('plain', 'Plain row', 20));

  readonly trackById = (_index: number, row: Row): string => row.id;
  readonly rowId = (row: Row): string => row.id;

  onDrop(event: DropEvent): void {
    moveItem(event, {
      column: this.column,
      inner: this.inner,
      side: this.side,
      plain: this.plain,
    });
  }
}
