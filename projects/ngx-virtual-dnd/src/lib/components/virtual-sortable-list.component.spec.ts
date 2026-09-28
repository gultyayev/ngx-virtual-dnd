import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VirtualSortableListComponent } from './virtual-sortable-list.component';
import { DragStateService } from '../services/drag-state.service';
import {
  DraggedItem,
  DropEvent,
  END_OF_LIST,
  PlaceholderMoveEvent,
} from '../models/drag-drop.models';

interface Item {
  id: string;
}

const ITEMS: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

// Does not listen to placeholderMove: a placeholder move must not re-render it
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span data-testid="renders">{{ countRender() }}</span>
    <vdnd-sortable-list
      droppableId="list"
      group="g"
      [items]="items"
      [itemHeight]="50"
      [containerHeight]="200"
      [itemIdFn]="getId"
      [itemTemplate]="tpl"
    />
    <ng-template #tpl let-item>
      <div [attr.data-draggable-id]="item.id">{{ item.id }}</div>
    </ng-template>
  `,
  imports: [VirtualSortableListComponent],
})
class SilentHostComponent {
  items = ITEMS;
  renders = 0;
  getId = (item: Item): string => item.id;

  countRender(): number {
    return ++this.renders;
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <vdnd-sortable-list
      droppableId="list"
      group="g"
      [items]="items"
      [itemHeight]="50"
      [containerHeight]="200"
      [itemIdFn]="getId"
      [itemTemplate]="tpl"
      (drop)="drops.push($event)"
      (placeholderMove)="moves.push($event)"
    />
    <ng-template #tpl let-item>
      <div [attr.data-draggable-id]="item.id">{{ item.id }}</div>
    </ng-template>
  `,
  imports: [VirtualSortableListComponent],
})
class ListeningHostComponent {
  items = ITEMS;
  drops: DropEvent[] = [];
  moves: PlaceholderMoveEvent[] = [];
  getId = (item: Item): string => item.id;
}

describe('VirtualSortableListComponent', () => {
  let dragState: DragStateService;

  const draggedItem = (): DraggedItem => ({
    draggableId: 'a',
    droppableId: 'list',
    element: document.createElement('div'),
    height: 50,
    width: 200,
    data: ITEMS[0],
  });

  /** Same-list drag of item `a` (index 0), placeholder in its own slot. */
  const startDrag = (fixture: ComponentFixture<unknown>): void => {
    dragState.startDrag(
      draggedItem(),
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      null,
      'list',
      END_OF_LIST,
      1,
      0,
    );
    fixture.detectChanges();
  };

  const movePlaceholder = (fixture: ComponentFixture<unknown>, placeholderIndex: number): void => {
    dragState.updateDragPosition({
      cursorPosition: { x: 0, y: 0 },
      activeDroppableId: 'list',
      placeholderId: END_OF_LIST,
      placeholderIndex,
    });
    fixture.detectChanges();
  };

  beforeEach(() => {
    dragState = TestBed.inject(DragStateService);
  });

  afterEach(() => dragState.endDrag());

  it('does not re-render a host that does not listen to placeholderMove', () => {
    const fixture = TestBed.createComponent(SilentHostComponent);
    fixture.detectChanges();
    startDrag(fixture);
    const rendersBefore = fixture.componentInstance.renders;

    movePlaceholder(fixture, 3);
    movePlaceholder(fixture, 4);

    expect(fixture.componentInstance.renders).toBe(rendersBefore);
    fixture.destroy();
  });

  it('forwards placeholderMove and drop to a listening host', () => {
    const fixture = TestBed.createComponent(ListeningHostComponent);
    fixture.detectChanges();
    startDrag(fixture);

    movePlaceholder(fixture, 3);
    dragState.endDrag();

    const host = fixture.componentInstance;
    expect(host.moves.map((e) => [e.previousIndex, e.currentIndex])).toEqual([[0, 2]]);
    expect(host.drops.length).toBe(1);
    expect(host.drops[0].source).toEqual(
      expect.objectContaining({ draggableId: 'a', droppableId: 'list', index: 0 }),
    );
    expect(host.drops[0].destination).toEqual(
      expect.objectContaining({ droppableId: 'list', index: 2 }),
    );
    fixture.destroy();
  });

  it('stops forwarding once destroyed', () => {
    const fixture = TestBed.createComponent(ListeningHostComponent);
    fixture.detectChanges();
    startDrag(fixture);
    movePlaceholder(fixture, 3);
    const host = fixture.componentInstance;

    fixture.destroy();
    dragState.endDrag();

    expect(host.moves.length).toBe(1);
    expect(host.drops).toEqual([]);
  });
});
