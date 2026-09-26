# API Reference

All exports are from `'ngx-virtual-dnd'`. Setup rules, recipes, CSS classes, and keyboard behavior are in [SKILL.md](../SKILL.md).

## Contents

- [Components](#components): VirtualSortableListComponent, VirtualScrollContainerComponent, VirtualViewportComponent, VirtualContentComponent, DragPreviewComponent, PlaceholderComponent, DragPlaceholderComponent
- [Directives](#directives): DraggableDirective, DroppableDirective, DroppableGroupDirective, ScrollableDirective, VirtualForDirective, ContentHeaderDirective
- [Events](#events): DragStartEvent, DropEvent, DragEndEvent, PlaceholderMoveEvent
- [Utilities](#utilities)
- [Services](#services): DragStateService, AutoScrollService, PositionCalculatorService, ElementCloneService, KeyboardDragService, OverlayContainerService
- [Configuration Types](#configuration-types)
- [Strategies](#strategies)
- [Tokens](#tokens)
- [Constants](#constants)

## Components

### VirtualSortableListComponent

**Selector:** `vdnd-sortable-list`

High-level component combining droppable, virtual scroll, and placeholder. Default choice for most use cases.

**Inputs:**

| Input | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `droppableId` | `string` | - | Yes | Unique ID for this droppable container |
| `items` | `T[]` | - | Yes | Array of items to render |
| `itemHeight` | `number` | - | Yes | Item height in pixels (exact for fixed, estimate for dynamic) |
| `itemIdFn` | `(item: T) => string` | - | Yes | Returns each item's ID. Must equal the `vdndDraggable` value rendered for that item |
| `itemTemplate` | `TemplateRef<VirtualScrollItemContext<T>>` | - | Yes | Template for rendering each item; its root element should carry `[vdndDraggable]` |
| `group` | `string` | `undefined` | No | Group name. Optional when a `vdndGroup` ancestor provides it |
| `dynamicItemHeight` | `boolean` | `false` | No | Enable auto-measured variable heights |
| `trackByFn` | `(index: number, item: T) => string \| number` | derived from `itemIdFn` | No | Track-by function for rendering |
| `droppableData` | `unknown` | `undefined` | No | Custom data attached to this droppable (available in `DropDestination.data`) |
| `disabled` | `boolean` | `false` | No | Disable dropping into this list (forwarded to its droppable). Items can still be dragged out; disable the draggables too for a read-only list |
| `containerHeight` | `number` | `undefined` | No | Container height in pixels. Without it, the inner `vdnd-virtual-scroll` must get a CSS height |
| `overscan` | `number` | `3` | No | Number of items to render beyond visible viewport |
| `autoScrollEnabled` | `boolean` | `true` | No | Enable edge auto-scrolling during drag |
| `autoScrollConfig` | `Partial<AutoScrollConfig>` | `{}` | No | Auto-scroll configuration |
| `constrainToContainer` | `boolean` | `false` | No | Clamp drag preview and drop position to container boundaries |

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| `drop` | `DropEvent` | Item dropped into this list (fires on the destination list only) |
| `placeholderMove` | `PlaceholderMoveEvent` | Placeholder moved within this list during a drag (every item displacement) |

---

### VirtualScrollContainerComponent

**Selector:** `vdnd-virtual-scroll`

Low-level virtual scroll container. Use with `DroppableDirective` for custom layouts.

**Inputs:**

| Input | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `items` | `T[]` | - | Yes | Array of items to render |
| `itemHeight` | `number` | - | Yes | Item height in pixels |
| `itemIdFn` | `(item: T) => string` | - | Yes | Returns each item's ID. Must equal the `vdndDraggable` value rendered for that item |
| `itemTemplate` | `TemplateRef<VirtualScrollItemContext<T>>` | - | Yes | Template for rendering each item |
| `droppableId` | `string` | `undefined` | No | ID of the enclosing `vdndDroppable`. Needed for the placeholder to appear in this list |
| `scrollContainerId` | `string` | `undefined` | No | ID for auto-scroll registration |
| `autoScrollEnabled` | `boolean` | `true` | No | Enable edge auto-scrolling |
| `autoScrollConfig` | `Partial<AutoScrollConfig>` | `{}` | No | Auto-scroll configuration |
| `dynamicItemHeight` | `boolean` | `false` | No | Enable auto-measured variable heights |
| `containerHeight` | `number` | `undefined` | No | Container height in pixels. Without it, give the element a CSS height (measured via ResizeObserver) |
| `overscan` | `number` | `3` | No | Items to render beyond visible viewport |
| `stickyItemIds` | `string[]` | `[]` | No | Item IDs to keep rendered regardless of scroll position |
| `trackByFn` | `(index: number, item: T) => string \| number` | derived from `itemIdFn` | No | Track-by function |
| `autoStickyDraggedItem` | `boolean` | `true` | No | Auto-stick dragged item during drag |

**Outputs:** None

**Public Methods** (access via `viewChild(VirtualScrollContainerComponent)`):

| Method | Signature | Description |
|--------|-----------|-------------|
| `scrollTo` | `(position: number) => void` | Scroll to absolute position |
| `scrollToIndex` | `(index: number) => void` | Scroll to item by index |
| `scrollBy` | `(delta: number) => void` | Scroll by relative delta |
| `getScrollTop` | `() => number` | Get current scroll position |
| `getScrollHeight` | `() => number` | Get total scroll height |

---

### VirtualViewportComponent

**Selector:** `vdnd-virtual-viewport`

Self-scrolling viewport for `*vdndVirtualFor` content, positioned with a single GPU-accelerated transform. Needs a height (CSS). Children using `*vdndVirtualFor` inherit its `itemHeight` and `dynamicItemHeight`. Provides `VDND_VIRTUAL_VIEWPORT` and `VDND_SCROLL_CONTAINER` tokens. For drag and drop, put `vdndDroppable` on the viewport element itself (not on a wrapper); it does not scroll to follow a keyboard drag.

```html
<vdnd-virtual-viewport [itemHeight]="50" style="height: 400px">
  <ng-container *vdndVirtualFor="let item of items(); trackBy: trackById">
    <div class="item">{{ item.name }}</div>
  </ng-container>
</vdnd-virtual-viewport>
```

**Inputs:**

| Input | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `itemHeight` | `number` | - | Yes | Item height in pixels |
| `dynamicItemHeight` | `boolean` | `false` | No | Enable dynamic heights |
| `contentOffset` | `number` | `0` | No | Space (px) reserved above the items, e.g. for a header |
| `scrollContainerId` | `string` | `undefined` | No | ID for auto-scroll registration |
| `autoScrollEnabled` | `boolean` | `true` | No | Enable edge auto-scrolling |
| `autoScrollConfig` | `Partial<AutoScrollConfig>` | `{}` | No | Auto-scroll configuration |

**Outputs:** None

---

### VirtualContentComponent

**Selector:** `vdnd-virtual-content`

Virtual content for external scroll containers (page-level scroll). Must be placed inside a `vdndScrollable` element. Projects an optional `[vdndContentHeader]` above the items. Provides `VDND_VIRTUAL_VIEWPORT` and `VDND_SCROLL_CONTAINER` tokens.

**Inputs:**

| Input | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `itemHeight` | `number` | - | Yes | Item height in pixels |
| `contentOffset` | `number` | `0` | No | Manual content offset (overridden by `vdndContentHeader` auto-measurement) |
| `dynamicItemHeight` | `boolean` | `false` | No | Enable dynamic heights |

**Outputs:** None

---

### DragPreviewComponent

**Selector:** `vdnd-drag-preview`

Renders the dragged item preview. Teleports its host into a body-level `div.vdnd-overlay-container` to escape ancestor CSS transforms (ancestor-dependent selectors stop matching). Without `previewTemplate` it shows a styled clone of the dragged element. The preview box is sized to the dragged element. With `VDND_ANIMATION_CONFIG` it stays up after a drop or cancel to play the drop animation (class `vdnd-drag-preview-dropping`).

**Required** — place once in your template.

**Inputs:**

| Input | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `previewTemplate` | `TemplateRef<DragPreviewContext<T>>` | `undefined` | No | Custom preview template (skips the element clone) |
| `cursorOffset` | `{ x: number; y: number }` | `{ x: 8, y: 8 }` | No | Fallback offset used only when no grab offset is known. Pointer and keyboard drags always set one, so the preview normally keeps the grab point under the pointer |

**Outputs:** None

---

### PlaceholderComponent

**Selector:** `vdnd-placeholder`

Standalone drop-position indicator you can render yourself (host class `vdnd-placeholder`). **Not** used by the built-in lists — they render `DragPlaceholderComponent`; style that via `.vdnd-drag-placeholder`.

**Inputs:**

| Input | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `height` | `number` | `50` | No | Placeholder height in pixels |
| `template` | `TemplateRef<PlaceholderContext>` | `undefined` | No | Custom placeholder template |

**Outputs:** None

---

### DragPlaceholderComponent

**Selector:** `vdnd-drag-placeholder`

Empty placeholder rendered at the drop position in the target list during drag, sized to the dragged item. Rendered automatically by `vdnd-virtual-scroll` (hence `vdnd-sortable-list`); `*vdndVirtualFor` inserts an equivalent `div` with the same classes. Host classes: `vdnd-drag-placeholder vdnd-drag-placeholder-visible`.

**Inputs:**

| Input | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `itemHeight` | `number` | - | Yes | Height of the placeholder in pixels |

**Outputs:** None

---

## Directives

### DraggableDirective

**Selector:** `[vdndDraggable]`

Makes an element draggable via mouse, touch, or keyboard.

**Inputs:**

| Input | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `vdndDraggable` | `string` | - | Yes | Draggable ID. Unique across all lists; must equal the list's `itemIdFn`/`trackBy` value for the item |
| `vdndDraggableGroup` | `string` | `undefined` | No* | Group name. *Required unless a `vdndGroup` is in scope where the element's template is declared; without a group, drag is disabled (dev-mode warning) |
| `vdndDraggableData` | `unknown` | `undefined` | No | Custom data (in `DragStartEvent`/`DragEndEvent`/`DropSource` `data` and as the preview template's `$implicit`) |
| `disabled` | `boolean` | `false` | No | Disable dragging |
| `dragHandle` | `string` | `undefined` | No | CSS selector restricting drag initiation area. Pointer-downs inside `button`, `input`, `textarea`, `select`, `[contenteditable]`, or inside a `.no-drag` element never start a drag |
| `dragThreshold` | `number` | `5` | No | Minimum distance (px) before drag starts |
| `dragDelay` | `number` | `0` | No | Hold time (ms) before drag can start; moving past `dragThreshold` earlier aborts the attempt |
| `lockAxis` | `'x' \| 'y' \| null` | `null` | No | Freeze one axis: `'x'` = X frozen (vertical-only), `'y'` = Y frozen (horizontal-only). Opposite of CDK's `cdkDragLockAxis`. |

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| `dragStart` | `DragStartEvent` | Drag operation started |
| `dragEnd` | `DragEndEvent` | Drag operation ended, dropped or not (see `destinationIndex`) |

---

### DroppableDirective

**Selector:** `[vdndDroppable]`

Marks an element as a drop target.

**Inputs:**

| Input | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `vdndDroppable` | `string` | - | Yes | Droppable ID, unique on the page |
| `vdndDroppableGroup` | `string` | `undefined` | No* | Group name. *Required unless inherited from a `vdndGroup` ancestor |
| `vdndDroppableData` | `unknown` | `undefined` | No | Custom data (available in `DropDestination.data`) |
| `disabled` | `boolean` | `false` | No | Disable dropping. Excluded from pointer hit-testing and keyboard cross-list navigation; releasing over it fires no `drop` and yields `dragEnd` with `destinationIndex: null` |
| `autoScrollEnabled` | `boolean` | `true` | No | Enable edge auto-scrolling |
| `autoScrollConfig` | `Partial<AutoScrollConfig>` | `{}` | No | Auto-scroll configuration |
| `constrainToContainer` | `boolean` | `false` | No | Clamp drag preview and drop position to the nearest `vdndScrollable` ancestor (or this element) |

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| `drop` | `DropEvent` | Item dropped into this droppable (destination only) |
| `placeholderMove` | `PlaceholderMoveEvent` | Placeholder moved within this droppable during a drag (every item displacement) |

---

### DroppableGroupDirective

**Selector:** `[vdndGroup]`

Provides the group name (via `VDND_GROUP_TOKEN`) to descendant draggables and droppables. Templates resolve it from where they are declared, so declare item `<ng-template>`s inside this element.

**Inputs:**

| Input | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `vdndGroup` | `string` | - | Yes | Group name |

**Outputs:** None

---

### ScrollableDirective

**Selector:** `[vdndScrollable]`

Marks a scrollable element (it must have `overflow: auto`/`scroll` and a height) as the scroll container for `vdnd-virtual-content` or `*vdndVirtualFor`. Adds class `vdnd-scrollable` and `overflow-anchor: none`. Provides `VDND_SCROLL_CONTAINER` token.

**Inputs:**

| Input | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `scrollContainerId` | `string` | `undefined` | No | ID for auto-scroll registration |
| `autoScrollEnabled` | `boolean` | `true` | No | Enable edge auto-scrolling |
| `autoScrollConfig` | `Partial<AutoScrollConfig>` | `{}` | No | Auto-scroll configuration |

**Outputs:** None

---

### VirtualForDirective

**Selector:** `[vdndVirtualFor][vdndVirtualForOf]` (used as `*vdndVirtualFor`)

Structural directive that renders only the visible items. Must be inside `vdnd-virtual-viewport`, `vdnd-virtual-content`, or a `vdndScrollable` element. Inside a viewport component it inherits `itemHeight`/`dynamicItemHeight`; directly inside `vdndScrollable` it needs `itemHeight` (falls back to 50 with a dev-mode warning). `droppableId` is inherited from an enclosing `vdndDroppable`. The `trackBy` key should equal the item's `vdndDraggable` ID.

**Microsyntax:**

```html
*vdndVirtualFor="let item of items(); trackBy: trackById; itemHeight: 50; overscan: 3"
```

**Inputs:**

| Input | Microsyntax Key | Type | Default | Required | Description |
|-------|----------------|------|---------|----------|-------------|
| `vdndVirtualForOf` | `of` | `T[]` | - | Yes | Array of items |
| `vdndVirtualForTrackBy` | `trackBy` | `(index: number, item: T) => unknown` | - | Yes | Track-by function |
| `vdndVirtualForItemHeight` | `itemHeight` | `number` | inherited | No* | Item height. *Required when not inside a viewport component |
| `vdndVirtualForOverscan` | `overscan` | `number` | `3` | No | Overscan buffer |
| `vdndVirtualForDroppableId` | `droppableId` | `string` | inherited | No | Droppable ID (inherited from parent) |
| `vdndVirtualForDynamicItemHeight` | `dynamicItemHeight` | `boolean` | `false` | No | Enable dynamic heights (inherited from parent viewport) |

**Template Context (`VirtualForContext<T>`):**

| Variable | Type | Description |
|----------|------|-------------|
| `$implicit` | `T` | Current item |
| `index` | `number` | Item index in the full list |
| `first` | `boolean` | Is first visible item |
| `last` | `boolean` | Is last visible item |
| `count` | `number` | Total item count |

---

### ContentHeaderDirective

**Selector:** `[vdndContentHeader]`

Marks a projected header inside `VirtualContentComponent`. Height is auto-measured via ResizeObserver and used as content offset.

**Inputs:** None
**Outputs:** None

---

## Events

### DragStartEvent

```typescript
interface DragStartEvent {
  draggableId: string;
  droppableId: string;
  data?: unknown;
  position: CursorPosition;
  sourceIndex: number;
}
```

### DropEvent

```typescript
interface DropEvent {
  source: DropSource;
  destination: DropDestination;
}

interface DropSource {
  draggableId: string;
  droppableId: string;
  index: number;
  data?: unknown;
}

interface DropDestination {
  droppableId: string;
  placeholderId: string; // deprecated: always END_OF_LIST; use index for the position
  index: number;         // final insertion index, after removal from the source
  data?: unknown;        // the droppable's vdndDroppableData / droppableData
}
```

### DragEndEvent

```typescript
interface DragEndEvent {
  draggableId: string;
  droppableId: string;
  cancelled: boolean;
  data?: unknown;
  sourceIndex: number;
  destinationIndex: number | null;
}
```

`droppableId` is the source droppable. `destinationIndex` is `null` when there is no valid drop target — a cancelled drag (Escape, Tab during a keyboard drag, or the window losing focus / the page being hidden during a pointer drag) or a release over a disabled droppable / outside every droppable. A non-`null` value pairs with a `drop` event on the destination. `cancelled` is `true` only for cancelled drags (Escape, Tab, focus loss).

### PlaceholderMoveEvent

```typescript
interface PlaceholderMoveEvent {
  draggableId: string;
  sourceDroppableId: string;
  droppableId: string;           // the droppable the placeholder moved within
  previousIndex: number | null;  // null when the placeholder just entered this droppable
  currentIndex: number;
  data?: unknown;                // the dragged item's vdndDraggableData
}
```

Indexes use the `DropEvent.destination.index` convention (where the item would land if dropped now). Emitted on every placeholder move inside the droppable, including entering it; not emitted for the initial pick-up (placeholder in the item's own slot) or when the placeholder leaves. For the first move in the source list, `previousIndex` is the item's source index. Typical use: haptic feedback.

---

## Utilities

```typescript
function moveItem<T>(
  event: DropEvent,
  lists: Record<string, WritableSignal<T[]>>,
): void;

function reorderItems<T>(
  event: DropEvent,
  list: WritableSignal<T[]>,
): void;

function applyMove<T>(
  event: DropEvent,
  lists: Record<string, T[]>,
): Record<string, T[]>;

function isNoOpDrop(event: DropEvent): boolean;

function insertAt<T>(list: T[], item: T, index: number): T[];

function removeAt<T>(list: T[], index: number): T[];
```

- `moveItem` does nothing (dev-mode warning) if either droppable ID is missing from `lists` or the source item doesn't exist. Same-list drops delegate to `reorderItems`.
- `reorderItems` handles same-list drops only; it does nothing (dev-mode warning) if the source item doesn't exist.
- `applyMove` returns a shallow copy of `lists` with new arrays for the source/destination entries; unchanged input if the source item doesn't exist.
- `isNoOpDrop` is `true` when source and destination droppable and index are equal.

---

## Services

### DragStateService

**Injectable:** `providedIn: 'root'` (singleton)

**Readonly Signals:**

| Signal | Type |
|--------|------|
| `isDragging` | `Signal<boolean>` |
| `draggedItem` | `Signal<DraggedItem \| null>` |
| `draggedItemId` | `Signal<string \| null>` |
| `sourceDroppableId` | `Signal<string \| null>` |
| `sourceIndex` | `Signal<number \| null>` |
| `activeDroppableId` | `Signal<string \| null>` |
| `placeholderId` | `Signal<string \| null>` — deprecated, always `END_OF_LIST` or `null`; use `placeholderIndex` |
| `placeholderIndex` | `Signal<number \| null>` |
| `cursorPosition` | `Signal<CursorPosition \| null>` |
| `grabOffset` | `Signal<GrabOffset \| null>` |
| `initialPosition` | `Signal<CursorPosition \| null>` |
| `lockAxis` | `Signal<'x' \| 'y' \| null>` |
| `isKeyboardDrag` | `Signal<boolean>` |
| `keyboardTargetIndex` | `Signal<number \| null>` |
| `wasCancelled` | `Signal<boolean>` — whether the last drag was cancelled |
| `endedDragState` | `Signal<DragState \| null>` — snapshot taken just before the last drag's state was reset |

### AutoScrollService

**Injectable:** `providedIn: 'root'` (singleton)

Controls edge auto-scrolling during drag operations. Usually configured via component inputs rather than used directly.

**Key Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `registerContainer` | `(id, element, config?) => void` | Register a scroll container for auto-scroll |
| `unregisterContainer` | `(id) => void` | Unregister a scroll container |
| `startMonitoring` | `(onScroll?) => void` | Start monitoring cursor position for auto-scroll |
| `stopMonitoring` | `() => void` | Stop monitoring |
| `isScrolling` | `() => boolean` | Whether auto-scroll is currently active |
| `getScrollDirection` | `() => { x: number; y: number }` | Current scroll direction |

### PositionCalculatorService

**Injectable:** `providedIn: 'root'` (singleton)

Internal service for DOM hit-testing and drop position calculation. Exported for advanced customization.

**Key Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `findDroppableAtPoint` | `(x, y, draggedElement, groupName) => HTMLElement \| null` | Find droppable element at cursor position |
| `findDraggableAtPoint` | `(x, y, draggedElement) => HTMLElement \| null` | Find draggable element at cursor position |
| `getDroppableId` | `(element) => string \| null` | Get droppable ID from element's data attribute |
| `calculateDropIndex` | `(scrollTop, cursorY, containerTop, itemHeight, totalItems) => number` | Fixed-height index math: `floor((cursorY - containerTop + scrollTop) / itemHeight)`, clamped to `[0, totalItems]` |
| `refreshCandidates` | `() => void` | Re-query the active drag's candidate droppables (picks up droppables added/removed mid-drag). Called automatically by droppable lifecycle hooks; exposed as a manual escape hatch |

### ElementCloneService

**Injectable:** `providedIn: 'root'` (singleton)

Internal service for cloning DOM elements for drag previews. Exported for advanced customization.

**Key Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `cloneElement` | `(source: HTMLElement) => HTMLElement` | Deep-clone an element with its computed styles inlined, for use as drag preview |

### KeyboardDragService

**Injectable:** `providedIn: 'root'` (singleton)

Internal service for keyboard drag state management. Exported for advanced customization.

### OverlayContainerService

**Injectable:** `providedIn: 'root'` (singleton)

Internal service for managing the body-level overlay container used by `DragPreviewComponent`. Exported for advanced customization.

---

## Configuration Types

### AutoScrollConfig

```typescript
interface AutoScrollConfig {
  threshold: number;   // Distance from edge to start scrolling (px). Default: 50
  maxSpeed: number;    // Maximum scroll speed in pixels per 60fps frame. Default: 15
  accelerate: boolean; // Accelerate based on distance from edge. Default: true
}
```

### DragPreviewContext

```typescript
interface DragPreviewContext<T = unknown> {
  $implicit: T;
  draggableId: string;
  droppableId: string;
}
```

### PlaceholderContext

```typescript
interface PlaceholderContext {
  $implicit: number; // height in pixels
  height: number;    // height in pixels
}
```

### VirtualScrollItemContext

```typescript
interface VirtualScrollItemContext<T> {
  $implicit: T;
  index: number;
  isSticky: boolean;
}
```

### VirtualForContext

```typescript
interface VirtualForContext<T> {
  $implicit: T;
  index: number;
  first: boolean;
  last: boolean;
  count: number;
}
```

### DraggedItem

```typescript
interface DraggedItem {
  draggableId: string;
  droppableId: string;
  element: HTMLElement;
  clonedElement?: HTMLElement;
  height: number;
  width: number;
  data?: unknown;
}
```

### CursorPosition

```typescript
interface CursorPosition {
  x: number;
  y: number;
}
```

### GrabOffset

```typescript
interface GrabOffset {
  x: number;
  y: number;
}
```

### DragState

```typescript
interface DragState {
  isDragging: boolean;
  draggedItem: DraggedItem | null;
  sourceDroppableId: string | null;
  sourceIndex: number | null;
  activeDroppableId: string | null;
  placeholderId: string | null; // deprecated: always END_OF_LIST or null, use placeholderIndex
  placeholderIndex: number | null;
  cursorPosition: CursorPosition | null;
  grabOffset: GrabOffset | null;
  initialPosition: CursorPosition | null;
  lockAxis: 'x' | 'y' | null;
  isKeyboardDrag: boolean;
  keyboardTargetIndex: number | null;
}
```

---

## Strategies

### VirtualScrollStrategy (Interface)

```typescript
interface VirtualScrollStrategy {
  readonly version: Signal<number>;
  getTotalHeight(itemCount: number): number;
  getFirstVisibleIndex(scrollTop: number): number;
  getVisibleCount(startIndex: number, containerHeight: number): number;
  getOffsetForIndex(index: number): number;
  getItemHeight(index: number): number;
  setMeasuredHeight(key: unknown, height: number): void;
  setItemKeys(keys: unknown[]): void;
  setExcludedIndex(index: number | null): void;
  findIndexAtOffset(offset: number): number;
  getItemCount(): number;
}
```

### FixedHeightStrategy

```typescript
class FixedHeightStrategy implements VirtualScrollStrategy {
  constructor(itemHeight: number);
}
```

Used by default when `dynamicItemHeight` is not set. Zero overhead — pure `index * itemHeight` math.

### DynamicHeightStrategy

```typescript
class DynamicHeightStrategy implements VirtualScrollStrategy {
  constructor(estimatedHeight: number);
}
```

Used when `dynamicItemHeight` is `true`. Auto-measures items via ResizeObserver. Uses prefix sums and binary search for O(log N) lookups.

---

## Tokens

### VDND_SCROLL_CONTAINER

```typescript
const VDND_SCROLL_CONTAINER: InjectionToken<VdndScrollContainer>;

interface VdndScrollContainer {
  readonly nativeElement: HTMLElement;
  scrollTop(): number;
  containerHeight(): number;
  scrollTo(options: ScrollToOptions): void;
}
```

Provided by: `VirtualViewportComponent`, `VirtualContentComponent`, `ScrollableDirective`

### VDND_VIRTUAL_VIEWPORT

```typescript
const VDND_VIRTUAL_VIEWPORT: InjectionToken<VdndVirtualViewport>;

interface VdndVirtualViewport {
  scrollTop(): number;
  containerHeight(): number;
  itemHeight(): number;
  contentOffset(): number;
  readonly nativeElement: HTMLElement;
  setRenderStartIndex(index: number): void;
  getOffsetForIndex(index: number): number;
  readonly strategy: VirtualScrollStrategy | null;
}
```

Provided by: `VirtualViewportComponent`, `VirtualContentComponent`

### VDND_GROUP_TOKEN

```typescript
const VDND_GROUP_TOKEN: InjectionToken<VdndGroupContext>;

interface VdndGroupContext {
  readonly group: Signal<string>;
}
```

Provided by: `DroppableGroupDirective`

### VDND_ANIMATION_CONFIG

```typescript
const VDND_ANIMATION_CONFIG: InjectionToken<VdndAnimationConfig>;

interface VdndAnimationConfig {
  shiftDuration?: number; // ms, default 200; 0 disables
  shiftEasing?: string;   // default 'cubic-bezier(0.2, 0, 0, 1)'
  dropDuration?: number;  // ms, default 200; 0 disables
  dropEasing?: string;    // default 'cubic-bezier(0.2, 0, 0, 1)'
}
```

Provided by: the consumer (opt-in). When present, items displaced by the placeholder slide via a `transform` animation (`composite: 'add'`, so item transforms are preserved) in `vdnd-virtual-scroll` / `vdnd-sortable-list` and `*vdndVirtualFor` lists, including into the committed order when the drag ends. On drop or cancel, `DragPreviewComponent` keeps the preview up (class `vdnd-drag-preview-dropping`) and glides it onto the item's rendered position after the `drop` handler ran (fading out in place if the item is not visible), hiding the real item until it lands; events are not delayed, and a new drag cancels it. Resolved through the element injector — provide app-wide or per component subtree. Skipped under `prefers-reduced-motion: reduce`. Values are read each time an animation starts (getters can toggle it at runtime).

---

## Constants

```typescript
const INITIAL_DRAG_STATE: DragState;
// All fields null/false — represents idle state

const END_OF_LIST = 'END_OF_LIST';
// Deprecated: the value of every placeholderId; positions are reported as indexes
```

