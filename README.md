# ngx-virtual-dnd

Angular drag and drop for virtual scrolling. Sortable lists and boards that stay fast with thousands of items: only the visible rows are rendered, and drag and drop still works across all of them.

**[Documentation](https://gultyayev.github.io/ngx-virtual-dnd/)** · **[Live demo](https://gultyayev.github.io/ngx-virtual-dnd/demo/)** · **[Changelog](https://gultyayev.github.io/ngx-virtual-dnd/changelog.html)**

## Features

- Virtual scrolling with fixed or dynamic (auto-measured) item heights
- Drag between multiple lists, with edge auto-scroll
- Page-level scrolling, including Ionic `ion-content`
- Drag handles, delays, axis locking, container constraints, custom previews
- Opt-in shift animations, plus a per-step event for haptics
- Keyboard dragging and touch support
- Angular 21+: standalone components and signals

## Installation

```bash
npm install ngx-virtual-dnd
```

## Example

```typescript
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
  selector: 'app-tasks',
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
        <div class="row" [vdndDraggable]="task.id">{{ task.title }}</div>
      </ng-template>

      <vdnd-sortable-list
        droppableId="backlog"
        [items]="tasks()"
        [itemHeight]="48"
        [containerHeight]="400"
        [itemIdFn]="taskId"
        [itemTemplate]="taskTpl"
        (drop)="onDrop($event)"
      />
    </div>

    <vdnd-drag-preview />
  `,
})
export class TasksComponent {
  readonly tasks = signal<Task[]>(
    Array.from({ length: 1000 }, (_, i) => ({ id: `task-${i + 1}`, title: `Task ${i + 1}` })),
  );

  readonly taskId = (task: Task): string => task.id;

  onDrop(event: DropEvent): void {
    reorderItems(event, this.tasks);
  }
}
```

Every draggable and droppable needs a group (here from `vdndGroup`), even for a single list, and the item template must be declared inside it. The [Quick start](https://gultyayev.github.io/ngx-virtual-dnd/guide/start/quick-start.html) explains each part, and [Core concepts](https://gultyayev.github.io/ngx-virtual-dnd/guide/essentials/core-concepts.html) lists the rules that keep a setup working.

## Documentation

- [Getting started](https://gultyayev.github.io/ngx-virtual-dnd/guide/start/introduction.html): introduction, installation, quick start
- [Guides](https://gultyayev.github.io/ngx-virtual-dnd/guide/essentials/core-concepts.html): multiple lists, dynamic heights, page scroll, drag behavior, styling, accessibility
- [API reference](https://gultyayev.github.io/ngx-virtual-dnd/api/components.html): components, directives, events, utilities, services, types

## AI agent skills

Install a skill that teaches AI coding assistants how to integrate this library:

```bash
npx skills add gultyayev/ngx-virtual-dnd
```

It works with Claude Code, Cursor, Windsurf, GitHub Copilot and [40+ other agents](https://skills.sh). The docs are also published as [llms.txt](https://gultyayev.github.io/ngx-virtual-dnd/llms.txt).

## Development

Requires npm 12 (the version pinned in `packageManager`): `npm install -g npm@12`.

```bash
npm start              # Demo app (localhost:4200)
npm run build:lib      # Build the library (required after library edits)
npm run docs:dev       # Docs site (localhost:3000); live examples load from the demo on :4200
npm test               # Unit tests
npm run e2e            # E2E tests
npm run site:build     # Full GitHub Pages build: docs at /, demo at /demo/
```

## License

MIT
