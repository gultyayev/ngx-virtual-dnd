import { ChangeDetectionStrategy, Component, input, output, TemplateRef } from '@angular/core';
import {
  VirtualScrollContainerComponent,
  VirtualScrollItemContext,
} from './virtual-scroll-container.component';
import { DroppableDirective } from '../directives/droppable.directive';
import { AutoScrollConfig } from '../services/auto-scroll.service';
import { DropEvent, PlaceholderMoveEvent } from '../models/drag-drop.models';

/**
 * A high-level component that combines droppable, virtual scroll, and placeholder
 * functionality into a single, easy-to-use component.
 *
 * This component significantly reduces boilerplate by automatically handling:
 * - Placeholder insertion at the correct position
 * - Sticky item management for the dragged item
 * - Virtual scrolling with proper drag-and-drop integration
 * - Droppable container setup
 *
 * @example
 * ```html
 * <!-- Before (verbose): ~45 lines of boilerplate -->
 * <div vdndDroppable="list-1" vdndDroppableGroup="demo" (drop)="onDrop($event)">
 *   <vdnd-virtual-scroll
 *     [items]="itemsWithPlaceholder()"
 *     [itemHeight]="50"
 *     [stickyItemIds]="stickyIds()"
 *     [itemIdFn]="getItemId"
 *     [trackByFn]="trackById"
 *     [itemTemplate]="itemTpl">
 *   </vdnd-virtual-scroll>
 * </div>
 *
 * <!-- After (concise): ~8 lines -->
 * <div vdndGroup="demo">
 *   <vdnd-sortable-list
 *     droppableId="list-1"
 *     [items]="list()"
 *     [itemHeight]="50"
 *     [itemIdFn]="getItemId"
 *     [itemTemplate]="itemTpl"
 *     (drop)="onDrop($event)">
 *   </vdnd-sortable-list>
 * </div>
 * ```
 */
@Component({
  selector: 'vdnd-sortable-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VirtualScrollContainerComponent, DroppableDirective],
  host: {
    class: 'vdnd-sortable-list',
  },
  template: `
    <div
      class="vdnd-sortable-list-droppable"
      [vdndDroppable]="droppableId()"
      [vdndDroppableGroup]="group()"
      [vdndDroppableData]="droppableData()"
      [disabled]="disabled()"
      [constrainToContainer]="constrainToContainer()"
      (drop)="drop.emit($event)"
      (placeholderMove)="placeholderMove.emit($event)"
    >
      <vdnd-virtual-scroll
        [items]="items()"
        [itemHeight]="itemHeight()"
        [dynamicItemHeight]="dynamicItemHeight()"
        [itemIdFn]="itemIdFn()"
        [trackByFn]="trackByFn()"
        [itemTemplate]="itemTemplate()"
        [droppableId]="droppableId()"
        [autoStickyDraggedItem]="true"
        [containerHeight]="containerHeight()"
        [overscan]="overscan()"
        [autoScrollEnabled]="autoScrollEnabled()"
        [autoScrollConfig]="autoScrollConfig()"
      >
      </vdnd-virtual-scroll>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class VirtualSortableListComponent<T> {
  // ========== Required Inputs ==========

  /** Unique identifier for this droppable list */
  droppableId = input.required<string>();

  /**
   * Drag-and-drop group name.
   * Optional when a parent `vdndGroup` directive provides the group context.
   */
  group = input<string>();

  /** Array of items to render */
  items = input.required<T[]>();

  /** Height of each item in pixels (used as estimate in dynamic mode) */
  itemHeight = input.required<number>();

  /**
   * Enable dynamic item height mode.
   * When true, items are auto-measured via ResizeObserver and `itemHeight`
   * serves as the initial estimate for unmeasured items.
   */
  dynamicItemHeight = input<boolean>(false);

  /** Function to get a unique ID from an item */
  itemIdFn = input.required<(item: T) => string>();

  /** Template for rendering each item */
  itemTemplate = input.required<TemplateRef<VirtualScrollItemContext<T>>>();

  // ========== Optional Inputs ==========

  /**
   * Track-by function for the @for loop.
   * Optional - if not provided, will be derived from itemIdFn.
   */
  trackByFn = input<(index: number, item: T) => string | number>();

  /** Optional data associated with this droppable */
  droppableData = input<unknown>();

  /** Whether this sortable list is disabled */
  disabled = input<boolean>(false);

  /**
   * Height of the container in pixels.
   * If not provided, uses CSS-based height detection.
   */
  containerHeight = input<number>();

  /** Number of items to render above/below the visible area */
  overscan = input<number>(3);

  /** Enable auto-scroll when dragging near edges */
  autoScrollEnabled = input<boolean>(true);

  /** Auto-scroll configuration */
  autoScrollConfig = input<Partial<AutoScrollConfig>>({});

  /** Constrain drag preview and placeholder to container boundaries */
  constrainToContainer = input<boolean>(false);

  // ========== Outputs ==========

  /** Emits when an item is dropped on this list */
  // eslint-disable-next-line @angular-eslint/no-output-native
  drop = output<DropEvent>();

  /** Emits each time the placeholder moves within this list (every item displacement) */
  placeholderMove = output<PlaceholderMoveEvent>();
}
