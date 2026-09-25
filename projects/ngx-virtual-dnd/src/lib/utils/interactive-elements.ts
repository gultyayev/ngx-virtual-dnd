/**
 * Elements inside a draggable that keep their own interaction: pressing one never starts a
 * pointer drag, and Space pressed on one never starts a keyboard drag.
 */
export const INTERACTIVE_ELEMENT_SELECTOR = 'button, input, textarea, select, [contenteditable]';

/** Class that excludes the exact element carrying it from starting a drag. */
export const NO_DRAG_CLASS = 'no-drag';
