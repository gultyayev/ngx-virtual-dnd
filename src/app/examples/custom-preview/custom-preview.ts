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
  selector: 'app-custom-preview-example',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    VirtualSortableListComponent,
    DroppableGroupDirective,
    DraggableDirective,
    DragPreviewComponent,
  ],
  template: `
    <div vdndGroup="tasks">
      <ng-template #taskTpl let-task>
        <!-- vdndDraggableData is what the preview template receives -->
        <div class="row" [vdndDraggable]="task.id" [vdndDraggableData]="task">
          {{ task.title }}
        </div>
      </ng-template>

      <vdnd-sortable-list
        class="list"
        droppableId="tasks"
        [items]="tasks()"
        [itemHeight]="48"
        [containerHeight]="336"
        [itemIdFn]="taskId"
        [itemTemplate]="taskTpl"
        (drop)="onDrop($event)"
      />
    </div>

    <!-- Rendered instead of a clone of the row. Style it globally: it lives under <body> -->
    <ng-template #preview let-task>
      <div class="preview-card">
        Moving <strong>{{ task.title }}</strong>
      </div>
    </ng-template>

    <vdnd-drag-preview [previewTemplate]="preview" />
  `,
})
export class CustomPreviewExampleComponent {
  readonly tasks = signal<Task[]>(
    Array.from({ length: 1000 }, (_, i) => ({ id: `task-${i + 1}`, title: `Task ${i + 1}` })),
  );

  readonly taskId = (task: Task): string => task.id;

  onDrop(event: DropEvent): void {
    reorderItems(event, this.tasks);
  }
}
