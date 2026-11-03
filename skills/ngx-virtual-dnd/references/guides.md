# Guides

Specialized topics for ngx-virtual-dnd. The setup rules and everyday options are in [SKILL.md](../SKILL.md), the API tables in [api-reference.md](api-reference.md).

## Contents

- [Sticky headers and scroll insets](#sticky-headers-and-scroll-insets): content pinned over a scroll container or a list
- [Row recycling](#row-recycling): what `recycleRows` (and `*vdndVirtualFor`) means for row components
- [Fast scrolling and placeholder rows](#fast-scrolling-and-placeholder-rows): what a fast scroll shows before its rows render
- [Rows with animate.leave or animate.enter](#rows-with-animateleave-or-animateenter): an Angular limitation for rows that move
- [Screen reader announcements](#screen-reader-announcements): a complete live-region example
- [Shadow DOM](#shadow-dom)
- [Testing](#testing): drop handlers in unit tests, drags in Playwright or Cypress
- [Migrating from Angular CDK drag-drop](#migrating-from-angular-cdk-drag-drop)

## Sticky headers and scroll insets

A header or footer with `position: sticky` inside a `vdndScrollable` element covers part of it while the rows scroll behind it. Pass the heights they cover as `[scrollInsetTop]` / `[scrollInsetBottom]` on the `vdndScrollable` element:

```html
<div
  vdndScrollable
  [scrollInsetTop]="headerHeight()"
  [scrollInsetBottom]="footerHeight()"
>
  <header #header class="sticky-header">...</header>
  <vdnd-virtual-content
    vdndDroppable="tasks"
    [itemHeight]="72"
    [contentOffset]="headerHeight()"
  >
    ...
  </vdnd-virtual-content>
  <footer #footer class="sticky-footer">...</footer>
</div>
```

The consumer measures the heights, from the container's border box (a border on the container adds its width, a horizontal scrollbar under a `bottom: 0` footer adds its height). A drag in progress re-reads them when they change, so keep them up to date:

```typescript
readonly header = viewChild.required<ElementRef<HTMLElement>>('header');
readonly footer = viewChild.required<ElementRef<HTMLElement>>('footer');
readonly headerHeight = signal(0);
readonly footerHeight = signal(0);
readonly #destroyRef = inject(DestroyRef);

constructor() {
  afterNextRender(() => {
    this.#trackHeight(this.header().nativeElement, this.headerHeight);
    this.#trackHeight(this.footer().nativeElement, this.footerHeight);
  });
}

#trackHeight(element: HTMLElement, height: WritableSignal<number>): void {
  const observer = new ResizeObserver(([entry]) => {
    height.set(entry.borderBoxSize[0].blockSize);
  });
  observer.observe(element);
  this.#destroyRef.onDestroy(() => observer.disconnect());
}
```

The drag then treats only the uncovered part as the container:

- the `constrainToContainer` preview stays out from under the header and footer;
- auto-scroll starts at their inner edges, and runs at full speed over them;
- a pointer over them is not over the list. The drop position still follows the preview's top edge, so without `constrainToContainer` a preview pulled over the header can point at a row behind it;
- a keyboard drag keeps the placeholder clear of them;
- a list in a scroll container nested inside this one is treated the same way where it scrolls under them: not targeted there, auto-scroll over them scrolls the outer container, and its constrained preview and keyboard placeholder stay clear of them.

`vdnd-sortable-list`, `vdnd-virtual-scroll` and `vdnd-virtual-viewport` take the same two inputs for content overlaid on their own rows (such as a header positioned over the top of the list). They also leave that space around their rows: the first row starts below the top inset (in `vdnd-virtual-viewport`, `contentOffset` down when that is more), and the list scrolls far enough for the last row to clear the bottom one.

## Row recycling

With `[recycleRows]="true"` on `vdnd-sortable-list` or `vdnd-virtual-scroll` (and always in `*vdndVirtualFor`), the view of a row that scrolls out renders a row that scrolls in, so scrolling creates few components and elements. A row keeps its view while its item stays rendered, as without recycling. A recycled view renders another item, and keeps whatever does not come from its bindings:

- **Components in the row are not created again.** Their constructor and `ngOnInit` run once, for the first item; later items only change their inputs. Derive what a row shows from `input()` / `computed()`, not from values read once in `ngOnInit`.
- **Local state stays with the view:** a component's own fields and signals, and the value of an input field that is not bound to the item.
- **DOM state that no binding sets stays:** classes or styles set from code, an element's scroll position, an `<img>` until its new `src` loads.
- Focus does not carry over: a view leaves the DOM before it renders another item.
- A row with `animate.leave` on its root element is not recycled (on Angular 22, on any element in the row), even when its bound value is empty.

Read item-dependent signal inputs in a row component's **template**, not in its host bindings. Angular tracks the signals a row's host bindings read with the component view the row is in (the list's own view, or with `*vdndVirtualFor` the consumer's), so each scroll step that reuses a view would check every rendered row, and with `*vdndVirtualFor` re-run the consumer's template. The same goes for an input bound to `first` or `last` of `*vdndVirtualFor`.

```typescript
// Each reused view checks every row: the host binding reads the task
@Component({
  selector: 'app-task-row',
  host: { '[class.done]': 'task().done' },
  template: `{{ task().title }}`,
})
export class TaskRow {
  readonly task = input.required<Task>();
}

// Each reused view checks only its own row
@Component({
  selector: 'app-task-row',
  template: `<div [class.done]="task().done">{{ task().title }}</div>`,
})
export class TaskRow {
  readonly task = input.required<Task>();
}
```

A host binding that shows nothing but an input's value can read it with `untracked()` instead, as `vdndDraggable` does.

## Fast scrolling and placeholder rows

Each scroll renders the rows of its new position in its scroll event, but browsers scroll on a thread of their own: a fast flick, or a dragged scrollbar thumb that jumps across hundreds of rows, can show a position before the page has rendered its rows (Safari and Firefox never wait for the page; Chrome waits only when the page renders in time). For a frame or two the list shows its background there: blank space, a whole viewport of it after a jump. No setting removes those frames; `overscan` only covers small steps.

Paint the look of an empty row on the spacer behind the rows, `.vdnd-virtual-spacer` (as wide as the list, from its first row to its end; the browser draws it in those frames too), every `itemHeight` px, and give the box of the rendered rows, `.vdnd-virtual-rows`, the list's background so the rows cover it. Global stylesheet:

```css
/* Placeholder rows: each row's background and bottom border, every 48px (itemHeight) */
.vdnd-virtual-spacer {
  background: linear-gradient(#fff 47px, #e6e9ee 47px) 0 0 / 100% 48px repeat-y;
}

/* The rendered rows cover them */
.vdnd-virtual-rows {
  background: #fff;
}
```

- Paint the row's look at rest (background, edges, corners) in the same place, so a lagging frame only lacks the content. Rounded cards can be drawn with a `mask-image` (an SVG of the card) on the spacer's `::before` and `::after`, with `background-color` from your tokens.
- Dynamic heights: space the placeholder rows by `itemHeight`, the estimate for unmeasured rows.
- `*vdndVirtualFor` directly in a `vdndScrollable` element positions each row and has no `.vdnd-virtual-rows` box: give the rows a background that fills their height instead.
- It adds no work to a scroll: nothing renders for the spacer.

## Rows with animate.leave or animate.enter

This is an Angular limitation. The lists move a row's view with `ViewContainerRef.move()` (as `*ngFor` does), and Angular replays the leave and enter animations of a view that moves; only `@for` avoids it. Rows move when items change order (a drop, a sort), and a `stickyItemIds` row moves each time it scrolls past the edge of the rendered rows.

- Before Angular 21.2.1, a moved row with `animate.leave` is removed from the page when the animation ends.
- From Angular 21.2.1, it stays, unless it moves again before the animation ends: then Angular removes it.
- On Angular 21, it also keeps its leave class after the animation, so a leave style that holds its end state (a transition to `opacity: 0`) leaves it invisible.

Turn the animations off during a drag: give `[animate.leave]` an empty value from `dragStart` until the drop has rendered. Angular reads the value when the animation runs, after the render that moves the rows, so turn it back on in the `read` phase of that render:

```typescript
// Row: [animate.leave]="leaveAnimation()" (dragStart)="onDragStart()" (dragEnd)="onDragEnd()"
readonly leaveAnimation = signal('row-leave');
readonly #injector = inject(Injector);

onDragStart(): void {
  this.leaveAnimation.set('');
}

onDragEnd(): void {
  afterNextRender({ read: () => this.leaveAnimation.set('row-leave') }, { injector: this.#injector });
}
```

- Bind `[animate.enter]` to a signal and clear it the same way, so moved rows don't replay their enter animation.
- Before Angular 21.2.1 this is not enough: Angular removes a row that moves even when its leave animation is empty. Update Angular, or keep `animate.leave` off rows that can move.
- This only covers drags. Turn the animations off the same way around your own sorts, and keep `animate.leave` off `stickyItemIds` rows (they move while the list scrolls).
- A bound `[animate.leave]` also keeps a row from being recycled, even while its value is empty.

## Screen reader announcements

The library sets `aria-grabbed` and `aria-dropeffect`, which most screen readers ignore, and announces nothing itself (wording and translations stay with the app). Describe the keys in a hidden element referenced with `aria-describedby`, and announce from the events in a live region: `(dragStart)` for the pick-up, `(placeholderMove)` for every keyboard step (`currentIndex` is where the item would land) and `(dragEnd)` for the result.

```typescript
@Component({
  template: `
    <p id="drag-instructions" hidden>
      Press Space to pick up. Use the arrow keys to move, Space to drop and Escape to cancel.
    </p>

    <div vdndGroup="tasks">
      <ng-template #taskTpl let-task>
        <div
          [vdndDraggable]="task.id"
          [vdndDraggableData]="task"
          aria-describedby="drag-instructions"
          (dragStart)="onDragStart($event)"
          (dragEnd)="onDragEnd($event)"
        >
          {{ task.title }}
        </div>
      </ng-template>

      <vdnd-sortable-list
        droppableId="tasks"
        [items]="tasks()"
        [itemHeight]="48"
        [containerHeight]="400"
        [itemIdFn]="taskId"
        [itemTemplate]="taskTpl"
        (drop)="onDrop($event)"
        (placeholderMove)="onPlaceholderMove($event)"
      />
    </div>

    <div class="sr-only" aria-live="assertive">{{ announcement() }}</div>
  `,
})
export class TasksComponent {
  readonly #dragState = inject(DragStateService);
  readonly announcement = signal('');

  onDragStart(event: DragStartEvent): void {
    const task = event.data as Task;
    this.announcement.set(
      `Picked up ${task.title}, position ${event.sourceIndex + 1} of ${this.tasks().length}`,
    );
  }

  onPlaceholderMove(event: PlaceholderMoveEvent): void {
    if (!this.#dragState.isKeyboardDrag()) return; // pointer users see the placeholder
    this.announcement.set(`Position ${event.currentIndex + 1} of ${this.tasks().length}`);
  }

  onDragEnd(event: DragEndEvent): void {
    this.announcement.set(
      event.destinationIndex === null
        ? `Cancelled. Back at position ${event.sourceIndex + 1}`
        : `Dropped at position ${event.destinationIndex + 1}`,
    );
  }

  // tasks, taskId and onDrop as in the quick start
}
```

- `.sr-only` is the usual visually-hidden utility (`position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%);`).
- With multiple lists, name the list in the step message: `event.droppableId` is the list the placeholder is in.

## Shadow DOM

Lists, items and `<vdnd-drag-preview />` work inside an open shadow root (e.g. a component with `ViewEncapsulation.ShadowDom`): droppables register themselves instead of being found by a document query, and lookups that walk up from an element continue from a shadow root to its host.

- Keep each `vdndDraggable` in the same DOM tree as its list: a list finds its items with `querySelectorAll()`, which does not enter shadow roots. For a shadow-DOM row component, put `vdndDraggable` on its host element, and don't slot items into a list rendered inside a web component's shadow root.
- Closed shadow roots are not supported.
- The preview moves under `<body>`, where the shadow root's styles don't apply. The default clone still looks right (it gets the item's computed styles inline), but a custom preview template declared in a shadow-DOM component loses that component's styles (style it globally), and an item that is itself a shadow host previews without its shadow content (give it a custom template).
- The drag's `cursor: grabbing` does not reach into shadow roots.

## Testing

- **Unit-test the drop handler** with a plain event object. jsdom (Jest, Vitest) has no layout, so drags can't be simulated there:

  ```typescript
  component.onDrop({
    source: { draggableId: 'task-1', droppableId: 'todo', index: 0 },
    // placeholderId is deprecated, but the type requires it until the next major version
    destination: { droppableId: 'done', placeholderId: 'END_OF_LIST', index: 0 },
  });
  expect(component.done()[0].id).toBe('task-1');
  ```

- **Test drags in a real browser** (Playwright, Cypress). The library sets `data-draggable-id` and `data-droppable-id` to the IDs: use them to find items and lists. A virtual list renders only the rows in view, so scroll a row into view before looking for it.
- **Keyboard drags** need no coordinates, so they are the simplest to script:

  ```typescript
  await page.locator('[data-draggable-id="task-1"]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.vdnd-drag-preview')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  ```

- **Pointer drags:** press on the item, move past the drag threshold (5 px by default), wait for `.vdnd-drag-preview`, then move to the target in several steps and release. A single jump straight to the target can be released before the library has processed the new position.

## Migrating from Angular CDK drag-drop

The CDK finds drop positions by measuring rendered siblings, so it does not work with virtual scrolling. The main differences:

- **The list renders the rows:** pass the items and a row template instead of writing the `@for` loop.
- **Every list needs a group**, even a single one; lists in the same group exchange items.
- **Items and lists have string IDs**, and the draggable's ID must equal what `itemIdFn` returns for its item.
- **The preview is rendered once**, by `<vdnd-drag-preview />`, not per item.
- **Rows have a known height** (`itemHeight`), or `dynamicItemHeight` measures them.
- **Data is never mutated:** the helpers update signals or return new arrays.

| Angular CDK | ngx-virtual-dnd |
|---|---|
| `cdkDropList` + `@for` of `cdkDrag` items | `<vdnd-sortable-list [items] [itemTemplate] [itemIdFn] [itemHeight]>` |
| `cdkDrag` | `[vdndDraggable]="item.id"` |
| `cdkDropListGroup`, `cdkDropListConnectedTo` | `vdndGroup="name"` around the lists |
| `cdkDragData`, `cdkDropListData` | `[vdndDraggableData]`, `droppableData` (`vdndDroppableData` on `vdndDroppable`) |
| `cdkDragHandle` | `dragHandle="<CSS selector>"` on the draggable |
| `cdkDragDisabled`, `cdkDropListDisabled` | `disabled` |
| `cdkDragStartDelay`, `dragStartThreshold` (`CDK_DRAG_CONFIG`) | `dragDelay`, `dragThreshold` |
| `cdkDragLockAxis="x"` | `lockAxis="y"`: **inverted**, it names the frozen axis |
| `cdkDragBoundary` | `constrainToContainer` on the list |
| `*cdkDragPreview` | `<vdnd-drag-preview [previewTemplate]>` |
| `*cdkDragPlaceholder` | No template: style `.vdnd-drag-placeholder` |
| `cdkDropListEnterPredicate` | Bind the list's `disabled` from `DragStateService` (SKILL.md, Droppable and list options) |
| `cdkDropListOrientation`, `cdkDropListSortingDisabled` | Not supported: lists are vertical and always sort |
| `(cdkDropListDropped)` | `(drop)`, on the destination list only |
| `(cdkDragStarted)`, `(cdkDragEnded)` | `(dragStart)`, `(dragEnd)` on the draggable |
| `(cdkDropListSorted)` | `(placeholderMove)` |
| `(cdkDropListEntered)`, `(cdkDropListExited)` | No output: read `DragStateService.activeDroppableId()`, or style `.vdnd-droppable-active` |
| `CdkDragDrop` `previousIndex`, `currentIndex` | `DropEvent` `source.index`, `destination.index` (same meaning) |
| `previousContainer`, `container` | `source.droppableId`, `destination.droppableId` |
| `item.data`, `container.data` | `source.data`, `destination.data` |
| `moveItemInArray(array, from, to)` | `reorderItems(event, listSignal)` |
| `transferArrayItem(...)` | `moveItem(event, { todo: this.todo, done: this.done })` |
| Both, for immutable state | `applyMove(event, lists)` |

| CDK class | ngx-virtual-dnd class |
|---|---|
| `.cdk-drag-preview` | `.vdnd-drag-preview` |
| `.cdk-drag-placeholder` | `.vdnd-drag-placeholder` |
| `.cdk-drag-animating` | `.vdnd-drag-preview-dropping` (while the preview glides into place) |
| `.cdk-drop-list-dragging` | `.vdnd-droppable-active` on the targeted list, `body.vdnd-dragging` during any drag |
| `.cdk-drag-disabled` | `.vdnd-draggable-disabled` |
| `.cdk-drop-list-disabled` | `.vdnd-droppable-disabled` |

Releasing outside every list emits no `(drop)`; `(dragEnd)` reports it with `destinationIndex: null`. Remove CDK-era CSS `transition`s on rows: animations are opt-in through `VDND_ANIMATION_CONFIG`, and a transition on rows competes with them.
