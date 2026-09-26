---
name: ngx-virtual-dnd
description: Integrate the ngx-virtual-dnd library — Angular drag-and-drop built for virtual scrolling — into Angular 21+ apps. Covers sortable and virtualized lists, cross-list drag (kanban boards), page-level scroll, dynamic item heights, drag handles, axis lock, auto-scroll, keyboard accessibility, custom previews, and the drop-handling utilities. Use this skill whenever the user works with ngx-virtual-dnd or any `vdnd`-prefixed selector (`vdndDraggable`, `vdndDroppable`, `vdndGroup`, `vdnd-sortable-list`, `*vdndVirtualFor`), or wants reorderable/draggable lists in Angular that must stay fast with hundreds or thousands of items — even if they only say "sortable list", "kanban", or "drag to reorder" and the project already depends on ngx-virtual-dnd.
metadata:
  author: gultyayev
---

# ngx-virtual-dnd

Angular drag-and-drop optimized for virtual scrolling: only visible items are rendered, so lists with thousands of items stay fast.

```bash
npm install ngx-virtual-dnd
```

Peer dependencies: `@angular/core` and `@angular/common` `^21 || ^22`. Everything is imported from `'ngx-virtual-dnd'`; all components and directives are standalone.

## How it fits together

- A **droppable** is a list container with an ID (`vdndDroppable`, or the `droppableId` of `<vdnd-sortable-list>`).
- A **draggable** is an item with an ID (`[vdndDraggable]`).
- A **group** name links draggables and droppables. Items can only move between droppables of the same group.
- When a drag starts, the dragged element is hidden (`display: none`), `<vdnd-drag-preview>` renders what follows the pointer, and an empty placeholder (`.vdnd-drag-placeholder`) marks the drop position.
- On release, the **destination** droppable emits `(drop)` with source/destination indexes. The library never mutates your data — you update your arrays, usually with `moveItem()`.

## Rules that fail silently

These mistakes produce no build error, only a list that does not drag or drops wrongly. Check every integration against them.

1. **Every draggable and droppable must resolve a group.** Either wrap them in an element with `vdndGroup="name"` or set `vdndDraggableGroup` / `vdndDroppableGroup` (`group` on `<vdnd-sortable-list>`). Without a group, drag is disabled and the only signal is a dev-mode `console.warn`. This applies to single lists too.

2. **Declare the item `<ng-template>` inside the `vdndGroup` element.** Angular templates resolve dependency injection from where they are *declared*, not where they are rendered. A template declared outside `vdndGroup` produces draggables with no group, even when the list that renders it sits inside the group. If the template must live elsewhere, set `vdndDraggableGroup` on the draggable.

3. **The `vdndDraggable` ID must equal the item's list ID** — `itemIdFn(item)` for `vdnd-sortable-list` / `vdnd-virtual-scroll`, or the `trackBy` key for `*vdndVirtualFor`. The list uses it to keep the dragged item rendered while it is scrolled out of view, to exclude it from layout math, and to find elements for height measurement. IDs are strings; convert numeric IDs (e.g. `String(item.id)`) consistently in both places.

4. **Draggable IDs must be unique across all lists, and droppable IDs unique on the page.** Drag state is a single app-wide service: every draggable whose ID matches the dragged ID is treated as being dragged and hidden.

5. **Render `<vdnd-drag-preview />` once** (anywhere — it moves itself to a body-level overlay). Without it, drag works but nothing follows the pointer.

6. **Give every virtual list a height.** Use `[containerHeight]` (px), or a CSS height on the scrolling element (`vdnd-virtual-scroll`, `vdnd-virtual-viewport`, or the `vdndScrollable` element). Virtual content is absolutely positioned, so a list without a height collapses to 0 px and renders nothing. When sizing `vdnd-sortable-list` with CSS, the height must reach its inner `vdnd-virtual-scroll` (global stylesheet or `::ng-deep`).

7. **Put `[vdndDraggable]` on the root element of the item template.** The draggable element is what gets hidden during drag; a wrapper around it would stay in the list and leave a gap. `*vdndVirtualFor` also measures and positions the template's root nodes.

