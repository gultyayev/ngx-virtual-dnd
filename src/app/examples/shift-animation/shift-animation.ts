import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  DragPreviewComponent,
  DraggableDirective,
  DropEvent,
  DroppableGroupDirective,
  PlaceholderMoveEvent,
  reorderItems,
  VDND_ANIMATION_CONFIG,
  VirtualSortableListComponent,
} from 'ngx-virtual-dnd';

interface Task {
  id: string;
  title: string;
}

@Component({
  selector: 'app-shift-animation-example',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    VirtualSortableListComponent,
    DroppableGroupDirective,
    DraggableDirective,
    DragPreviewComponent,
  ],
  // Lists in this component slide displaced rows instead of snapping them into place
  providers: [{ provide: VDND_ANIMATION_CONFIG, useValue: { shiftDuration: 200 } }],
  template: `
    <p class="status">
      Placeholder moves: <strong data-placeholder-moves>{{ moves() }}</strong>
      @if (lastMove(); as move) {
        · last <strong>{{ move.previousIndex ?? 'entered' }} → {{ move.currentIndex }}</strong>
      }
    </p>

    <div vdndGroup="tasks">
      <ng-template #taskTpl let-task>
        <div class="row" [vdndDraggable]="task.id">{{ task.title }}</div>
      </ng-template>

      <vdnd-sortable-list
        class="list"
        droppableId="tasks"
        [items]="tasks()"
        [itemHeight]="48"
        [containerHeight]="288"
        [itemIdFn]="taskId"
        [itemTemplate]="taskTpl"
        (drop)="onDrop($event)"
        (placeholderMove)="onPlaceholderMove($event)"
      />
    </div>

    <vdnd-drag-preview />
  `,
})
export class ShiftAnimationExampleComponent {
  readonly tasks = signal<Task[]>(
    Array.from({ length: 500 }, (_, i) => ({ id: `task-${i + 1}`, title: `Task ${i + 1}` })),
  );

  readonly moves = signal(0);
  readonly lastMove = signal<PlaceholderMoveEvent | null>(null);

  readonly taskId = (task: Task): string => task.id;

  onPlaceholderMove(event: PlaceholderMoveEvent): void {
    // One event per displacement: a good place for haptic feedback
    navigator.vibrate?.(10);
    this.moves.update((count) => count + 1);
    this.lastMove.set(event);
  }

  onDrop(event: DropEvent): void {
    reorderItems(event, this.tasks);
  }
}
