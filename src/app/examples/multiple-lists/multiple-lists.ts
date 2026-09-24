import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  DragPreviewComponent,
  DraggableDirective,
  DropEvent,
  DroppableGroupDirective,
  moveItem,
  VirtualSortableListComponent,
} from 'ngx-virtual-dnd';

interface Task {
  id: string;
  title: string;
}

const createTasks = (prefix: string, count: number): Task[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    title: `${prefix === 'todo' ? 'Task' : 'Done'} ${i + 1}`,
  }));

@Component({
  selector: 'app-multiple-lists-example',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    VirtualSortableListComponent,
    DroppableGroupDirective,
    DraggableDirective,
    DragPreviewComponent,
  ],
  template: `
    <!-- Both lists share the "board" group, so items can move between them -->
    <div class="board" vdndGroup="board">
      <ng-template #taskTpl let-task>
        <div class="row" [vdndDraggable]="task.id">{{ task.title }}</div>
      </ng-template>

      <section class="column">
        <h3>
          To do <span>{{ todo().length }}</span>
        </h3>
        <vdnd-sortable-list
          class="list"
          droppableId="todo"
          [items]="todo()"
          [itemHeight]="48"
          [containerHeight]="288"
          [itemIdFn]="taskId"
          [itemTemplate]="taskTpl"
          (drop)="onDrop($event)"
        />
      </section>

      <section class="column">
        <h3>
          Done <span>{{ done().length }}</span>
        </h3>
        <vdnd-sortable-list
          class="list"
          droppableId="done"
          [items]="done()"
          [itemHeight]="48"
          [containerHeight]="288"
          [itemIdFn]="taskId"
          [itemTemplate]="taskTpl"
          (drop)="onDrop($event)"
        />
      </section>
    </div>

    <vdnd-drag-preview />
  `,
})
export class MultipleListsExampleComponent {
  readonly todo = signal<Task[]>(createTasks('todo', 200));
  readonly done = signal<Task[]>(createTasks('done', 200));

  readonly taskId = (task: Task): string => task.id;

  // (drop) fires on the destination list only, so both lists bind it.
  onDrop(event: DropEvent): void {
    moveItem(event, { todo: this.todo, done: this.done });
  }
}