8. **Bind `(drop)` on every list that can receive items.** It fires only on the destination droppable, so in a multi-list setup each list needs the handler.

## Quick start

`VirtualSortableListComponent` (`<vdnd-sortable-list>`) is the default choice: it combines the droppable, virtual scroll, placeholder, and keeps the dragged item rendered.

```typescript
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  DragPreviewComponent,
  DraggableDirective,
  DropEvent,
  DroppableGroupDirective,
  moveItem,
  VirtualSortableListComponent,
} from 'ngx-virtual-dnd';

interface Task {
  id: string;
  name: string;
}

@Component({
  selector: 'app-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    VirtualSortableListComponent,
    DroppableGroupDirective,
    DraggableDirective,
    DragPreviewComponent,
  ],
  template: `
    <div vdndGroup="board">
      <!-- Declared inside vdndGroup so the draggables inherit the group -->
      <ng-template #itemTpl let-item>
        <div class="item" [vdndDraggable]="item.id" [vdndDraggableData]="item">
          {{ item.name }}
        </div>
      </ng-template>

      <vdnd-sortable-list
        droppableId="todo"
        [items]="todo()"
        [itemHeight]="50"
        [containerHeight]="400"
        [itemIdFn]="getItemId"
        [itemTemplate]="itemTpl"
        (drop)="onDrop($event)"
      />

      <vdnd-sortable-list
        droppableId="done"
        [items]="done()"
        [itemHeight]="50"
        [containerHeight]="400"
        [itemIdFn]="getItemId"
        [itemTemplate]="itemTpl"
        (drop)="onDrop($event)"
      />
    </div>

    <vdnd-drag-preview />
  `,
})
export class BoardComponent {
  readonly todo = signal<Task[]>([]);
  readonly done = signal<Task[]>([]);

  readonly getItemId = (item: Task): string => item.id;

  onDrop(event: DropEvent): void {
    moveItem(event, { todo: this.todo, done: this.done });
  }
}
```

- The lists inherit the group from `vdndGroup`; the `group` input on `vdnd-sortable-list` is only needed when there is no `vdndGroup` ancestor.
- **Single list:** same markup with one `vdnd-sortable-list`, still inside a `vdndGroup`, and `reorderItems(event, this.items)` in the handler.
- `trackByFn` is optional; it defaults to `itemIdFn`.
- The item template receives `VirtualScrollItemContext`: `let-item` (the item), `let-index="index"` (index in the full list), `let-isSticky="isSticky"`.

## Handling drops

```typescript
interface DropEvent {
  source: { draggableId: string; droppableId: string; index: number; data?: unknown };
  destination: { droppableId: string; placeholderId: string; index: number; data?: unknown };
}
```

`destination.index` is the final insertion index **after** the item is removed from its source, so "remove at `source.index`, insert at `destination.index`" is always correct. `source.data` is the draggable's `vdndDraggableData`; `destination.data` is the droppable's `vdndDroppableData` (`droppableData` on `vdnd-sortable-list`).

| Function                      | Use when                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `moveItem(event, lists)`      | Lists are `WritableSignal<T[]>`. `lists` maps droppable IDs to signals and must contain every ID that can appear in a drop, or the drop is ignored (dev-mode warning). Handles same-list and cross-list moves. |
| `reorderItems(event, list)`   | One signal-based list. Only reorders — do not use for cross-list drops.                                                                            |
| `applyMove(event, lists)`     | Immutable state (NgRx, services). Takes `Record<string, T[]>`, returns a new record with new arrays for the changed lists.                          |
| `isNoOpDrop(event)`           | `true` when the item was dropped back at its own position. Useful to skip store dispatches or API calls.                                           |
| `insertAt(list, item, index)` | Returns a new array with `item` inserted.                                                                                                          |
| `removeAt(list, index)`       | Returns a new array without the item at `index`.                                                                                                   |

