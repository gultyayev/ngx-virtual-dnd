import { Injectable } from '@angular/core';

/** A CSS property to copy, or a shorthand with the longhands to copy in its place */
type StyleToCopy = string | readonly [shorthand: string, longhands: readonly string[]];

/**
 * Service for cloning DOM elements with their computed styles.
 * Used to create visual copies of dragged elements for the drag preview.
 */
@Injectable({ providedIn: 'root' })
export class ElementCloneService {
  /**
   * CSS properties to copy from source to clone, pre-stored in kebab-case.
   * These are the visual properties that affect appearance. Keeping them
   * kebab-case avoids a camelCase→kebab conversion on every property of every
   * node during the recursive clone walk (a drag-start hot path).
   *
   * A shorthand carries more than the longhands listed with it (`background-size`,
   * `font-style`, …), so it is copied first, and the longhands only when the engine can't
   * serialize the shorthand (it gives '' for `font` with `font-variant-ligatures: none`, for
   * example). Copying both would read and write the same values twice.
   */
  readonly #stylesToCopy: readonly StyleToCopy[] = [
    ['background', ['background-color', 'background-image']],
    'border',
    'border-radius',
    'box-shadow',
    'color',
    ['font', ['font-family', 'font-size', 'font-weight', 'line-height']],
    'padding',
    'margin',
    'display',
    'flex-direction',
    'align-items',
    'justify-content',
    'gap',
    'text-align',
    'text-decoration',
    'width',
    'height',
    'min-width',
    'min-height',
    'max-width',
    'max-height',
    'overflow',
    'opacity',
    'transform',
    'box-sizing',
  ];

  /**
   * Clone an element with its computed styles.
   * Returns an HTMLElement ready for use as a drag preview.
   */
  cloneElement(source: HTMLElement): HTMLElement {
    const clone = source.cloneNode(true) as HTMLElement;

    // Apply computed styles as inline styles
    const rootComputed = this.#applyComputedStyles(source, clone);
    this.#resetRootPlacement(rootComputed, clone);

    // Handle special elements (canvas, video, etc.)
    this.#handleSpecialElements(source, clone);

    // Sanitize the clone for safe use as preview
    this.#sanitizeClone(clone);

    return clone;
  }

  /**
   * Apply computed styles from source to target element.
   * Recursively applies to all child elements. Returns the source's computed style.
   */
  #applyComputedStyles(source: HTMLElement, target: HTMLElement): CSSStyleDeclaration {
    const computed = window.getComputedStyle(source);

    // Copy essential visual properties (keys are already kebab-case)
    for (const style of this.#stylesToCopy) {
      if (typeof style === 'string') {
        this.#copyStyle(computed, target, style);
        continue;
      }
      // The longhands only when the shorthand was not copied: the engine gave no value, or the
      // clone rejected it. A shorthand sets all its longhands, so reading one back tells (the
      // shorthand itself would be serialized again to be read). The clone may carry that
      // longhand inline from the source, so it goes first.
      const [shorthand, longhands] = style;
      target.style.removeProperty(longhands[0]);
      if (
        !this.#copyStyle(computed, target, shorthand) ||
        !target.style.getPropertyValue(longhands[0])
      ) {
        for (const longhand of longhands) {
          this.#copyStyle(computed, target, longhand);
        }
      }
    }

    // Disable animations and transitions on clone
    target.style.animation = 'none';
    target.style.transition = 'none';

    // Recursively apply to children
    const sourceChildren = source.children;
    const targetChildren = target.children;

    for (let i = 0; i < sourceChildren.length && i < targetChildren.length; i++) {
      const sourceChild = sourceChildren[i];
      const targetChild = targetChildren[i];

      if (sourceChild instanceof HTMLElement && targetChild instanceof HTMLElement) {
        this.#applyComputedStyles(sourceChild, targetChild);
      }
    }

    return computed;
  }

  /**
   * Strip what placed the source row on the page from the clone root. The preview box is the
   * row's border box (getBoundingClientRect(), so already moved by all of these), and the clone
   * fills it from its origin: a margin, an offset or a translation would push the clone away
   * from the grab point and past the box's clipped edge. Descendants keep theirs: they lay out
   * the row's content. Set inline, as the clone keeps the row's classes and their rules.
   */
  #resetRootPlacement(computed: CSSStyleDeclaration, clone: HTMLElement): void {
    const style = clone.style;
    style.margin = '0';
    style.top = style.right = style.bottom = style.left = 'auto';
    // In flow at the box's origin. Relative still lays out absolutely positioned descendants
    // against the row, as absolute, fixed and sticky did (a standalone `*vdndVirtualFor` row
    // carries an inline `position: absolute; top`).
    const position = computed.getPropertyValue('position');
    if (position === 'absolute' || position === 'fixed' || position === 'sticky') {
      style.position = 'relative';
    }
    // A rotation or scale is how the row looks, a translation where it is: keep the linear part
    style.translate = 'none';
    style.transform = this.#withoutTranslation(style.transform);
  }

  /** A computed transform (`none`, `matrix(…)` or `matrix3d(…)`) with its translation zeroed */
  #withoutTranslation(transform: string): string {
    const match = /^(matrix(?:3d)?)\((.*)\)$/.exec(transform.trim());
    if (!match) {
      return transform;
    }
    const [, fn, args] = match;
    const values = args.split(',').map((value) => value.trim());
    // matrix(a, b, c, d, tx, ty); matrix3d(…12 values, tx, ty, tz, w)
    const [count, translation] = fn === 'matrix' ? [6, [4, 5]] : [16, [12, 13, 14]];
    if (values.length !== count) {
      return transform;
    }
    for (const index of translation) {
      values[index] = '0';
    }
    return `${fn}(${values.join(', ')})`;
  }

  /**
   * Copy one computed property to the target's inline style. Returns whether the engine gave a
   * value for it.
   */
  #copyStyle(computed: CSSStyleDeclaration, target: HTMLElement, property: string): boolean {
    const value = computed.getPropertyValue(property);
    if (!value) {
      return false;
    }
    target.style.setProperty(property, value);
    return true;
  }

  /**
   * Handle special elements that require extra processing.
   */
  #handleSpecialElements(source: HTMLElement, clone: HTMLElement): void {
    // Handle canvas elements - copy current content
    const sourceCanvases = source.querySelectorAll('canvas');
    const cloneCanvases = clone.querySelectorAll('canvas');

    sourceCanvases.forEach((srcCanvas, i) => {
      const cloneCanvas = cloneCanvases[i] as HTMLCanvasElement;
      if (cloneCanvas) {
        const ctx = cloneCanvas.getContext('2d');
        if (ctx) {
          cloneCanvas.width = srcCanvas.width;
          cloneCanvas.height = srcCanvas.height;
          ctx.drawImage(srcCanvas, 0, 0);
        }
      }
    });

    // Handle video elements - replace with poster or placeholder
    const videos = clone.querySelectorAll('video');
    videos.forEach((video) => {
      const poster = video.poster;
      if (poster) {
        const img = document.createElement('img');
        img.src = poster;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        video.replaceWith(img);
      } else {
        // Create a placeholder
        const placeholder = document.createElement('div');
        placeholder.style.cssText = `
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        `;
        video.replaceWith(placeholder);
      }
    });

    // Handle iframes - replace with placeholder
    const iframes = clone.querySelectorAll('iframe');
    iframes.forEach((iframe) => {
      const placeholder = document.createElement('div');
      const iframeStyles = window.getComputedStyle(iframe);
      placeholder.style.width = iframeStyles.width;
      placeholder.style.height = iframeStyles.height;
      placeholder.style.display = 'flex';
      placeholder.style.alignItems = 'center';
      placeholder.style.justifyContent = 'center';
      iframe.replaceWith(placeholder);
    });
  }

  /**
   * Sanitize the clone to prevent interaction issues.
   */
  #sanitizeClone(clone: HTMLElement): void {
    // Remove draggable directive attributes
    clone.removeAttribute('vdndDraggable');
    clone.removeAttribute('data-draggable-id');
    clone.removeAttribute('data-droppable-id');

    // Remove Angular-specific attributes
    const angularAttrs = Array.from(clone.attributes).filter(
      (attr) => attr.name.startsWith('ng-') || attr.name.startsWith('_ng'),
    );
    angularAttrs.forEach((attr) => clone.removeAttribute(attr.name));

    // Process all descendant elements
    const allElements = clone.querySelectorAll('*');
    allElements.forEach((el) => {
      if (!(el instanceof HTMLElement)) return;

      // Remove event-related attributes
      const attrs = Array.from(el.attributes);
      attrs.forEach((attr) => {
        if (
          attr.name.startsWith('on') ||
          attr.name.startsWith('(') ||
          attr.name.startsWith('ng-') ||
          attr.name.startsWith('_ng')
        ) {
          el.removeAttribute(attr.name);
        }
      });

      // Remove draggable attributes from children too
      el.removeAttribute('vdndDraggable');
      el.removeAttribute('data-draggable-id');
      el.removeAttribute('data-droppable-id');
    });

    // Disable interactive elements
    const interactiveElements = clone.querySelectorAll(
      'button, input, textarea, select, a, [contenteditable]',
    );
    interactiveElements.forEach((el) => {
      if (el instanceof HTMLElement) {
        el.style.pointerEvents = 'none';
        el.setAttribute('tabindex', '-1');
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('disabled', 'true');
      }
    });

    // A checked radio joins its group as soon as the clone is connected, which unchecks the
    // radio in the source item. Without a name the cloned radios belong to no group.
    clone.querySelectorAll('input[type="radio"][name]').forEach((radio) => {
      radio.removeAttribute('name');
    });

    // Remove focus styling classes that might interfere
    clone.classList.remove('vdnd-draggable-dragging');
    clone.classList.remove('vdnd-draggable-disabled');
  }
}
