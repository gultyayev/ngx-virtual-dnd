/**
 * @jest-environment node
 */
import '@angular/compiler';
import { Component, provideZonelessChangeDetection, Type } from '@angular/core';
import { bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import { DragPreviewComponent } from './components/drag-preview.component';
import { VirtualContentComponent } from './components/virtual-content.component';
import { VirtualScrollContainerComponent } from './components/virtual-scroll-container.component';
import { VirtualSortableListComponent } from './components/virtual-sortable-list.component';
import { VirtualViewportComponent } from './components/virtual-viewport.component';
import { ContentHeaderDirective } from './directives/content-header.directive';
import { DraggableDirective } from './directives/draggable.directive';
import { DroppableGroupDirective } from './directives/droppable-group.directive';
import { DroppableDirective } from './directives/droppable.directive';
import { ScrollableDirective } from './directives/scrollable.directive';
import { VirtualForDirective } from './directives/virtual-for.directive';

/**
 * Renders the library with Angular's real server renderer (`@angular/platform-server`, a dev
 * dependency of the repo only), the way an SSR app does: in Node, with no global `document` or
 * `window`, into a server DOM that has no layout. `server-rendering.spec.ts` and
 * `server-teardown.spec.ts` cover the parts one at a time; this runs the whole bootstrap, render
 * and teardown.
 */

interface Row {
  id: string;
}

const ROW_COUNT = 20;

abstract class RowsHost {
  readonly rows: Row[] = Array.from({ length: ROW_COUNT }, (_, i) => ({ id: `row-${i}` }));
  readonly trackById = (_index: number, row: Row): string => row.id;
  readonly rowId = (row: Row): string => row.id;
}

function viewportHost(dynamic: boolean): Type<unknown> {
  @Component({
    selector: 'vdnd-server-root',
    template: `
      <div vdndGroup="server">
        <vdnd-virtual-viewport
          vdndDroppable="list"
          [itemHeight]="50"
          [dynamicItemHeight]="dynamic"
          style="height: 200px"
        >
          <ng-container *vdndVirtualFor="let row of rows; trackBy: trackById">
            <div [vdndDraggable]="row.id" data-row>{{ row.id }}</div>
          </ng-container>
        </vdnd-virtual-viewport>
      </div>
      <vdnd-drag-preview />
    `,
    imports: [
      DroppableGroupDirective,
      VirtualViewportComponent,
      DroppableDirective,
      VirtualForDirective,
      DraggableDirective,
      DragPreviewComponent,
    ],
  })
  class ViewportHostComponent extends RowsHost {
    readonly dynamic = dynamic;
  }
  return ViewportHostComponent;
}

function contentHost(dynamic: boolean): Type<unknown> {
  @Component({
    selector: 'vdnd-server-root',
    template: `
      <div vdndScrollable style="height: 300px; overflow: auto">
        <vdnd-virtual-content [itemHeight]="50" [dynamicItemHeight]="dynamic">
          <div vdndContentHeader>Header</div>
          <ng-container *vdndVirtualFor="let row of rows; trackBy: trackById">
            <div data-row>{{ row.id }}</div>
          </ng-container>
        </vdnd-virtual-content>
      </div>
    `,
    imports: [
      ScrollableDirective,
      VirtualContentComponent,
      ContentHeaderDirective,
      VirtualForDirective,
    ],
  })
  class ContentHostComponent extends RowsHost {
    readonly dynamic = dynamic;
  }
  return ContentHostComponent;
}

function standaloneHost(dynamic: boolean): Type<unknown> {
  @Component({
    selector: 'vdnd-server-root',
    template: `
      <div vdndScrollable style="height: 300px; overflow: auto">
        <ng-container
          *vdndVirtualFor="
            let row of rows;
            trackBy: trackById;
            itemHeight: 50;
            dynamicItemHeight: dynamic
          "
        >
          <div data-row>{{ row.id }}</div>
        </ng-container>
      </div>
    `,
    imports: [ScrollableDirective, VirtualForDirective],
  })
  class StandaloneHostComponent extends RowsHost {
    readonly dynamic = dynamic;
  }
  return StandaloneHostComponent;
}

function scrollContainerHost(dynamic: boolean): Type<unknown> {
  @Component({
    selector: 'vdnd-server-root',
    template: `
      <ng-template #row let-row>
        <div data-row>{{ row.id }}</div>
      </ng-template>
      <vdnd-virtual-scroll
        [items]="rows"
        [itemHeight]="50"
        [containerHeight]="300"
        [dynamicItemHeight]="dynamic"
        [itemIdFn]="rowId"
        [itemTemplate]="row"
      />
    `,
    imports: [VirtualScrollContainerComponent],
  })
  class ScrollContainerHostComponent extends RowsHost {
    readonly dynamic = dynamic;
  }
  return ScrollContainerHostComponent;
}

function sortableListHost(dynamic: boolean): Type<unknown> {
  @Component({
    selector: 'vdnd-server-root',
    template: `
      <div vdndGroup="server">
        <vdnd-sortable-list
          droppableId="sortable"
          group="server"
          [items]="rows"
          [itemHeight]="50"
          [dynamicItemHeight]="dynamic"
          [containerHeight]="300"
          [itemIdFn]="rowId"
          [itemTemplate]="row"
        />
      </div>
      <ng-template #row let-row>
        <div [vdndDraggable]="row.id" data-row>{{ row.id }}</div>
      </ng-template>
    `,
    imports: [DroppableGroupDirective, VirtualSortableListComponent, DraggableDirective],
  })
  class SortableListHostComponent extends RowsHost {
    readonly dynamic = dynamic;
  }
  return SortableListHostComponent;
}

async function render(component: Type<unknown>): Promise<string> {
  const html = await renderApplication(
    (context) =>
      bootstrapApplication(
        component,
        {
          providers: [
            provideZonelessChangeDetection(),
            provideServerRendering(),
            provideClientHydration(),
          ],
        },
        context,
      ),
    { document: '<html><body><vdnd-server-root></vdnd-server-root></body></html>', url: '/' },
  );
  // renderApplication destroys the app in a timer after it resolves: let the teardown run inside
  // the test so an error thrown there fails it.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return html;
}

describe('Server rendering with renderApplication', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // Each bootstrap logs "Angular is running in development mode"
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs without a global document', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  describe.each([
    ['vdnd-virtual-viewport', viewportHost],
    ['vdnd-virtual-content (page scroll)', contentHost],
    ['*vdndVirtualFor in a vdndScrollable', standaloneHost],
    ['vdnd-virtual-scroll', scrollContainerHost],
    ['vdnd-sortable-list', sortableListHost],
  ])('%s', (_name, host) => {
    it.each([false, true])('renders its first rows (dynamicItemHeight %s)', async (dynamic) => {
      const html = await render(host(dynamic));

      const renderedRows = html.match(/data-row/g)?.length ?? 0;
      expect(renderedRows).toBeGreaterThan(0);
      expect(renderedRows).toBeLessThanOrEqual(ROW_COUNT);
      expect(html).toContain('row-0');
      expect(consoleError).not.toHaveBeenCalled();
    });
  });
});