```typescript
// Store-based
onDrop(event: DropEvent): void {
  if (isNoOpDrop(event)) return;
  const lists = applyMove(event, { todo: this.store.todo(), done: this.store.done() });
  this.store.setLists(lists);
}
```

With virtual scrolling most items are not in the DOM, so always derive the move from the event indexes — never from DOM order.

## Choosing a list approach

| Approach            | Building blocks                                                  | When                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sortable list       | `<vdnd-sortable-list>`                                           | Default. Least code.                                                                                                                                       |
| Low-level           | `vdndDroppable` + `<vdnd-virtual-scroll>`                        | You need your own markup around the scroller, or options the sortable list doesn't expose (`stickyItemIds`, `scrollContainerId`, programmatic scrolling). |
| Page / external scroll | `vdndScrollable` + `<vdnd-virtual-content>` + `*vdndVirtualFor` | The list scrolls with the page or a shared container (e.g. Ionic `ion-content`) together with headers and footers.                                       |

All three support dynamic heights, auto-scroll, and cross-list drag. `<vdnd-virtual-viewport>` is a lower-level building block: a self-scrolling viewport for `*vdndVirtualFor` (see the API reference).

### Low-level

```typescript
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    VirtualScrollContainerComponent,
    DroppableGroupDirective,
    DroppableDirective,
    DraggableDirective,
    DragPreviewComponent,
  ],
  template: `
    <div vdndGroup="tasks">
      <ng-template #itemTpl let-item>
        <div class="item" [vdndDraggable]="item.id" [vdndDraggableData]="item">
          {{ item.name }}
        </div>
      </ng-template>

      <div vdndDroppable="list-1" (drop)="onDrop($event)">
        <vdnd-virtual-scroll
          droppableId="list-1"
          [items]="items()"
          [itemHeight]="50"
          [containerHeight]="400"
          [itemIdFn]="getItemId"
          [itemTemplate]="itemTpl"
        />
      </div>
    </div>

    <vdnd-drag-preview />
  `,
})
export class ListComponent {
  readonly items = signal<Task[]>([]);
  readonly getItemId = (item: Task): string => item.id;

  onDrop(event: DropEvent): void {
    reorderItems(event, this.items);
  }
}
```

Pass the same ID to `vdndDroppable` and to `droppableId` on `vdnd-virtual-scroll` — the scroller needs it to show the placeholder. `vdnd-virtual-scroll` also exposes `scrollTo(px)`, `scrollToIndex(i)`, `scrollBy(delta)`, `getScrollTop()`, and `getScrollHeight()` (get it with `viewChild(VirtualScrollContainerComponent)`).

### Page-level scroll

```typescript
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScrollableDirective,
    VirtualContentComponent,
    VirtualForDirective,
    ContentHeaderDirective,
    DraggableDirective,
    DroppableDirective,
    DroppableGroupDirective,
    DragPreviewComponent,
  ],
  template: `
    <!-- Must be scrollable: overflow auto + a height -->
    <div class="page" vdndScrollable>
      <div vdndGroup="tasks">
        <vdnd-virtual-content [itemHeight]="72" vdndDroppable="list-1" (drop)="onDrop($event)">
          <!-- Auto-measured header that scrolls with the list -->
          <h2 vdndContentHeader>Tasks</h2>

          <ng-container *vdndVirtualFor="let item of items(); trackBy: trackById">
            <div class="item" [vdndDraggable]="item.id">{{ item.name }}</div>
          </ng-container>
        </vdnd-virtual-content>
      </div>

      <footer>Normal content after the list</footer>
    </div>

    <vdnd-drag-preview />
  `,
  styles: `.page { height: 100vh; overflow: auto; }`,
})
export class PageComponent {
  readonly items = signal<Task[]>([]);
  readonly trackById = (_index: number, item: Task): string => item.id;

  onDrop(event: DropEvent): void {
    reorderItems(event, this.items);
  }
}
```

