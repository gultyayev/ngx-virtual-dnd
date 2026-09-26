import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonCheckbox, IonContent, IonHeader, IonIcon, IonToolbar } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { reorderThree } from 'ionicons/icons';
import {
  ContentHeaderDirective,
  DraggableDirective,
  DragPreviewComponent,
  DropEvent,
  DroppableDirective,
  DroppableGroupDirective,
  insertAt,
  isNoOpDrop,
  removeAt,
  reorderItems,
  ScrollableDirective,
  VirtualContentComponent,
  VirtualForDirective,
} from 'ngx-virtual-dnd';
import { DragStateDebugComponent } from '../drag-state-debug/drag-state-debug';
import { TopBarComponent } from '../top-bar/top-bar';

interface DynamicTask {
  id: string;
  title: string;
  description: string;
  category: 'work' | 'personal' | 'urgent';
  done: boolean;
}

type CategoryFilter = 'all' | 'work' | 'personal' | 'urgent';

/** The `?count=` list size: a whole number from 1 to 1,000,000, else the default 150. */
function listSize(param: string | null): number {
  const count = Number(param);
  return Number.isInteger(count) && count >= 1 && count <= 1_000_000 ? count : 150;
}

@Component({
  selector: 'app-dynamic-height-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TopBarComponent,
    IonContent,
    IonHeader,
    IonToolbar,
    IonCheckbox,
    IonIcon,
    ScrollableDirective,
    VirtualForDirective,
    DraggableDirective,
    DroppableDirective,
    DroppableGroupDirective,
    DragPreviewComponent,
    VirtualContentComponent,
    ContentHeaderDirective,
    DragStateDebugComponent,
  ],
  styleUrl: './dynamic-height-demo.scss',
  templateUrl: './dynamic-height-demo.html',
})
export class DynamicHeightDemoComponent {
  // A conservative estimate at/below the shortest row (a title-only row is ~57px).
  // Keeping it a lower bound means freshly-rendered items only ever grow when measured,
  // never shrink — which avoids a transient height overshoot right after scrolling.
  readonly estimatedItemHeight = 56;

  readonly categories: { value: CategoryFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'work', label: 'Work' },
    { value: 'personal', label: 'Personal' },
    { value: 'urgent', label: 'Urgent' },
  ];

  // State
  readonly showBanner = signal(true);
  readonly category = signal<CategoryFilter>('all');
  // `?count=` sets the list size (the perf benchmarks use a long list)
  readonly tasks = signal<DynamicTask[]>(
    this.#generateTasks(listSize(inject(ActivatedRoute).snapshot.queryParamMap.get('count'))),
  );

  // Filtered tasks based on category
  readonly filteredTasks = computed(() => {
    const cat = this.category();
    const allTasks = this.tasks();
    if (cat === 'all') return allTasks;
    return allTasks.filter((t) => t.category === cat);
  });

  /** Count of open (not done) tasks, shown in the header summary. */
  readonly openCount = computed(() => this.tasks().filter((t) => !t.done).length);

  /** Per-category counts shown as chip badges. */
  readonly counts = computed(() => {
    const c: Record<CategoryFilter, number> = { all: 0, work: 0, personal: 0, urgent: 0 };
    for (const t of this.tasks()) {
      c.all++;
      c[t.category]++;
    }
    return c;
  });

  constructor() {
    addIcons({ reorderThree });
  }

  trackById = (_index: number, task: DynamicTask): string => task.id;

  setCategory(cat: CategoryFilter): void {
    this.category.set(cat);
  }

  dismissBanner(): void {
    this.showBanner.set(false);
  }

  toggleTask(task: DynamicTask): void {
    this.tasks.update((tasks) =>
      tasks.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)),
    );
  }

  addTask(): void {
    const newTask: DynamicTask = {
      id: `task-${Date.now()}`,
      title: `New Task ${this.tasks().length + 1}`,
      description: '',
      category: 'personal',
      done: false,
    };
    this.tasks.update((tasks) => [...tasks, newTask]);
  }

  onDrop(event: DropEvent): void {
    if (isNoOpDrop(event)) {
      return;
    }

    const cat = this.category();
    if (cat === 'all') {
      reorderItems(event, this.tasks);
      return;
    }

    this.tasks.update((tasks) => {
      const matchesFilter = (task: DynamicTask): boolean => task.category === cat;

      const visibleTasks = tasks.filter(matchesFilter);
      const item = visibleTasks[event.source.index];
      if (!item) {
        return tasks;
      }

      const nextVisibleTasks = insertAt(
        removeAt(visibleTasks, event.source.index),
        item,
        event.destination.index,
      );

      let visibleIndex = 0;
      return tasks.map((task) => (matchesFilter(task) ? nextVisibleTasks[visibleIndex++]! : task));
    });
  }

  #generateTasks(count: number): DynamicTask[] {
    const categories: DynamicTask['category'][] = ['work', 'personal', 'urgent'];
    const taskNames = [
      'Review quarterly report',
      'Schedule team meeting',
      'Update project documentation',
      'Respond to client emails',
      'Prepare presentation slides',
      'Fix critical bug',
      'Code review for PR',
      'Update dependencies',
      'Write unit tests',
      'Deploy to staging',
      'Call with stakeholders',
      'Plan sprint backlog',
      'Research new framework',
      'Optimize database queries',
      'Create API documentation',
      'Set up CI/CD pipeline',
      'Review security audit',
      'Update user guide',
      'Mentor junior developer',
      'Attend standup meeting',
    ];

    const descriptions = [
      '', // Pattern 0: no description (~56px)
      'Quick follow-up needed by end of day.', // Pattern 1: short (~72px)
      'Review the latest changes and provide feedback to the team. Make sure to check for edge cases.', // Pattern 2: medium (~88px)
      'This task requires coordination with multiple teams. Set up a meeting to discuss the approach and timeline. Document all decisions made.', // Pattern 3: longer (~104px)
      'Comprehensive review needed including all documentation updates, code changes, and test coverage. Ensure backward compatibility is maintained and all stakeholders are notified of the changes before deployment.', // Pattern 4: long (~120px)
    ];

    return Array.from({ length: count }, (_, i) => ({
      id: `task-${i}`,
      title: `${taskNames[i % taskNames.length]} #${Math.floor(i / taskNames.length) + 1}`,
      description: descriptions[i % 5],
      category: categories[i % 3],
      done: i % 7 === 0,
    }));
  }
}
