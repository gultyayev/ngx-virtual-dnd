---
name: ngx-virtual-dnd
description: Integrate the ngx-virtual-dnd library — Angular drag-and-drop built for virtual scrolling — into Angular 21 and 22 apps. Covers sortable and virtualized lists, cross-list drag (kanban boards), page-level scroll, dynamic item heights, drag handles, axis lock, auto-scroll, keyboard accessibility, custom previews, animations, testing, migrating from Angular CDK drag-drop, and the drop-handling utilities. Use this skill whenever the user works with ngx-virtual-dnd or any `vdnd`-prefixed selector (`vdndDraggable`, `vdndDroppable`, `vdndGroup`, `vdnd-sortable-list`, `*vdndVirtualFor`), or wants reorderable/draggable lists in Angular that must stay fast with hundreds or thousands of items — even if they only say "sortable list", "kanban", or "drag to reorder" and the project already depends on ngx-virtual-dnd.
metadata:
  author: gultyayev
---

# ngx-virtual-dnd

Angular drag-and-drop optimized for virtual scrolling: only visible items are rendered, so lists with thousands of items stay fast.

```bash
npm install ngx-virtual-dnd
```

- Peer dependencies: `@angular/core` and `@angular/common` `^21 || ^22`. No providers and no global stylesheet to register.
- Everything is imported from `'ngx-virtual-dnd'`; all components and directives are standalone.
- Works in zoneless and zone.js apps (`dragStart`, `dragEnd` and `drop` are emitted inside the zone), and with SSR and hydration (lists render their first rows on the server; dragging starts in the browser).
- Docs: https://gultyayev.github.io/ngx-virtual-dnd/. Every page is also served as Markdown: append `.md` to its path, e.g. `https://gultyayev.github.io/ngx-virtual-dnd/guide/more/limitations.md`. The whole site is in `llms-full.txt`.

## How it fits together

- A **droppable** is a list container with an ID (`vdndDroppable`, or the `droppableId` of `<vdnd-sortable-list>`).
- A **draggable** is an item with an ID (`[vdndDraggable]`).
- A **group** name links draggables and droppables. Items can only move between droppables of the same group.
- When a drag starts, the dragged element is hidden (`display: none`), `<vdnd-drag-preview>` renders what follows the pointer, and an empty placeholder (`.vdnd-drag-placeholder`) marks the drop position.
- On release, the dragged item emits `(dragEnd)`, then the **destination** droppable emits `(drop)` with source/destination indexes (both before the next render). The library never mutates your data — you update your arrays, usually with `moveItem()`.

## Rules that fail silently

These mistakes produce no build error, only a list that does not drag or drops wrongly. Check every integration against them.

1. **Every draggable and droppable must resolve a group.** Either wrap them in an element with `vdndGroup="name"` or set `vdndDraggableGroup` / `vdndDroppableGroup` (`group` on `<vdnd-sortable-list>`). Without a group, drag is disabled and the only signal is a dev-mode `console.warn` ("requires a group"). This applies to single lists too.

2. **Declare the item `<ng-template>` inside the `vdndGroup` element.** Angular templates resolve dependency injection from where they are *declared*, not where they are rendered. A template declared outside `vdndGroup` produces draggables with no group, even when the list that renders it sits inside the group. If the template must live elsewhere, set `vdndDraggableGroup` on the draggable.

3. **The `vdndDraggable` ID must equal the item's list ID** — `itemIdFn(item)` for `vdnd-sortable-list` / `vdnd-virtual-scroll`, or the `trackBy` key for `*vdndVirtualFor`. The list uses it to keep the dragged item rendered while it is scrolled out of view, to exclude it from layout math, and to find elements for height measurement. IDs are strings; convert numeric IDs (e.g. `String(item.id)`) the same way in both places.

4. **Draggable IDs must be unique across all lists, and droppable IDs unique on the page.** Drag state is a single app-wide service: every draggable whose ID matches the dragged ID is treated as being dragged and hidden.

