import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  DragPreviewComponent,
  DraggableDirective,
  DropEvent,
  DroppableGroupDirective,
  reorderItems,
  VirtualSortableListComponent,
} from 'ngx-virtual-dnd';

interface Task {
  id: string;
  title: string;
}

@Component({
  selector: 'app-quick-start-example',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    VirtualSortableListComponent,
    DroppableGroupDirective,
    DraggableDirective,
    DragPreviewComponent,
  ],
  template: `
    <div vdndGroup="tasks">
      <!-- Declared inside vdndGroup, so every draggable inherits the group -->
      <ng-template #taskTpl let-task>
        <div class="row" [vdndDraggable]="task.id">{{ task.title }}</div>
      </ng-template>

      <vdnd-sortable-list
        class="list"
        droppableId="backlog"
        [items]="tasks()"
        [itemHeight]="48"
        [containerHeight]="336"
        [itemIdFn]="taskId"
        [itemTemplate]="taskTpl"
        (drop)="onDrop($event)"
      />
    </div>

    <!-- Renders the element that follows the pointer. Place it once. -->
    <vdnd-drag-preview />
  `,
})
export class QuickStartExampleComponent {
  // 1,000 items; only the visible rows are in the DOM.
  readonly tasks = signal<Task[]>(
    Array.from({ length: 1000 }, (_, i) => ({ id: `task-${i + 1}`, title: `Task ${i + 1}` })),
  );

  readonly taskId = (task: Task): string => task.id;

  onDrop(event: DropEvent): void {
    reorderItems(event, this.tasks);
  }
}
