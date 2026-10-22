# Architecture map

Who owns what inside the library, and the vocabulary the drag code uses. The decisions behind it are in `.claude/CLAUDE.md` (Architecture).

## Index and coordinate glossary

A drag moves between index spaces that are all plain numbers. Name the space in variable names, and convert with the helpers in `lib/utils/index-semantics.ts`, not with inline `+ 1` / `- 1`.

| Term               | Meaning                                                                                                         | Where it shows                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ItemIndex`        | An item's position in the consumer's array                                                                      | `sourceIndex` (state, `DragStartEvent`, `DropEvent.source.index`)                                   |
| `PlaceholderIndex` | The placeholder renders before the item at this index of the list as it is, hidden source included (N = at end) | `DragState.placeholderIndex`, strategy offsets during a same-list drag                              |
| `InsertionIndex`   | Where the item lands, counted in the list without it                                                            | `DropEvent.destination.index`, `DragEndEvent.destinationIndex`, `keyboardTargetIndex`, drop helpers |
| Probed index       | The slot under the preview, before the hidden-source adjustment                                                 | `calculatePlaceholderIndex`                                                                         |
| Viewport Y         | `clientY` space (`getBoundingClientRect`, pointer events)                                                       | cursor, preview, droppable rects                                                                    |
| Row offset         | Pixels from the first row, as `VirtualScrollStrategy.getOffsetForIndex` returns                                 | `rowTop - rect.top + scrollTop` (`DroppableScrollGeometry`)                                         |

Example: `[A, B, C, D]`, dragging B (source 1) to the end. Placeholder index 4, insertion index 3.

- `insertionToPlaceholderIndex`: a slot at or after the source in its own list is one further on. Keyboard targets and the probe of a list whose rows close up over the hidden source use it.
- `placeholderToInsertionIndex`: the reverse, for `dragEnd`, `drop` and `placeholderMove`.
- A strategy with the source excluded (`setExcludedIndex`) maps its offsets back onto the list as it is: its `findIndexAtOffset` returns a placeholder index already. Before the exclusion applies (the first frames of a drag) it doesn't, which `calculatePlaceholderIndex` detects.

## Gestures

`DraggableDirective` is the Angular side of a draggable: inputs, outputs, host bindings, key and touch listeners, eligibility checks and its protected key/pointer hooks. Each modality has its own handler, and what both do goes through shared functions:

| Owner                                         | Responsibility                                                                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handlers/drag-source.ts`                     | Picking up: measure the item, its list and source index before it is hidden (`measureDragSource`), clone the preview and build the `DraggedItem` and `dragStart` event (both modalities) |
| `PointerDragHandler`                          | Press, threshold, delay, pointer listeners, pending state                                                                                                                                |
| `DraggableDirective` (pointer session)        | Grab offset, axis lock, container clamp, hit-testing per frame, scroll-only fast path                                                                                                    |
| `KeyboardDragHandler` + `KeyboardDragService` | Document key listener, arrow navigation between slots and lists, reveal, focus restore                                                                                                   |

Keep modality-specific behaviour (thresholds, navigation, focus) in its handler; move a decision into the shared functions only when both modalities make it the same way.