5. **Render `<vdnd-drag-preview />` once** (anywhere — it moves itself to a body-level overlay). Without it, drag works but nothing follows the pointer.

6. **Give every virtual list a height.** Use `[containerHeight]` (px), or a CSS height on the scrolling element (`vdnd-virtual-scroll`, `vdnd-virtual-viewport`, or the `vdndScrollable` element). Virtual content is absolutely positioned, so a list without a height collapses to 0 px and renders nothing. When sizing `vdnd-sortable-list` with CSS, the height must reach its inner `vdnd-virtual-scroll` (global stylesheet or `::ng-deep`).

7. **Put `[vdndDraggable]` on the root element of the item template.** The draggable element is what gets hidden during drag; a wrapper around it would stay in the list and leave a gap. `*vdndVirtualFor` also measures and positions the template's root nodes.

8. **Bind `(drop)` on every list that can receive items.** It fires only on the destination droppable, so in a multi-list setup each list needs the handler.

9. **With fixed heights, every row must be exactly `itemHeight` px tall**, borders and padding included (`box-sizing: border-box`). Fixed-height offsets are `index * itemHeight`, so rows of another height drift from the calculated positions and items drop in the wrong place. Use `[dynamicItemHeight]="true"` when rows differ.

## Quick start

`VirtualSortableListComponent` (`<vdnd-sortable-list>`) is the default choice: it combines the droppable, the virtual scroller and the placeholder.

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
- The library styles neither rows nor the placeholder: style `.vdnd-drag-placeholder` globally (see Drag preview and placeholder) and keep rows exactly `itemHeight` tall (rule 9).

## Handling drops

```typescript
interface DropEvent {
  source: { draggableId: string; droppableId: string; index: number; data?: unknown };
  destination: { droppableId: string; placeholderId: string; index: number; data?: unknown }; // placeholderId is deprecated (always END_OF_LIST): use index
}
```

- `destination.index` is the final insertion index **after** the item is removed from its source, so "remove at `source.index`, insert at `destination.index`" is always correct.
- `source.data` is the draggable's `vdndDraggableData`; `destination.data` is the droppable's `vdndDroppableData` (`droppableData` on `vdnd-sortable-list`).
- With virtual scrolling most items are not in the DOM, so always derive the move from the event indexes — never from DOM order.

| Function | Use when |
|---|---|
| `moveItem(event, lists)` | Lists are `WritableSignal<T[]>`, keyed by droppable ID. Same-list and cross-list moves. A drop whose IDs are missing from `lists` is ignored (dev-mode warning). |
| `reorderItems(event, list)` | One signal-based list. Reorders only — not for cross-list drops. |
| `applyMove(event, lists)` | Immutable state (NgRx, services). Takes `Record<string, T[]>`, returns a new record with new arrays for the changed lists. |
| `isNoOpDrop(event)` | `true` when the item was dropped back at its own position. Use it to skip store dispatches or API calls. |
| `insertAt(list, item, index)` | Returns a new array with `item` inserted. |
| `removeAt(list, index)` | Returns a new array without the item at `index`. |

```typescript
// Store-based
onDrop(event: DropEvent): void {
  if (isNoOpDrop(event)) return;
  const lists = applyMove(event, { todo: this.store.todo(), done: this.store.done() });
  this.store.setLists(lists);
}

// Saving to a server: apply the move at once, roll back if the request fails
onDrop(event: DropEvent): void {
  if (isNoOpDrop(event)) return;
  const previous = { todo: this.todo(), done: this.done() };
  moveItem(event, { todo: this.todo, done: this.done });
  this.api
    .moveTask(event.source.draggableId, event.destination.droppableId, event.destination.index)
    .subscribe({ error: () => { this.todo.set(previous.todo); this.done.set(previous.done); } });
}
```

**Lists in different components** form one group when their `vdndGroup` names match (each component declares its item template inside its own `vdndGroup`). Only the destination list emits `(drop)`, so keep the lists' data in a shared service or store and apply the move there (`applyMove`).

