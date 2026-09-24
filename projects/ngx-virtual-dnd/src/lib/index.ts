// Models
export * from './models/drag-drop.models';
export type { VirtualScrollStrategy } from './models/virtual-scroll-strategy';

// Strategies
export { FixedHeightStrategy } from './strategies/fixed-height.strategy';
export { DynamicHeightStrategy } from './strategies/dynamic-height.strategy';

// Tokens
export { VDND_SCROLL_CONTAINER } from './tokens/scroll-container.token';
export type { VdndScrollContainer } from './tokens/scroll-container.token';
export { VDND_VIRTUAL_VIEWPORT } from './tokens/virtual-viewport.token';
export type { VdndVirtualViewport } from './tokens/virtual-viewport.token';
export { VDND_ANIMATION_CONFIG } from './tokens/animation-config.token';
export type { VdndAnimationConfig } from './tokens/animation-config.token';

// Services
export { DragStateService } from './services/drag-state.service';
export { PositionCalculatorService } from './services/position-calculator.service';
export { AutoScrollService } from './services/auto-scroll.service';
export type { AutoScrollConfig } from './services/auto-scroll.service';
export { ElementCloneService } from './services/element-clone.service';
export { KeyboardDragService } from './services/keyboard-drag.service';
export { OverlayContainerService } from './services/overlay-container.service';

// Components
export { VirtualScrollContainerComponent } from './components/virtual-scroll-container.component';
export type { VirtualScrollItemContext } from './components/virtual-scroll-container.component';
export { DragPreviewComponent } from './components/drag-preview.component';
export type { DragPreviewContext } from './components/drag-preview.component';
export { PlaceholderComponent } from './components/placeholder.component';
export type { PlaceholderContext } from './components/placeholder.component';
export { DragPlaceholderComponent } from './components/drag-placeholder.component';
export { VirtualSortableListComponent } from './components/virtual-sortable-list.component';
export { VirtualViewportComponent } from './components/virtual-viewport.component';
export { VirtualContentComponent } from './components/virtual-content.component';

// Directives
export { DraggableDirective } from './directives/draggable.directive';
export { DroppableDirective } from './directives/droppable.directive';
export { DroppableGroupDirective, VDND_GROUP_TOKEN } from './directives/droppable-group.directive';
export type { VdndGroupContext } from './directives/droppable-group.directive';
export { ScrollableDirective } from './directives/scrollable.directive';
export { VirtualForDirective } from './directives/virtual-for.directive';
export type { VirtualForContext } from './directives/virtual-for.directive';
export { ContentHeaderDirective } from './directives/content-header.directive';

// Utilities
export {
  moveItem,
  reorderItems,
  applyMove,
  isNoOpDrop,
  insertAt,
  removeAt,
} from './utils/drop-helpers';
