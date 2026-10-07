import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonCheckbox, IonContent, IonHeader, IonIcon, IonToolbar } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { reorderThree } from 'ionicons/icons';
import {
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

interface Task {
  id: string;
  title: string;
  category: 'work' | 'personal' | 'urgent';
  done: boolean;
}

type CategoryFilter = 'all' | 'work' | 'personal' | 'urgent';

/**
 * Demo showing page-level scroll with header/footer and virtual list.
 *
 * Architecture:
 * - ion-content with scrollY=false (disabled native scroll)
 * - Custom scroll container with ion-content-scroll-host class
 * - vdndScrollable directive on the scroll container
 * - OffsetScrollAdapter wrapping the virtual list to account for header height
 *
 * E2E fixture flags: `?sticky=true` pins the header and the "Add task" button inside the scroll
 * container and passes their heights as the container's scroll insets; `?constrain=true` keeps
 * the drag inside the container (`constrainToContainer`).
 */
@Component({
  selector: 'app-page-scroll-demo',
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
    DragStateDebugComponent,
  ],
  styleUrl: './page-scroll-demo.scss',
  templateUrl: './page-scroll-demo.html',
})
export class PageScrollDemoComponent implements OnDestroy {
  readonly itemHeight = 72;

  readonly categories: { value: CategoryFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'work', label: 'Work' },
    { value: 'personal', label: 'Personal' },
    { value: 'urgent', label: 'Urgent' },
  ];

  readonly #queryParams = inject(ActivatedRoute).snapshot.queryParamMap;

  /** Header and "Add task" button pinned inside the scroll container (`?sticky=true`) */
  readonly sticky = this.#queryParams.get('sticky') === 'true';

  /** Drag kept inside the scroll container (`?constrain=true`) */
  readonly constrain = this.#queryParams.get('constrain') === 'true';

  // View queries
  readonly headerElement = viewChild.required<ElementRef<HTMLElement>>('headerElement');
  readonly footerElement = viewChild.required<ElementRef<HTMLElement>>('footerElement');

  // State
  readonly showBanner = signal(true);
  readonly category = signal<CategoryFilter>('all');
  readonly tasks = signal<Task[]>(this.#generateTasks(150));

  // Header height for offset calculation
  readonly headerHeight = signal(0);

  // "Add task" button height, the space it covers at the bottom when pinned
  readonly footerHeight = signal(0);

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

  #resizeObserver: ResizeObserver | null = null;

  constructor() {
    addIcons({ reorderThree });

    // Set up header and footer height tracking after render
    afterNextRender(() => {
      const headerEl = this.headerElement().nativeElement;
      const footerEl = this.footerElement().nativeElement;
      this.headerHeight.set(headerEl.offsetHeight);
      this.footerHeight.set(footerEl.offsetHeight);

      this.#resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          // Use borderBoxSize to avoid layout thrashing in Safari
          const height =
            entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight;
          (entry.target === headerEl ? this.headerHeight : this.footerHeight).set(height);
        }
      });
      this.#resizeObserver.observe(headerEl);
      this.#resizeObserver.observe(footerEl);
    });
  }

  ngOnDestroy(): void {
    this.#resizeObserver?.disconnect();
  }

  trackById = (_index: number, task: Task): string => task.id;

  setCategory(cat: CategoryFilter): void {
    this.category.set(cat);
  }

  dismissBanner(): void {
    this.showBanner.set(false);
  }

  toggleTask(task: Task): void {
    this.tasks.update((tasks) =>
      tasks.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)),
    );
  }

  addTask(): void {
    const newTask: Task = {
      id: `task-${Date.now()}`,
      title: `New Task ${this.tasks().length + 1}`,
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
      const matchesFilter = (task: Task): boolean => task.category === cat;

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

  #generateTasks(count: number): Task[] {
    const categories: Task['category'][] = ['work', 'personal', 'urgent'];
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

    return Array.from({ length: count }, (_, i) => ({
      id: `task-${i}`,
      title: `${taskNames[i % taskNames.length]} #${Math.floor(i / taskNames.length) + 1}`,
      category: categories[i % 3],
      done: Math.random() > 0.8,
    }));
  }
}