## Choosing a list approach

| Approach | Building blocks | When |
|---|---|---|
| Sortable list | `<vdnd-sortable-list>` | Default. Least code. |
| Low-level | `vdndDroppable` + `<vdnd-virtual-scroll>` | Your own markup around the scroller, or options the sortable list doesn't expose (`stickyItemIds`, `scrollContainerId`, programmatic scrolling). |
| Page / external scroll | `vdndScrollable` + `<vdnd-virtual-content>` + `*vdndVirtualFor` | The list scrolls with the page or a shared container (e.g. Ionic `ion-content`) together with headers and footers. |

All of them support dynamic heights, auto-scroll, keyboard dragging and cross-list drag. `<vdnd-virtual-viewport>` is a lower-level building block: a self-scrolling viewport for `*vdndVirtualFor`; put `vdndDroppable` on the viewport itself (see the API reference).

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
        <div class="item" [vdndDraggable]="item.id">{{ item.name }}</div>
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

Pass the same ID to `vdndDroppable` and to `droppableId` on `vdnd-virtual-scroll` — the scroller needs it to show the placeholder. `vdnd-virtual-scroll` also exposes `scrollTo(px)`, `scrollToIndex(i)`, `scrollBy(delta)`, `getScrollTop()` and `getScrollHeight()` (get it with `viewChild(VirtualScrollContainerComponent)`).

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
- Inside `vdnd-virtual-content` / `vdnd-virtual-viewport`, `*vdndVirtualFor` inherits `itemHeight` and `dynamicItemHeight` from the parent component and `droppableId` from the enclosing `vdndDroppable` — only `trackBy` is required. Used directly inside a `vdndScrollable`, it also needs `itemHeight`; it positions its rows absolutely and sets `position: relative` on that element when nothing between it and the rows is positioned.
- `vdndContentHeader` marks a projected header. Where the rows start below it is measured (the header's margins and anything above it in the scroll container, such as padding, count) and used as the list's offset, again when the header or the scroll container resizes. For a header outside the component, pass the space above the rows (from inside the container's border) via `[contentOffset]` instead.
- **Ionic:** `<ion-content>` scrolls an element inside its shadow DOM, so don't put `vdndScrollable` on `ion-content` itself. Disable its scrolling and use a light-DOM scroll host with `height: 100%; overflow-y: auto;`:

  ```html
  <ion-content [scrollY]="false">
    <div class="ion-content-scroll-host" vdndScrollable>
      <!-- vdndGroup, vdnd-virtual-content, footer ... -->
    </div>
  </ion-content>
  ```

- **Sticky header or footer inside the scroll container:** pass the heights they cover as `[scrollInsetTop]` / `[scrollInsetBottom]` on `vdndScrollable`. You measure them (e.g. with a `ResizeObserver`); the drag then treats only the uncovered part as the container (constraint, auto-scroll edges, hit-testing, keyboard reveal). `vdnd-sortable-list`, `vdnd-virtual-scroll` and `vdnd-virtual-viewport` take the same inputs for content overlaid on their own rows. Details and a measuring example: [guides](references/guides.md#sticky-headers-and-scroll-insets).

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

- **`dragHandle`** — CSS selector; only presses inside a matching element within the item start a drag (a matching ancestor of the item doesn't count). Make the handle a non-control element such as a `span`: presses inside a `<button>` in the item never start a drag. Keyboard dragging is unaffected.
- **`dragThreshold`** (default `5`) — pixels the pointer must move before the drag starts.
- **`dragDelay`** (default `0`) — ms the pointer must be held first. Moving past the threshold before the delay ends aborts the drag, so touch users can still scroll the list. When the delay has passed the element gets `vdnd-drag-pending` — style it to show the item is ready. 150–250 ms suits touch lists. A long press also selects text (and opens the iOS callout on links and images): set `user-select: none; -webkit-touch-callout: none;` on rows that drag after a delay, or on their handle, and `user-select: text` back on editable content inside them.
- **`lockAxis`** — names the axis that is **frozen**: `'x'` → vertical-only movement, `'y'` → horizontal-only. The opposite of Angular CDK's `cdkDragLockAxis`.
- **`disabled`** — the item cannot be dragged and gets `tabindex="-1"` and `vdnd-draggable-disabled`.
- **One drag at a time** — while an item is being dragged (pointer or keyboard), presses and `Space` on other items do not start a second drag, so a second finger cannot take over.
- Only the primary mouse button starts a drag.

### Controls inside items

- Pressing a `button`, `input`, `textarea`, `select` or `[contenteditable]` element inside an item never starts a drag, and `Space` there types or clicks instead of picking the item up (unless that control is the `dragHandle`).
- Only controls **inside** the item count: a control around the list doesn't block a drag, and neither does `contenteditable="false"`.
- Other controls are not detected (ARIA widgets such as `role="switch"`, inputs inside a web component's shadow DOM). Add class `no-drag` to them — it covers everything inside it; for a web component, put it on the component element.
- `no-drag` on the draggable element itself stops pointer drags but not `Space` on the item. Use `disabled` to turn dragging off.

### Items that are controls

- A `<button vdndDraggable>` (or an `input` of type `button`, `submit`, `reset` or `image`) drags normally.
- A draggable that is another control (text field, checkbox, `select`, `[contenteditable]`) keeps its own press and `Space`: a press focuses, opens, toggles or places the caret. Only a `dragHandle` inside it starts a pointer drag, and only `Space` on a **focusable** handle picks it up. Without one it can't be moved with the keyboard.
- An `input`, `textarea` or `select` can't hold a handle: make a wrapper row the draggable and put the control inside it.
- An editable block needs a grip like `<span class="grip" contenteditable="false" tabindex="0" role="button" aria-label="Drag block">` with `dragHandle=".grip"`. After a keyboard drop or cancel, focus returns to the block itself (the caret lands in it).
- Rows **inside** a `[contenteditable]` editor drag on press (no caret); give them a `dragHandle` to keep their text editable with the mouse. In Chromium, `Space` on such a row goes to the editor; Firefox and Safari pick the row up.

## Droppable and list options

These inputs exist on `vdndDroppable` and on `vdnd-sortable-list`:

- **`disabled`** — the droppable is skipped as a target: pointer hit-testing falls through to whatever enabled droppable is underneath, and keyboard ArrowLeft/ArrowRight skip it. Releasing over it emits no `(drop)`; `(dragEnd)` fires with `destinationIndex: null`. Its items can still be dragged out (disable the draggables too for a read-only list). It gets `vdnd-droppable-disabled`.
- **Hidden droppables** (`display: none` or `visibility: hidden` on it or an ancestor, or zero size) are skipped the same way, also when hidden or shown mid-drag.
- **Accepting only some items:** there is no enter predicate, and returning early from `(drop)` still lets the list open a placeholder slot during the drag (a drop that then does not happen). Bind `disabled` from the drag state instead; it is read on every hit-test, so a change mid-drag applies from the next frame:

  ```typescript
  readonly #dragState = inject(DragStateService);
  // Draggables set [vdndDraggableData]="task"
  readonly doneRejectsDrag = computed(() => {
    const task = this.#dragState.draggedItem()?.data as Task | undefined;
    return task !== undefined && !task.assignee;
  });
  // <vdnd-sortable-list droppableId="done" [disabled]="doneRejectsDrag()" ... />
  ```

- **`constrainToContainer`** — clamps the preview and the drop position to the container: the nearest `vdndScrollable` ancestor if there is one, otherwise the droppable. Holding the preview at the top or bottom edge drops at the first or last position once the list is scrolled to that end. Sticky content inside a `vdndScrollable` is excluded via its scroll insets.
- **`autoScrollEnabled`** (default `true`) and **`autoScrollConfig`** — edge scrolling while dragging near the edge of a scrollable container, on both axes. Also on `vdnd-virtual-scroll`, `vdnd-virtual-viewport` and `vdndScrollable`. Nested containers scroll innermost first, then the outer one once the inner reaches its end.

| `autoScrollConfig` key | Default | Meaning |
|---|---|---|
| `threshold` | `50` | Distance from the edge (px) that triggers scrolling |
| `maxSpeed` | `15` | Max pixels per 60 fps frame |
| `accelerate` | `true` | Scroll faster the closer the pointer is to the edge |

List rendering options:

- **`overscan`** (default `3`) — extra items rendered above and below the viewport. On `vdnd-sortable-list`, `vdnd-virtual-scroll` and `*vdndVirtualFor` (`overscan: 5` in the microsyntax).
- **`stickyItemIds`** (`vdnd-virtual-scroll` only) — IDs of items that stay rendered at any scroll position. The dragged item is kept rendered automatically (`autoStickyDraggedItem`, default `true`).
- **`recycleRows`** (default `false`; `vdnd-sortable-list` and `vdnd-virtual-scroll`; `*vdndVirtualFor` always recycles) — rows that scroll in reuse the views of rows that scroll out, so scrolling creates few components and elements. Enable it only for rows that render purely from their item: a recycled row's components are not created again (`ngOnInit` runs once), and state no binding sets (component fields, unbound input values, classes set from code) carries over to the next item. Read item-dependent signal inputs in a row component's template, not its host bindings. Details: [guides](references/guides.md#row-recycling).

## Drag preview and placeholder

By default the preview is a styled clone of the dragged element. Supply a template to render your own:

```html
<ng-template #preview let-item let-draggableId="draggableId" let-droppableId="droppableId">
  <div class="preview-card">Moving {{ item.name }}</div>
</ng-template>

<vdnd-drag-preview [previewTemplate]="preview" />
```

- `$implicit` is the draggable's `vdndDraggableData` (`null` if none was set), so pass `[vdndDraggableData]` when using a template. `droppableId` is the list the drag started in.
- The default clone is made when the drag starts, copying computed styles for every element of the row. For rows with many elements (low-end devices), a template preview is cheaper: with a template, drags skip the clone.
- The preview box is sized to the dragged element and keeps the point where the user grabbed the item under the pointer. `cursorOffset` (default `{ x: 8, y: 8 }`) is only a fallback for when no grab offset is known; library-started drags always have one.
- The preview element (class `vdnd-drag-preview`) is `inert` and `aria-hidden="true"`: focus and screen readers skip it, so announce drags yourself.
- It is moved into a body-level `div.vdnd-overlay-container` (this escapes ancestor `transform`s that would break `position: fixed`). Your component's styles still apply to elements in the preview template, but selectors that depend on ancestors (e.g. `.board .card`) no longer match — style the preview by its own classes.
- The default clone keeps the item's `id` attributes (ID-based styles still apply), so during a drag the document has each of those IDs twice; a custom template avoids that.

The drop-position placeholder rendered inside lists is an empty element with the dragged item's height and the classes `vdnd-drag-placeholder vdnd-drag-placeholder-visible`. Style it globally:

```css
.vdnd-drag-placeholder {
  border: 2px dashed #9aa4b2;
  border-radius: 8px;
  box-sizing: border-box;
}
```

`PlaceholderComponent` (`<vdnd-placeholder [template]>`) is a standalone indicator you can render yourself; the built-in lists do not use it.

## Animations and haptics

Displaced items jump into place and the preview vanishes on drop unless `VDND_ANIMATION_CONFIG` is provided (app config, or a component's `providers` for that subtree):

```typescript
providers: [{ provide: VDND_ANIMATION_CONFIG, useValue: { shiftDuration: 200 } }]
// optional: shiftEasing (default 'cubic-bezier(0.2, 0, 0, 1)'); shiftDuration: 0 disables
// optional: dropDuration (default 200; 0 disables), dropEasing (same default as shiftEasing)
```

The config is read each time an animation starts, so getters can switch it at runtime (e.g. from a user setting). Both animations are skipped under `prefers-reduced-motion: reduce`.

**Shift animation** — rows displaced by the placeholder slide into place:

- Works in `vdnd-sortable-list`, `vdnd-virtual-scroll` and every `*vdndVirtualFor` list, with virtual scrolling and dynamic heights. A new move mid-slide continues from the current spot. When the drag ends, rows slide into the committed order (after a cancel they slide back).
- It animates the separate `translate` property, so it runs on the compositor and keeps a consumer `transform` on rows. A consumer `translate` on rows is kept too, but the slide then becomes additive and runs on the main thread — prefer `transform` for your own row offsets.
- Don't add your own CSS `transition` on row `transform` / `translate` / `top` to get this effect: rows are repositioned by layout (or inline `top` for a bare `*vdndVirtualFor`), and such a transition competes with the slide.

**Drop animation** — with the same config, on drop or cancel the preview stays up (class `vdnd-drag-preview-dropping`) and glides onto the item's final position, while the item stays invisible until it lands:

- Purely visual: `drop` and `dragEnd` still fire immediately, and a new drag cuts it short.
- It lands on the item as rendered after your `(drop)` handler, so commit the move synchronously (`moveItem()` / `reorderItems()`). If you commit later, the preview glides back to the old slot. If the item is not rendered or is scrolled out of view, the preview fades out in place.
- Set `dropDuration: 0` to keep shift animations only.

**Rows with `animate.leave` or `animate.enter` (Angular limitation):** the lists move row views when items change order (and when a `stickyItemIds` row scrolls past the rendered rows), and Angular replays a moved view's leave and enter animations; before Angular 21.2.1 it also removes a moved row with `animate.leave`. Turn the animations off from `(dragStart)` until the drop has rendered, and keep `animate.leave` off sticky rows: see [guides](references/guides.md#rows-with-animateleave-or-animateenter) for the workaround and the version details.

**Haptics:** `(placeholderMove)` on `vdndDroppable` / `vdnd-sortable-list` fires on every placeholder step (`PlaceholderMoveEvent`: `previousIndex` → `currentIndex`, same index convention as `DropEvent.destination.index`; `previousIndex` is `null` when the placeholder entered the list). It is not emitted for the initial pick-up or when the placeholder leaves. Bind it only where you use it and keep the handler cheap: like any template listener, each event marks the component and its ancestors for check.

```typescript
onPlaceholderMove(event: PlaceholderMoveEvent): void {
  navigator.vibrate?.(10); // or Haptics.selectionChanged() from @capacitor/haptics
}
```

## Drag state

Inject `DragStateService` (root singleton) to react to drags anywhere, e.g. to highlight valid targets:

```typescript
protected readonly dragState = inject(DragStateService);
// template: @if (dragState.isDragging()) { <p class="hint">Drop into a list</p> }
```

Useful signals: `isDragging`, `draggedItem`, `draggedItemId`, `sourceDroppableId`, `sourceIndex`, `activeDroppableId`, `placeholderIndex`, `isKeyboardDrag`. The full list is in the API reference. For per-list highlighting, the `vdnd-droppable-active` class is simpler.

## Keyboard and accessibility

| Key | Not dragging | During a keyboard drag |
|---|---|---|
| `Tab` | Moves focus between draggables | Cancels the drag |
| `Space` | Picks up the focused item | Drops |
| `Enter` | — | Drops |
| `ArrowUp` / `ArrowDown` | — | Moves the target position |
| `ArrowLeft` / `ArrowRight` | — | Moves to the neighbouring droppable of the same group, by on-screen x position, skipping disabled and hidden ones |
| `Escape` | — | Cancels (also cancels pointer drags) |

- Every arrow key scrolls the list, and the scroll containers around it, to show the target slot, so the keyboard reaches items that are not rendered.
- A list disabled or hidden (`display: none`, `visibility: hidden`) after a keyboard drag moved into it takes no drop: `Space` or `Enter` ends the drag with no destination, and focus returns to the item in its own list.
- Managed automatically: `tabindex` (`0`, or `-1` when disabled) on draggables, and focus returns to the moved item after a keyboard drag.
- The library also sets `aria-grabbed` on draggables and `aria-dropeffect="move"` on droppables, but both are deprecated since ARIA 1.1 and most screen readers ignore them: add instructions and announcements yourself.

**Instructions.** Nothing tells a screen reader user that Space picks an item up. Describe the keys in a hidden element and reference it from every draggable with `aria-describedby`.

**Announcements.** The library does not announce anything (to leave wording and i18n to you). Announce from the events in an `aria-live` region: `(dragStart)` for the pick-up (`sourceIndex`), `(placeholderMove)` for every keyboard step (`currentIndex` is where the item would land; skip pointer drags with `DragStateService.isKeyboardDrag()`), and `(dragEnd)` for the result (`destinationIndex`, `null` for no drop). Complete example: [guides](references/guides.md#screen-reader-announcements).

## Events

| Output | Type | Emitted by |
|---|---|---|
| `(dragStart)` | `DragStartEvent` | `vdndDraggable` |
| `(dragEnd)` | `DragEndEvent` | `vdndDraggable` — after every drag, dropped or not |
| `(drop)` | `DropEvent` | `vdndDroppable`, `vdnd-sortable-list` — destination only |
| `(placeholderMove)` | `PlaceholderMoveEvent` | `vdndDroppable`, `vdnd-sortable-list` — each placeholder move within that list |

On release, `(dragEnd)` fires first, then `(drop)` on the destination, both before the next render.

`DragEndEvent.destinationIndex` is `null` when nothing was dropped. Branch on `destinationIndex === null` to detect "no drop"; `cancelled` is `true` only in the first of these cases:

- the drag was **cancelled**: Escape, Tab during a keyboard drag, the window losing focus, the page being hidden or a mouse release the page never saw (over a cross-origin iframe; cancelled on the next mouse move) during a pointer drag, the system cancelling the touch (`touchcancel`), or the dragged draggable being destroyed (e.g. its item removed mid-drag);
- the item was released outside every droppable, or over a disabled one;
- a keyboard drag was dropped into a droppable disabled or hidden after the drag moved into it.

## CSS classes

| Class | On | When |
|---|---|---|
| `vdnd-draggable` | `[vdndDraggable]` | Always |
| `vdnd-draggable-dragging` | `[vdndDraggable]` | While dragged (element is `display: none`) |
| `vdnd-draggable-disabled` | `[vdndDraggable]` | `disabled` is true |
| `vdnd-drag-pending` | `[vdndDraggable]` | `dragDelay` has elapsed, drag not started yet |
| `vdnd-droppable` | `[vdndDroppable]` | Always |
| `vdnd-droppable-active` | `[vdndDroppable]` | Pointer or keyboard target is this droppable |
| `vdnd-droppable-disabled` | `[vdndDroppable]` | `disabled` is true |
| `vdnd-drag-placeholder`, `vdnd-drag-placeholder-visible` | Drop-position placeholder | Rendered only during drag, in the target list |
| `vdnd-drag-preview` | Preview box inside `vdnd-drag-preview` | During drag |
| `vdnd-drag-preview-dropping` | Preview box | While it plays the drop animation (`VDND_ANIMATION_CONFIG`) |
| `vdnd-overlay-container` | Body-level container for the preview | Once `<vdnd-drag-preview>` has rendered |
| `vdnd-dragging` | `<body>` | While any drag is in progress |
| `vdnd-dragging-touch` | `<body>` | While a touch drag is in progress |
| `vdnd-sortable-list`, `vdnd-virtual-scroll`, `vdnd-virtual-viewport`, `vdnd-virtual-content`, `vdnd-scrollable`, `vdnd-placeholder` | Their host elements | Always |

- Put these rules in a global stylesheet: the library renders the preview, the placeholder and the lists' inner elements, so component-scoped styles don't reach them. With `vdnd-sortable-list` the droppable is an inner element: target it as `.vdnd-sortable-list .vdnd-droppable-active`.
- The only built-in style is a `grabbing` cursor on `vdnd-droppable` and `vdnd-draggable` elements during mouse and keyboard drags (not touch drags). Elements inside them that set their own `cursor` (handles, buttons) keep it; `body.vdnd-dragging .vdnd-draggable { pointer-events: none; }` covers those inside items. Its `<style>` element carries the app's CSP nonce (`ngCspNonce` / `CSP_NONCE`), so it works with a `style-src` policy without `'unsafe-inline'`.
- For a page-wide cursor, add `body.vdnd-dragging:not(.vdnd-dragging-touch) { cursor: grabbing; }`. Never `body.vdnd-dragging *`, which restyles every element at drag start and drop.

## Shadow DOM, testing and migrating from CDK

- **Shadow DOM:** lists, items and the preview work inside open shadow roots (closed ones are not supported). Keep each `vdndDraggable` in the same DOM tree as its list (on a shadow-DOM row component, put it on the host element). See [guides](references/guides.md#shadow-dom).
- **Testing:** unit-test the drop handler with a plain `DropEvent` object (jsdom has no layout, so drags can't be simulated there), and test drags in a real browser, finding items and lists by `[data-draggable-id]` / `[data-droppable-id]`. Keyboard drags are the simplest to script. See [guides](references/guides.md#testing).
- **Migrating from `@angular/cdk/drag-drop`:** the list renders the rows (no `@for` of `cdkDrag`), every list needs a group, IDs are strings, `lockAxis` is inverted, there is no enter predicate (bind `disabled`), and `(drop)` fires on the destination list only. Full mapping of inputs, events, helpers and CSS classes: [guides](references/guides.md#migrating-from-angular-cdk-drag-drop).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Nothing drags; console shows "requires a group" | No group resolved — add `vdndGroup` and declare the item template inside it (rules 1–2) |
| List area is empty / 0 px tall | No height (rule 6) |
| Dragging works but nothing follows the pointer | Missing `<vdnd-drag-preview />` |
| Drag cancels when the dragged item scrolls out of view, or dynamic heights are wrong | `vdndDraggable` ID ≠ `itemIdFn` / `trackBy` value (rule 3) |
| Drops land a row or more off, worse further down | Rows are not exactly `itemHeight` tall (rule 9) |
| Items in other lists disappear while dragging | Duplicate draggable IDs across lists (rule 4) |
| Cannot drop into another list | Lists are in different groups, or that list has no `(drop)` handler (rule 8) |
| Drop fires but the arrays don't change | `moveItem` keys don't match the `droppableId`s |
| A gap stays where the item was | `vdndDraggable` is nested inside a wrapper element (rule 7) |
| A custom control inside an item starts a drag instead of working | Add class `no-drag` to the control (it covers everything inside it), or use `dragHandle` |
| Preview loses styling | Styles relied on ancestor selectors; the preview lives under `<body>` — target its own classes |
| A row fades out after a drop (and disappears, before Angular 21.2.1) | It has `animate.leave`: Angular plays it for rows that move — turn it off for the drag ([guides](references/guides.md#rows-with-animateleave-or-animateenter)) |
| A sticky row fades out or disappears while the list scrolls | It has `animate.leave`: a `stickyItemIds` row moves when it scrolls past the rendered rows — keep `animate.leave` off sticky rows |

## References

- [references/api-reference.md](references/api-reference.md): complete input/output tables, event and context types, services, strategies, tokens and constants. Read it when you need an input not covered above, a type signature, or advanced APIs (custom `VirtualScrollStrategy`, injection tokens, `AutoScrollService`).
- [references/guides.md](references/guides.md): sticky headers and scroll insets, row recycling, `animate.leave` on rows, screen reader announcements, shadow DOM, testing, and migrating from Angular CDK. Read the section a task touches.