- `vdnd-virtual-content` must be inside a `vdndScrollable` element, and that element must be the one that actually scrolls.
- **Ionic:** `<ion-content>` scrolls an element inside its shadow DOM, so don't put `vdndScrollable` on `ion-content` itself. Disable its scrolling and use a light-DOM scroll host:

  ```html
  <ion-content [scrollY]="false">
    <div class="ion-content-scroll-host" vdndScrollable>
      <!-- vdndGroup, vdnd-virtual-content, footer ... -->
    </div>
  </ion-content>
  ```

  Give `.ion-content-scroll-host` `height: 100%; overflow-y: auto;`.
- `vdndContentHeader` marks a projected header; its height is measured automatically and used as the list's offset. If the header lives outside the component, pass its height via `[contentOffset]` instead.
- Inside `vdnd-virtual-content` / `vdnd-virtual-viewport`, `*vdndVirtualFor` inherits `itemHeight` and `dynamicItemHeight` from the parent component and `droppableId` from the enclosing `vdndDroppable` — only `trackBy` is required. Used directly inside a `vdndScrollable`, it also needs `itemHeight`.

## Dynamic item heights

Set `[dynamicItemHeight]="true"`; `itemHeight` becomes the estimate for unmeasured items. Rendered items are measured with `ResizeObserver`, and heights are cached by item ID, so they survive reordering. Changing `dynamicItemHeight` or `itemHeight` at runtime restarts from the estimate and re-measures the rendered items; turning `dynamicItemHeight` off stops measuring.

```html
<vdnd-sortable-list
  droppableId="notes"
  [items]="notes()"
  [itemHeight]="80"
  [dynamicItemHeight]="true"
  [containerHeight]="500"
  [itemIdFn]="getItemId"
  [itemTemplate]="noteTpl"
  (drop)="onDrop($event)"
/>

<!-- Same input on vdnd-virtual-scroll, vdnd-virtual-content, vdnd-virtual-viewport -->
<vdnd-virtual-content [itemHeight]="80" [dynamicItemHeight]="true" vdndDroppable="notes">
  ...
</vdnd-virtual-content>

<!-- *vdndVirtualFor used directly in a vdndScrollable (no parent viewport) -->
<ng-container
  *vdndVirtualFor="let item of items(); itemHeight: 80; dynamicItemHeight: true; trackBy: trackById"
>
  ...
</ng-container>
```

Measurement relies on rules 3 and 7: the measured element is the one whose `data-draggable-id` (set by `vdndDraggable`) matches the item ID, or the template's root node for `*vdndVirtualFor`.

## Draggable options

```html
<div
  [vdndDraggable]="item.id"
  [vdndDraggableData]="item"
  dragHandle=".handle"
  [dragThreshold]="5"
  [dragDelay]="0"
  lockAxis="x"
  [disabled]="!item.movable"
  (dragStart)="onDragStart($event)"
  (dragEnd)="onDragEnd($event)"
>
  <span class="handle">⠿</span> {{ item.name }}
</div>
```

- **`dragHandle`** — CSS selector; only pointer-downs inside a matching element start a drag. Make the handle a non-button element (e.g. a `span`), because pointer-downs inside a `<button>` never start a drag (see next point).
- **Interactive children** — pointer-downs inside a `button`, `input`, `textarea`, `select`, or `[contenteditable]` element never start a drag, so controls inside items keep working. The same applies to an element with class `no-drag` and everything inside it. Only the primary mouse button starts a drag. `Space` pressed in such a control (or inside a `no-drag` element) inside an item goes to the control instead of starting a keyboard drag, unless the control is the `dragHandle`. `no-drag` on the draggable element itself stops pointer drags but not `Space` on the item; use `disabled` to turn dragging off. Controls inside a web component's shadow DOM and ARIA widgets (e.g. `role="switch"`) are not detected: add `no-drag` to the web component element or the widget.
- **`dragThreshold`** (default `5`) — pixels the pointer must move before the drag starts.
- **`dragDelay`** (default `0`) — ms the pointer must be held first. Moving past the threshold before the delay ends aborts the drag, so touch users can still scroll the list. When the delay has passed the element gets `vdnd-drag-pending` — style it to show the item is ready.
- **`lockAxis`** — names the axis that is **frozen**: `'x'` → vertical-only movement, `'y'` → horizontal-only. This is the opposite of Angular CDK's `cdkDragLockAxis`.
- **`disabled`** — the item cannot be dragged and gets `tabindex="-1"` and `vdnd-draggable-disabled`.
- **One drag at a time** — while an item is being dragged (pointer or keyboard), presses and `Space` on other items do not start a second drag, so a second finger on a touch screen cannot take over the drag.

