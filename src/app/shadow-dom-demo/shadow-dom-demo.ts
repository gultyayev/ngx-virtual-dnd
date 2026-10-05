import { ChangeDetectionStrategy, Component, signal, ViewEncapsulation } from '@angular/core';
import {
  DraggableDirective,
  DragPreviewComponent,
  DropEvent,
  DroppableDirective,
  DroppableGroupDirective,
  moveItem,
  VirtualSortableListComponent,
} from 'ngx-virtual-dnd';
import { DragStateDebugComponent } from '../drag-state-debug/drag-state-debug';

interface Task {
  id: string;
  title: string;
}

const createTasks = (prefix: string, label: string, count: number): Task[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    title: `${label} ${i + 1}`,
  }));

/**
 * Two sortable lists and the drag preview, rendered inside the component's open shadow root
 * (`ViewEncapsulation.ShadowDom`). Page styles don't reach into it, so it styles its own rows.
 * Below them, two fixed-height lists stacked in a scroller of the shadow root: scrolling it moves
 * the lists without resizing them.
 */
@Component({
  selector: 'app-shadow-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.ShadowDom,
  imports: [
    VirtualSortableListComponent,
    DroppableDirective,
    DroppableGroupDirective,
    DraggableDirective,
    DragPreviewComponent,
  ],
  template: `
    <div class="board" vdndGroup="shadow">
      <ng-template #taskTpl let-task>
        <div class="row" [vdndDraggable]="task.id" [vdndDraggableData]="task">
          <span class="row-inner">{{ task.title }}</span>
        </div>
      </ng-template>

      <section class="column">
        <h2>
          To do <span class="badge" data-testid="shadow-todo-count">{{ todo().length }}</span>
        </h2>
        <vdnd-sortable-list
          class="list"
          droppableId="shadow-todo"
          [items]="todo()"
          [itemHeight]="48"
          [containerHeight]="288"
          [itemIdFn]="taskId"
          [itemTemplate]="taskTpl"
          (drop)="onDrop($event)"
        />
      </section>

      <section class="column">
        <h2>
          Done <span class="badge" data-testid="shadow-done-count">{{ done().length }}</span>
        </h2>
        <vdnd-sortable-list
          class="list"
          droppableId="shadow-done"
          [items]="done()"
          [itemHeight]="48"
          [containerHeight]="288"
          [itemIdFn]="taskId"
          [itemTemplate]="taskTpl"
          (drop)="onDrop($event)"
        />
      </section>
    </div>

    <div class="stack" data-testid="shadow-stack-scroller" vdndGroup="shadow-stack">
      @for (stack of stacks; track stack.id) {
        <section class="stack-list" [vdndDroppable]="stack.id" (drop)="onStackDrop($event)">
          <h2>
            {{ stack.title }}
            <span class="badge" [attr.data-testid]="stack.id + '-count'">{{
              stack.items().length
            }}</span>
          </h2>
          @for (task of stack.items(); track task.id) {
            <div class="row" [vdndDraggable]="task.id" [vdndDraggableData]="task">
              <span class="row-inner">{{ task.title }}</span>
            </div>
          }
        </section>
      }
    </div>

    <vdnd-drag-preview />
  `,
  styles: `
    :host {
      display: block;
      font-family: var(--font-sans);
    }

    .board {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 20px;
    }

    .column {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 15px;
      box-shadow: var(--shadow-sm);
      overflow: hidden;
    }

    h2 {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 0;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      font-size: 15px;
      font-weight: 700;
      color: var(--ink);
    }

    .badge {
      min-width: 26px;
      padding: 2px 9px;
      font-size: 12.5px;
      text-align: center;
      color: var(--accent-text);
      background: var(--accent-soft);
      border-radius: 999px;
    }

    .list {
      background: var(--bg-sunk);
      transition: box-shadow 0.15s;
    }

    .list.vdnd-droppable-active {
      background: var(--accent-soft);
      box-shadow: inset 0 0 0 1.5px var(--accent-soft-bd);
    }

    .stack {
      height: 240px;
      margin-top: 20px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: 15px;
      background: var(--surface);
    }

    .stack-list {
      height: 240px;
      box-sizing: border-box;
      border-bottom: 1px solid var(--border);
      background: var(--bg-sunk);
    }

    .stack-list.vdnd-droppable-active {
      background: var(--accent-soft);
    }

    .row {
      height: 48px;
      box-sizing: border-box;
      padding: 3px 8px;
      cursor: grab;
    }

    .row:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }

    .row-inner {
      height: 100%;
      display: flex;
      align-items: center;
      padding: 0 14px;
      font-size: var(--row-fs);
      font-weight: 500;
      color: var(--ink);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
  `,
})
export class ShadowBoardComponent {
  readonly todo = signal<Task[]>(createTasks('shadow-todo', 'Task', 50));
  readonly done = signal<Task[]>(createTasks('shadow-done', 'Done', 50));

  readonly stacks = [
    { id: 'stack-a', title: 'Stack A', items: signal<Task[]>(createTasks('stack-a', 'A', 3)) },
    { id: 'stack-b', title: 'Stack B', items: signal<Task[]>(createTasks('stack-b', 'B', 3)) },
  ];

  readonly taskId = (task: Task): string => task.id;

  onDrop(event: DropEvent): void {
    moveItem(event, { 'shadow-todo': this.todo, 'shadow-done': this.done });
  }

  onStackDrop(event: DropEvent): void {
    moveItem(event, { 'stack-a': this.stacks[0].items, 'stack-b': this.stacks[1].items });
  }
}

/** E2E fixture: lists, items and the drag preview inside an open shadow root. */
@Component({
  selector: 'app-shadow-dom-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ShadowBoardComponent, DragStateDebugComponent],
  template: `
    <main class="sdd">
      <h1 class="sdd-title">Shadow DOM</h1>
      <p class="sdd-hint">
        Both lists, their rows and the drag preview render inside a component with
        <code>ViewEncapsulation.ShadowDom</code>.
      </p>
      <app-shadow-board />
    </main>

    <app-drag-state-debug />
  `,
  styles: `
    .sdd {
      max-width: 760px;
      margin: 0 auto;
      padding: 32px 16px;
    }

    .sdd-title {
      margin: 0 0 8px;
      font-size: 30px;
      font-weight: 700;
      letter-spacing: -0.025em;
      color: var(--ink);
    }

    .sdd-hint {
      margin: 0 0 24px;
      font-size: 13.5px;
      color: var(--ink-2);
    }

    .sdd-hint code {
      font-family: var(--font-mono);
      font-size: 12.5px;
    }
  `,
})
export class ShadowDomDemoComponent {}
