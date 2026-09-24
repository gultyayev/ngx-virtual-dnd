import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  DragPreviewComponent,
  DraggableDirective,
  DropEvent,
  DroppableGroupDirective,
  reorderItems,
  VirtualSortableListComponent,
} from 'ngx-virtual-dnd';

interface Note {
  id: string;
  title: string;
  body: string;
}

const SENTENCE = 'Rows are measured with a ResizeObserver as they render. ';

@Component({
  selector: 'app-dynamic-height-example',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    VirtualSortableListComponent,
    DroppableGroupDirective,
    DraggableDirective,
    DragPreviewComponent,
  ],
  template: `
    <div vdndGroup="notes">
      <ng-template #noteTpl let-note>
        <div class="row note" [vdndDraggable]="note.id">
          <span class="note-title">{{ note.title }}</span>
          <span class="note-body">{{ note.body }}</span>
        </div>
      </ng-template>

      <!-- itemHeight is only the estimate for rows that have not been measured yet -->
      <vdnd-sortable-list
        class="list"
        droppableId="notes"
        [items]="notes()"
        [itemHeight]="72"
        [dynamicItemHeight]="true"
        [containerHeight]="336"
        [itemIdFn]="noteId"
        [itemTemplate]="noteTpl"
        (drop)="onDrop($event)"
      />
    </div>

    <vdnd-drag-preview />
  `,
})
export class DynamicHeightExampleComponent {
  readonly notes = signal<Note[]>(
    Array.from({ length: 500 }, (_, i) => ({
      id: `note-${i + 1}`,
      title: `Note ${i + 1}`,
      body: SENTENCE.repeat((i % 4) + 1).trim(),
    })),
  );

  readonly noteId = (note: Note): string => note.id;

  onDrop(event: DropEvent): void {
    reorderItems(event, this.notes);
  }
}
