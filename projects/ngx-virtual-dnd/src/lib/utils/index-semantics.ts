/**
 * The index spaces a drag moves through, and the conversions between them. All three are plain
 * numbers at runtime (and in the public API); the aliases name which one a value is in. See the
 * glossary in `.claude/ARCHITECTURE.md`.
 *
 * During a same-list drag the dragged item is hidden (`display: none`), so the slots after it
 * close up. For [A, B, C, D] with B dragged (source index 1), the slot at the end is:
 * - placeholder index 4: before which original item the placeholder renders (N = after the last)
 * - insertion index 3: the item's index once it has left its source (the list is [A, C, D])
 */

/** An item's position in its list as the consumer's array has it (`sourceIndex`) */
export type ItemIndex = number;

/**
 * Where the placeholder renders: before the item at this index of the list as it is, the hidden
 * source included (`DragState.placeholderIndex`, `VirtualScrollStrategy` offsets)
 */
export type PlaceholderIndex = number;

/**
 * Where the item lands, counted in the list without it: the drop convention
 * (`DropEvent.destination.index`, `DragEndEvent.destinationIndex`, keyboard target index)
 */
export type InsertionIndex = number;

/**
 * Convert an insertion index (counted without the hidden source) into a placeholder index: a slot
 * at or after the source in its own list is one further on. Without a known source index (null or
 * negative) the index stays as it is.
 */
export function insertionToPlaceholderIndex(
  insertionIndex: InsertionIndex,
  sourceIndex: ItemIndex | null,
  isSameList: boolean,
): PlaceholderIndex {
  return isSameList && sourceIndex !== null && sourceIndex >= 0 && insertionIndex >= sourceIndex
    ? insertionIndex + 1
    : insertionIndex;
}

/**
 * Convert a placeholder index into the insertion index a drop reports: a slot after the source in
 * its own list is one closer once the source is gone. The inverse of `insertionToPlaceholderIndex`
 * (the slot right after the source, where the item already is, maps back onto the source index).
 */
export function placeholderToInsertionIndex(args: {
  sourceIndex: ItemIndex;
  placeholderIndex: PlaceholderIndex;
  sourceDroppableId: string | null;
  activeDroppableId: string | null;
}): InsertionIndex;
export function placeholderToInsertionIndex(args: {
  sourceIndex: ItemIndex;
  placeholderIndex: PlaceholderIndex | null;
  sourceDroppableId: string | null;
  activeDroppableId: string | null;
}): InsertionIndex | null;
export function placeholderToInsertionIndex({
  sourceIndex,
  placeholderIndex,
  sourceDroppableId,
  activeDroppableId,
}: {
  sourceIndex: ItemIndex;
  placeholderIndex: PlaceholderIndex | null;
  sourceDroppableId: string | null;
  activeDroppableId: string | null;
}): InsertionIndex | null {
  if (placeholderIndex === null) {
    return null;
  }

  if (
    sourceDroppableId !== null &&
    sourceDroppableId === activeDroppableId &&
    sourceIndex < placeholderIndex
  ) {
    return placeholderIndex - 1;
  }

  return placeholderIndex;
}
