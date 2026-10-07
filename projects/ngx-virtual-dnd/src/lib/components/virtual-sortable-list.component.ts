import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  inject,
  input,
  output,
  TemplateRef,
} from '@angular/core';
import {
  VirtualScrollContainerComponent,
  VirtualScrollItemContext,
} from './virtual-scroll-container.component';
import { DroppableDirective } from '../directives/droppable.directive';
import { AutoScrollConfig } from '../services/auto-scroll.service';
import { DropEvent, PlaceholderMoveEvent } from '../models/drag-drop.models';

/**
 * Forwards the inner droppable's `drop` and `placeholderMove` to the sortable list's outputs.
 *
 * Not template listeners: Angular marks the listening view and every ancestor up to the root
 * dirty before running one, so each placeholder move would re-render the consumer's whole
 * component chain even when nothing listens to `placeholderMove`. A subscription marks nothing;
 * a consumer's own listener on the sortable list marks only its own view. Subscribed in the
 * constructor, before the droppable's first change detection can emit; both outputs drop their
 * listeners when the element is destroyed.
 */
@Directive({ selector: '[vdndSortableListOutputs]' })
class SortableListOutputsDirective {
  constructor() {
    const droppable = inject(DroppableDirective);
    const list = inject(VirtualSortableListComponent);
    droppable.drop.subscribe((event) => list.drop.emit(event));
    droppable.placeholderMove.subscribe((event) => list.placeholderMove.emit(event));
  }
}

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
  imports: [VirtualScrollContainerComponent, DroppableDirective, SortableListOutputsDirective],
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
      vdndSortableListOutputs
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
        [recycleRows]="recycleRows()"
        [autoScrollEnabled]="autoScrollEnabled()"
        [autoScrollConfig]="autoScrollConfig()"
        [scrollInsetTop]="scrollInsetTop()"
        [scrollInsetBottom]="scrollInsetBottom()"
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

  /**
   * Reuse the views of rows that scroll out to render the rows that scroll in, instead of
   * destroying them and creating new ones. Scrolling creates fewer components and elements, but
   * a row's components, element and DOM state (focus aside) then carry over to other items.
   * @default false
   */
  recycleRows = input<boolean>(false);

  /** Enable auto-scroll when dragging near edges */
  autoScrollEnabled = input<boolean>(true);

  /** Auto-scroll configuration */
  autoScrollConfig = input<Partial<AutoScrollConfig>>({});

  /**
   * Space (px) at the top of the list covered by content pinned over its rows, such as an
   * overlaid header (see `vdnd-virtual-scroll`'s `scrollInsetTop`).
   */
  scrollInsetTop = input<number>(0);

  /** Space (px) at the bottom of the list covered by content pinned over its rows. */
  scrollInsetBottom = input<number>(0);

  /** Constrain drag preview and placeholder to container boundaries */
  constrainToContainer = input<boolean>(false);

  // ========== Outputs ==========

  /** Emits when an item is dropped on this list */
  // eslint-disable-next-line @angular-eslint/no-output-native
  drop = output<DropEvent>();

  /** Emits each time the placeholder moves within this list (every item displacement) */
  placeholderMove = output<PlaceholderMoveEvent>();
}
