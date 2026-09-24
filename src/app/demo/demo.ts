import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import {
  applyMove,
  DraggableDirective,
  DragPreviewComponent,
  DragEndEvent,
  DragStateService,
  DropEvent,
  DroppableDirective,
  DroppableGroupDirective,
  isNoOpDrop,
  moveItem,
  PlaceholderMoveEvent,
  VirtualScrollContainerComponent,
  VirtualSortableListComponent,
} from 'ngx-virtual-dnd';
import { TopBarComponent } from '../top-bar/top-bar';
import { DEMO_SHIFT_DURATION, DemoAnimationSettings } from '../demo-animation-settings';

interface Item {
  id: string;
  name: string;
}

/**
 * Demo component showcasing the ngx-virtual-dnd library.
 */
@Component({
  selector: 'app-demo',
  host: {
    '[attr.data-last-drop-source-index]': 'lastDropSourceIndex()',
    '[attr.data-last-drop-destination-index]': 'lastDropDestinationIndex()',
    '[attr.data-last-drag-end-destination-index]': 'lastDragEndDestinationIndex()',
    '[attr.data-last-drag-end-cancelled]': 'lastDragEndCancelled()',
    '[attr.data-placeholder-move-count]': 'placeholderMoveCount()',
    '[attr.data-last-placeholder-move]': 'lastPlaceholderMove()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    JsonPipe,
    TopBarComponent,
    DragPreviewComponent,
    DraggableDirective,
    DroppableDirective,
    DroppableGroupDirective,
    VirtualScrollContainerComponent,
    VirtualSortableListComponent,
  ],
  templateUrl: './demo.html',
  styleUrl: './demo.scss',
})
export class DemoComponent {
  readonly #dragState = inject(DragStateService);
  readonly #animationSettings = inject(DemoAnimationSettings);