## Droppable and list options

These inputs exist on `vdndDroppable` and on `vdnd-sortable-list`:

- **`disabled`** — the droppable is skipped as a target: pointer hit-testing falls through to whatever enabled droppable is underneath, and keyboard ArrowLeft/ArrowRight skip it. Releasing over it emits no `(drop)`; `(dragEnd)` still fires with `cancelled: false` and `destinationIndex: null`. It gets `vdnd-droppable-disabled`.
- **`constrainToContainer`** — clamps the preview and the drop position to the container's bounds (the nearest `vdndScrollable` ancestor if there is one, otherwise the droppable).
- **`autoScrollEnabled`** (default `true`) and **`autoScrollConfig`** — edge scrolling while dragging near the edge of a scrollable container. Also available on `vdnd-virtual-scroll`, `vdnd-virtual-viewport`, and `vdndScrollable`.

| `autoScrollConfig` key | Default | Meaning                                    |
| ---------------------- | ------- | ------------------------------------------ |
| `threshold`            | `50`    | Distance from the edge (px) that triggers scrolling |
| `maxSpeed`             | `15`    | Max pixels per 60 fps frame                |
| `accelerate`           | `true`  | Scroll faster the closer the pointer is to the edge |

List rendering options:

- **`overscan`** (default `3`) — extra items rendered above and below the viewport. On `vdnd-sortable-list`, `vdnd-virtual-scroll`, and `*vdndVirtualFor` (`overscan: 5` in the microsyntax).
- **`stickyItemIds`** (`vdnd-virtual-scroll` only) — IDs of items that stay rendered at any scroll position. The dragged item is kept rendered automatically (`autoStickyDraggedItem`, default `true`).

## Drag preview and placeholder

By default the preview is a styled clone of the dragged element. Supply a template to render your own:

```html
<ng-template #preview let-item let-draggableId="draggableId" let-droppableId="droppableId">
  <div class="preview-card">Moving {{ item.name }}</div>
</ng-template>

<vdnd-drag-preview [previewTemplate]="preview" />
```

- `$implicit` is the draggable's `vdndDraggableData` (`null` if none was set), so pass `[vdndDraggableData]` when using a template.
- The preview box is sized to the dragged element's width and height and keeps the point where the user grabbed the item under the pointer. `cursorOffset` (default `{ x: 8, y: 8 }`) is only a fallback for when no grab offset is known; library-started drags always have one.
- The preview element has class `vdnd-drag-preview` and is moved into a body-level `div.vdnd-overlay-container` (this escapes ancestor `transform`s that would break `position: fixed`). Your component's styles still apply to elements in the preview template, but selectors that depend on ancestors (e.g. `.board .card`) no longer match — style the preview by its own classes.

The drop-position placeholder rendered inside lists is an empty element with height equal to the dragged item. Style it globally:

```css
.vdnd-drag-placeholder {
  border: 2px dashed #9aa4b2;
  border-radius: 8px;
  box-sizing: border-box;
}
```

`PlaceholderComponent` (`<vdnd-placeholder [template]>`) is a standalone indicator you can render yourself; the built-in lists do not use it.

## Shift and drop animations, haptics

