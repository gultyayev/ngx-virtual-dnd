import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  ContentHeaderDirective,
  DraggableDirective,
  DragPreviewComponent,
  DropEvent,
  DroppableDirective,
  DroppableGroupDirective,
  reorderItems,
  ScrollableDirective,
  VirtualContentComponent,
  VirtualForDirective,
} from 'ngx-virtual-dnd';

interface Task {
  id: string;
  title: string;
}

@Component({
  selector: 'app-page-scroll-example',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScrollableDirective,
    VirtualContentComponent,
    VirtualForDirective,
    ContentHeaderDirective,
    DraggableDirective,
    DroppableDirective,
    DroppableGroupDirective,
    DragPreviewComponent,
  ],
  template: `
    <!-- The element that scrolls: it needs a height and overflow: auto -->
    <div class="page" vdndScrollable>
      <div vdndGroup="today">
        <vdnd-virtual-content [itemHeight]="48" vdndDroppable="today" (drop)="onDrop($event)">
          <!-- Measured automatically, and scrolls together with the rows -->
          <h3 class="page-header" vdndContentHeader>Today</h3>

          <ng-container *vdndVirtualFor="let task of tasks(); trackBy: trackById">
            <div class="row" [vdndDraggable]="task.id">{{ task.title }}</div>
          </ng-container>
        </vdnd-virtual-content>
      </div>

      <footer class="page-footer">Regular content after the list</footer>
    </div>

    <vdnd-drag-preview />
  `,
})
export class PageScrollExampleComponent {
  readonly tasks = signal<Task[]>(
    Array.from({ length: 500 }, (_, i) => ({ id: `task-${i + 1}`, title: `Task ${i + 1}` })),
  );

  readonly trackById = (_index: number, task: Task): string => task.id;

  onDrop(event: DropEvent): void {
    reorderItems(event, this.tasks);
  }
}
