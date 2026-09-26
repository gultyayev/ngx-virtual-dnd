import { Component, PLATFORM_ID, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ContentHeaderDirective } from './directives/content-header.directive';
import { DraggableDirective } from './directives/draggable.directive';
import { DroppableDirective } from './directives/droppable.directive';
import { DroppableGroupDirective } from './directives/droppable-group.directive';
import { ScrollableDirective } from './directives/scrollable.directive';
import { VirtualForDirective } from './directives/virtual-for.directive';
import { VirtualContentComponent } from './components/virtual-content.component';
import { VirtualScrollContainerComponent } from './components/virtual-scroll-container.component';
import { VirtualViewportComponent } from './components/virtual-viewport.component';
import { DragPreviewComponent } from './components/drag-preview.component';

interface Row {
  id: string;
}

const rows: Row[] = Array.from({ length: 20 }, (_, i) => ({ id: `row-${i}` }));

@Component({
  template: `
    <div vdndGroup="server">
      <vdnd-virtual-viewport
        vdndDroppable="viewport-list"
        [itemHeight]="50"
        [dynamicItemHeight]="true"
        style="height: 200px"
      >
        <ng-container *vdndVirtualFor="let row of rows; trackBy: trackById">
          <div [vdndDraggable]="row.id">{{ row.id }}</div>
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
class ViewportHostComponent {
  readonly rows = rows;
  readonly trackById = (_index: number, row: Row): string => row.id;
}

@Component({
  template: `
    <div vdndScrollable style="height: 300px; overflow: auto">
      <vdnd-virtual-content [itemHeight]="50" [dynamicItemHeight]="true">
        <div vdndContentHeader>Header</div>
        <ng-container *vdndVirtualFor="let row of rows; trackBy: trackById">
          <div [attr.data-row]="row.id">{{ row.id }}</div>
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
class PageScrollHostComponent {
  readonly rows = rows;
  readonly trackById = (_index: number, row: Row): string => row.id;
}

@Component({
  template: `
    <div vdndScrollable style="height: 300px; overflow: auto">
      <ng-container
        *vdndVirtualFor="
          let row of rows;
          trackBy: trackById;
          itemHeight: 50;
          dynamicItemHeight: true
        "
      >
        <div [attr.data-row]="row.id">{{ row.id }}</div>
      </ng-container>
    </div>
  `,
  imports: [ScrollableDirective, VirtualForDirective],
})
class StandaloneVirtualForHostComponent {
  readonly rows = rows;
  readonly trackById = (_index: number, row: Row): string => row.id;
}

@Component({
  template: `
    <ng-template #row let-row>
      <div [attr.data-row]="row.id">{{ row.id }}</div>
    </ng-template>
    <vdnd-virtual-scroll
      [items]="rows"
      [itemHeight]="50"
      [containerHeight]="300"
      [dynamicItemHeight]="true"
      [itemIdFn]="rowId"
      [itemTemplate]="row"
    />
  `,
  imports: [VirtualScrollContainerComponent],
})
class VirtualScrollHostComponent {
  readonly rows = rows;
  readonly rowId = (row: Row): string => row.id;
}

/**
 * Server rendering (Angular SSR) creates the components with PLATFORM_ID 'server', where
 * browser-only APIs such as ResizeObserver do not exist. Rendering must not throw there.
 */
describe('Server rendering', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    // jsdom has no ResizeObserver either, as on the server
    expect(typeof ResizeObserver).toBe('undefined');
    consoleError = jest.spyOn(console, 'error');
    // Layout reads have nothing to read on the server (Angular itself schedules with
    // requestAnimationFrame here, so that one can't be banned the same way)
    jest.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      throw new Error('getComputedStyle called during server rendering');
    });
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const render = (host: Type<unknown>): HTMLElement => {
    const fixture = TestBed.createComponent(host);
    fixture.detectChanges();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    fixture.destroy();
    return element;
  };

  it.each([
    ['vdnd-virtual-viewport with *vdndVirtualFor and draggables', ViewportHostComponent],
    ['vdnd-virtual-content with a header', PageScrollHostComponent],
    ['*vdndVirtualFor directly in a vdndScrollable', StandaloneVirtualForHostComponent],
    ['vdnd-virtual-scroll', VirtualScrollHostComponent],
  ])('should render %s with dynamic heights without errors', (_name, host) => {
    expect(() => render(host)).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('should render the rows', () => {
    const fixture = TestBed.createComponent(StandaloneVirtualForHostComponent);
    fixture.detectChanges();

    expect(fixture.debugElement.queryAll(By.css('[data-row]')).length).toBeGreaterThan(0);
    fixture.destroy();
  });

  it('should not add nodes of its own to the server-rendered markup', () => {
    const fixture = TestBed.createComponent(StandaloneVirtualForHostComponent);
    fixture.detectChanges();

    // Nodes outside the templates would not match the client's DOM during hydration
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.vdnd-virtual-for-spacer')).toBeNull();
    fixture.destroy();
  });
});