Displaced items jump into place and the preview vanishes on drop unless `VDND_ANIMATION_CONFIG` is provided (app config or a component's `providers`):

```typescript
providers: [{ provide: VDND_ANIMATION_CONFIG, useValue: { shiftDuration: 200 } }]
// optional: shiftEasing (default 'cubic-bezier(0.2, 0, 0, 1)'); shiftDuration: 0 disables
// optional: dropDuration (default 200; 0 disables), dropEasing (same default as shiftEasing)
```

Items then slide into their new position (works with virtual scrolling and dynamic heights; skipped under reduced motion; a new move mid-slide continues from the current spot). Don't add your own CSS `transition` on item `transform`/`top` to get this — items are repositioned by layout (or inline `top` for a bare `*vdndVirtualFor`), and such a transition competes with the built-in slide. Consumer transforms on rows are kept (the slide uses `composite: 'add'`). When the drag ends, rows slide into the committed order too (after a cancel they slide back).

With the config present, the drop animation also plays: on drop or cancel the preview stays up (class `vdnd-drag-preview-dropping`) and glides from the release point onto the item's final position, while that item stays invisible (`opacity` animation) until it lands. `drop`/`dragEnd` still fire immediately — it is purely visual. It lands on the item as rendered after your `(drop)` handler, so commit the move synchronously (`moveItem()`/`reorderItems()`); if the item is not rendered or scrolled out of view, the preview fades out in place. A new drag cuts it short. Set `dropDuration: 0` to keep shift animations only.

For haptics on every step, use `(placeholderMove)` on `vdndDroppable` / `vdnd-sortable-list` (`PlaceholderMoveEvent`: `previousIndex` → `currentIndex`, same index convention as `DropEvent.destination.index`; `previousIndex` is `null` when the placeholder entered the list). Not emitted for the initial pick-up or when the placeholder leaves.

## Drag state

Inject `DragStateService` (root singleton) to react to drags anywhere, e.g. to highlight valid targets:

```typescript
protected readonly dragState = inject(DragStateService);
// template: @if (dragState.isDragging()) { <p class="hint">Drop into a list</p> }
```

Useful signals: `isDragging`, `draggedItem`, `draggedItemId`, `sourceDroppableId`, `sourceIndex`, `activeDroppableId`, `placeholderIndex`, `isKeyboardDrag`. The full list is in the API reference. For per-list highlighting, the `vdnd-droppable-active` class is simpler.

## Keyboard and accessibility

| Key                  | Not dragging                      | During a keyboard drag                                      |
| -------------------- | --------------------------------- | ----------------------------------------------------------- |
| `Tab`                | Moves focus between draggables    | Cancels the drag                                            |
| `Space`              | Picks up the focused item         | Drops                                                       |
| `Enter`              | —                                 | Drops                                                       |
| `ArrowUp`/`ArrowDown`| —                                 | Moves the target position                                   |
| `ArrowLeft`/`ArrowRight` | —                             | Moves to the neighbouring droppable of the same group, by on-screen x position (disabled ones skipped) |
| `Escape`             | —                                 | Cancels (also cancels pointer drags)                        |

Managed automatically: `tabindex` (`0`, or `-1` when disabled) and `aria-grabbed` on draggables, `aria-dropeffect="move"` on droppables. After a keyboard drag ends, focus returns to the moved item.

The library does not announce anything to screen readers (to leave wording and i18n to you). Use the events:

```typescript
@Component({
  template: `
    <div vdndGroup="tasks">
      <ng-template #itemTpl let-item>
        <div
          [vdndDraggable]="item.id"
          (dragStart)="announce('Picked up ' + item.name + ', position ' + ($event.sourceIndex + 1))"
          (dragEnd)="announceEnd($event)"
        >
          {{ item.name }}
        </div>
      </ng-template>
      <!-- vdnd-sortable-list using itemTpl ... -->
    </div>
    <div class="sr-only" aria-live="assertive">{{ announcement() }}</div>
  `,
})
export class TasksComponent {
  readonly announcement = signal('');

  announce(message: string): void {
    this.announcement.set(message);
  }

  announceEnd(event: DragEndEvent): void {
    this.announce(
      event.destinationIndex === null
        ? `Cancelled. Back at position ${event.sourceIndex + 1}`
        : `Dropped at position ${event.destinationIndex + 1}`,
    );
  }
}
```

## Events

| Output        | Type             | Emitted by                                          |
| ------------- | ---------------- | --------------------------------------------------- |
| `(dragStart)` | `DragStartEvent` | `vdndDraggable`                                     |
| `(dragEnd)`   | `DragEndEvent`   | `vdndDraggable` — after every drag, dropped or not  |
| `(drop)`      | `DropEvent`      | `vdndDroppable`, `vdnd-sortable-list` — destination only |
| `(placeholderMove)` | `PlaceholderMoveEvent` | `vdndDroppable`, `vdnd-sortable-list` — each placeholder move within that list (haptics) |

`DragEndEvent.destinationIndex` is `null` when nothing was dropped: Escape/Tab cancel, a pointer drag cancelled because the window lost focus or the page was hidden, release outside every droppable, or release over a disabled droppable. Branch on `destinationIndex === null` to detect "no drop"; `cancelled` is `true` only when the drag was cancelled (Escape, Tab, focus loss), so it misses the other cases.

## CSS classes

| Class                                                 | On                                   | When                                  |
| ----------------------------------------------------- | ------------------------------------ | ------------------------------------- |
| `vdnd-draggable`                                      | `[vdndDraggable]`                    | Always                                |
| `vdnd-draggable-dragging`                             | `[vdndDraggable]`                    | While dragged (element is `display: none`) |
| `vdnd-draggable-disabled`                             | `[vdndDraggable]`                    | `disabled` is true                    |
| `vdnd-drag-pending`                                   | `[vdndDraggable]`                    | `dragDelay` has elapsed, drag not started yet |
| `vdnd-droppable`                                      | `[vdndDroppable]`                    | Always                                |
| `vdnd-droppable-active`                               | `[vdndDroppable]`                    | Pointer or keyboard target is this droppable |
| `vdnd-droppable-disabled`                             | `[vdndDroppable]`                    | `disabled` is true                    |
| `vdnd-drag-placeholder`, `vdnd-drag-placeholder-visible` | Drop-position placeholder         | Rendered only during drag, in the target list |
| `vdnd-drag-preview`                                   | Preview box inside `vdnd-drag-preview` | During drag                         |
| `vdnd-drag-preview-dropping`                          | Preview box                          | While it plays the drop animation (`VDND_ANIMATION_CONFIG`) |
| `vdnd-overlay-container`                              | Body-level container for the preview | Once `<vdnd-drag-preview>` has rendered |
| `vdnd-sortable-list`, `vdnd-virtual-scroll`, `vdnd-virtual-viewport`, `vdnd-virtual-content`, `vdnd-scrollable`, `vdnd-placeholder` | Their host elements | Always |

## Troubleshooting

| Symptom                                                    | Likely cause                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Nothing drags; console shows "requires a group"            | No group resolved — add `vdndGroup` and declare the item template inside it (rules 1–2)        |
| List area is empty / 0 px tall                             | No height (rule 6)                                                                             |
| Dragging works but nothing follows the pointer             | Missing `<vdnd-drag-preview />`                                                                 |
| Drag cancels when the dragged item scrolls out of view, or dynamic heights are wrong | `vdndDraggable` ID ≠ `itemIdFn`/`trackBy` value (rule 3)                     |
| Items in other lists disappear while dragging              | Duplicate draggable IDs across lists (rule 4)                                                  |
| Cannot drop into another list                              | Lists are in different groups, or that list has no `(drop)` handler (rule 8)                   |
| Drop fires but the arrays don't change                     | `moveItem` keys don't match the `droppableId`s                                                 |
| A gap stays where the item was                             | `vdndDraggable` is nested inside a wrapper element (rule 7)                                    |
| A custom control inside an item starts a drag instead of working | Add class `no-drag` to the control (it covers everything inside it), or use `dragHandle` |
| Preview loses styling                                     | Styles relied on ancestor selectors; the preview lives under `<body>` — target its own classes |

## API reference

Complete input/output tables, event and context types, services, strategies, tokens, and constants: [references/api-reference.md](references/api-reference.md). Read it when you need an input not covered above, a type signature, or advanced APIs (custom `VirtualScrollStrategy`, injection tokens, `AutoScrollService`).
