import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  DragPreviewComponent,
  DraggableDirective,
  DropEvent,
  DroppableGroupDirective,
  reorderItems,
  VirtualSortableListComponent,
} from 'ngx-virtual-dnd';

interface Track {
  id: string;
  title: string;
}

@Component({
  selector: 'app-drag-handle-example',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    VirtualSortableListComponent,
    DroppableGroupDirective,
    DraggableDirective,
    DragPreviewComponent,
  ],
  template: `
    <div vdndGroup="playlist">
      <ng-template #trackTpl let-track>
        <!-- Only presses inside [data-drag-handle] start a drag; the rest of the row stays selectable -->
        <div class="row with-handle" [vdndDraggable]="track.id" dragHandle="[data-drag-handle]">
          <span class="handle" data-drag-handle aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.6" />
              <circle cx="15" cy="6" r="1.6" />
              <circle cx="9" cy="12" r="1.6" />
              <circle cx="15" cy="12" r="1.6" />
              <circle cx="9" cy="18" r="1.6" />
              <circle cx="15" cy="18" r="1.6" />
            </svg>
          </span>
          <span>{{ track.title }}</span>
        </div>
      </ng-template>

      <vdnd-sortable-list
        class="list"
        droppableId="playlist"
        [items]="tracks()"
        [itemHeight]="48"
        [containerHeight]="336"
        [itemIdFn]="trackId"
        [itemTemplate]="trackTpl"
        (drop)="onDrop($event)"
      />
    </div>

    <vdnd-drag-preview />
  `,
})
export class DragHandleExampleComponent {
  readonly tracks = signal<Track[]>(
    Array.from({ length: 300 }, (_, i) => ({ id: `track-${i + 1}`, title: `Track ${i + 1}` })),
  );

  readonly trackId = (track: Track): string => track.id;

  onDrop(event: DropEvent): void {
    reorderItems(event, this.tracks);
  }
}