  /** Whether displaced items slide (VDND_ANIMATION_CONFIG shift animation) */
  readonly shiftAnimation = computed(() => this.#animationSettings.shiftDuration() > 0);

  /** Whether a drag is currently active (drives the debug live indicator). */
  readonly isDragging = this.#dragState.isDragging;

  /** Number of items to generate */
  readonly itemCount = signal(100);

  /** Axis lock setting for drag operations */
  readonly lockAxis = signal<'x' | 'y' | null>(null);

  /** Whether drag-and-drop is enabled */
  readonly dragEnabled = signal(true);

  /** Delay in milliseconds before drag starts */
  readonly dragDelay = signal(0);

  /** Whether to use drag handle (only handle initiates drag) */
  readonly useDragHandle = signal(false);

  /** Whether to use the simplified API (VirtualSortableListComponent + moveItem) */
  readonly useSimplifiedApi = signal(false);

  /** Constrain drag preview and placeholder to container boundaries */
  readonly constrainToContainer = signal(false);

  /** Whether the List 2 droppable is disabled (rejects drops / keyboard navigation) */
  readonly list2DroppableDisabled = signal(false);

  /** Whether settings panel is expanded */
  readonly settingsExpanded = signal(true);

  /** Whether debug panel is expanded */
  readonly debugExpanded = signal(false);

  /** Whether a panel was toggled by the user; panels animate only from then on. */
  readonly panelToggled = signal(false);

  /** Last source index received by the demo drop handler (used by interaction tests). */
  readonly lastDropSourceIndex = signal<number | null>(null);

  /** Last destination index received by the demo drop handler (used by interaction tests). */
  readonly lastDropDestinationIndex = signal<number | null>(null);

  /** Last destination index received by the demo dragEnd handler (used by interaction tests). */
  readonly lastDragEndDestinationIndex = signal<number | null>(null);

  /** Whether the last dragEnd event was cancelled (used by interaction tests). */
  readonly lastDragEndCancelled = signal<boolean | null>(null);

  /** Number of placeholderMove events received (used by interaction tests). */
  readonly placeholderMoveCount = signal(0);

  /** Last placeholderMove as `droppableId:previousIndex->currentIndex` (used by interaction tests). */
  readonly lastPlaceholderMove = signal<string | null>(null);

  /** List 1 items */
  readonly list1 = signal<Item[]>([]);

  /** List 2 items */
  readonly list2 = signal<Item[]>([]);

  /** IDs of items that should always be rendered (dragged item needs to stay for reference) */
  readonly stickyIds = computed(() => {
    const draggedItem = this.#dragState.draggedItem();
    return draggedItem ? [draggedItem.draggableId] : [];
  });

  /** Debug state for display */
  readonly debugState = computed(() => ({
    isDragging: this.#dragState.isDragging(),
    draggedItemId: this.#dragState.draggedItemId(),
    draggedItemHeight: this.#dragState.draggedItem()?.height ?? null,
    sourceDroppable: this.#dragState.sourceDroppableId(),
    sourceIndex: this.#dragState.sourceIndex(),
    activeDroppable: this.#dragState.activeDroppableId(),
    placeholder: this.#dragState.placeholderId(),
    placeholderIndex: this.#dragState.placeholderIndex(),
    cursorPosition: this.#dragState.cursorPosition(),
    grabOffset: this.#dragState.grabOffset(),
  }));

  constructor() {
    this.regenerateItems();
  }

  /** Toggle settings panel */
  toggleSettings(): void {
    this.panelToggled.set(true);
    this.settingsExpanded.update((v) => !v);
  }

  /** Toggle debug panel */
  toggleDebug(): void {
    this.panelToggled.set(true);
    this.debugExpanded.update((v) => !v);
  }

  /** Generate items for both lists */
  regenerateItems(): void {
    const count = this.itemCount();
    const half = Math.floor(count / 2);

    const items1: Item[] = [];
    for (let i = 0; i < half; i++) {
      items1.push({
        id: `list1-${i}`,
        name: `Item ${i + 1}`,
      });
    }

    const items2: Item[] = [];
    for (let i = 0; i < count - half; i++) {
      items2.push({
        id: `list2-${i}`,
        name: `Item ${i + 1}`,
      });
    }

    this.list1.set(items1);
    this.list2.set(items2);
  }

  /** Update item count from input */
  updateItemCount(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = parseInt(input.value, 10);
    if (!isNaN(value) && value > 0) {
      this.itemCount.set(value);
    }
  }

  /** Update axis lock setting from select */
  updateLockAxis(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    this.lockAxis.set(value === 'x' || value === 'y' ? value : null);
  }

  /** Toggle drag enabled setting */
  toggleDragEnabled(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    this.dragEnabled.set(checkbox.checked);
  }

  /** Update drag delay from input */
  updateDragDelay(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = parseInt(input.value, 10);
    if (!isNaN(value) && value >= 0) {
      this.dragDelay.set(value);
    }
  }

  /** Toggle drag handle setting */
  toggleDragHandle(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    this.useDragHandle.set(checkbox.checked);
  }

  /** Toggle constrain to container setting */
  toggleConstrainToContainer(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    this.constrainToContainer.set(checkbox.checked);
  }

  /** Toggle the shift animation setting */
  toggleShiftAnimation(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    this.#animationSettings.shiftDuration.set(checkbox.checked ? DEMO_SHIFT_DURATION : 0);
  }

  /** Haptic tick on every item displacement (no-op where vibration is unsupported). */
  onPlaceholderMove(event: PlaceholderMoveEvent): void {
    this.placeholderMoveCount.update((count) => count + 1);
    this.lastPlaceholderMove.set(
      `${event.droppableId}:${event.previousIndex}->${event.currentIndex}`,
    );
    navigator.vibrate?.(10);
  }

  /** Toggle the disabled state of the List 2 droppable */
  toggleList2DroppableDisabled(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    this.list2DroppableDisabled.set(checkbox.checked);
  }

  /** Record dragEnd events for interaction tests. */
  onDragEnd(event: DragEndEvent): void {
    this.lastDragEndDestinationIndex.set(event.destinationIndex);
    this.lastDragEndCancelled.set(event.cancelled);
  }

  /** Handle drop events (verbose API) */
  onDrop(event: DropEvent): void {
    this.lastDropSourceIndex.set(event.source.index);
    this.lastDropDestinationIndex.set(event.destination.index);
    if (isNoOpDrop(event)) {
      return;
    }

    const moved = applyMove(event, {
      'list-1': this.list1(),
      'list-2': this.list2(),
    });

    this.list1.set(moved['list-1']);
    this.list2.set(moved['list-2']);
  }

  /**
   * Handle drop events (simplified API).
   * Uses the moveItem utility - just ONE line of code!
   */
  onDropSimplified(event: DropEvent): void {
    this.lastDropSourceIndex.set(event.source.index);
    this.lastDropDestinationIndex.set(event.destination.index);
    moveItem(event, {
      'list-1': this.list1,
      'list-2': this.list2,
    });
  }

  /** Track by function for items */
  readonly trackById = (_index: number, item: Item): string => {
    return item.id;
  };

  /** Get item ID */
  readonly getItemId = (item: Item): string => {
    return item.id;
  };
}
