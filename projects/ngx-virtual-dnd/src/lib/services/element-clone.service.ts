import { Injectable } from '@angular/core';

/** A CSS property to copy, or a shorthand with the longhands to copy in its place */
type StyleToCopy = string | readonly [shorthand: string, longhands: readonly string[]];

/** An element with an inline `style` */
type StyledElement = HTMLElement | SVGElement;

/** The computed style of a source pseudo-element, to pin on the clone element's */
interface PseudoElementStyle {
  readonly target: StyledElement;
  readonly pseudo: '::before' | '::after';
  readonly declarations: readonly (readonly [property: string, value: string])[];
}

interface StyleCopyOptions {
  /** Every computed property (a row with ids), or only the listed ones */
  readonly copyAll: boolean;
  /** Whether the focus in the row shows a ring, which a full copy leaves out */
  readonly focusRing: boolean;
  /** Collects the pseudo-elements to pin, in a full copy where the engine can adopt a sheet */
  readonly pseudoElements: PseudoElementStyle[] | null;
}

/** A clone's pinned pseudo-element rules, kept in the shared sheet while the clone is shown */
interface PseudoElementRules {
  readonly clone: HTMLElement;
  readonly css: string;
}

/** Counts the clones that get their own id namespace (`vdnd-preview-<n>-<id>`) */
let namespacedClones = 0;

const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

/** Attributes holding an id, or a space-separated list of ids, of an element in the same tree */
const ID_REFERENCE_ATTRIBUTES = new Set([
  'for',
  'form',
  'list',
  'headers',
  'itemref',
  'anchor',
  'popovertarget',
  'commandfor',
  'interestfor',
  'aria-activedescendant',
  'aria-controls',
  'aria-describedby',
  'aria-details',
  'aria-errormessage',
  'aria-flowto',
  'aria-labelledby',
  'aria-owns',
]);

/** `url(#id)`, quoted or not, possibly with the document's own URL before the `#` */
const URL_REFERENCE = /url\(\s*(['"]?)([^'"()]*)#([^'"()\s]+)\1\s*\)/g;

/**
 * Computed properties a full copy leaves out. Logical properties: their physical twins carry the
 * same values, and they would win over a later write to those (the root's margin and offset
 * reset). `pointer-events`: the clone inherits `none` from the preview box, which keeps it out of
 * hit-testing. Animations and transitions: turned off on the clone. Names that must stay unique
 * in the document (view transition and anchor names), and anchor positioning, which would
 * anchor the clone's elements to the source's (their resolved offsets are copied instead).
 */
const SKIPPED_IN_FULL_COPY =
  /^(?:pointer-events|animation|transition|view-transition|anchor-|position-)|(?:^|-)(?:block|inline)(?:-|$)/;

const isStyled = (node: Element): node is StyledElement =>
  node instanceof HTMLElement || node instanceof SVGElement;

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

  /** The shared sheet that pins the pseudo-elements of the clones with ids */
  #pseudoElementSheet: CSSStyleSheet | null = null;
  #pseudoElementRules: PseudoElementRules[] = [];

  /**
   * Clone an element with its computed styles.
   * Returns an HTMLElement ready for use as a drag preview.
   *
   * The clone's ids are namespaced (`vdnd-preview-<n>-<id>`), so they never repeat an id of the
   * document, and its references to them follow. Rules that match the row by an id no longer
   * match the clone, so a row with ids gets every computed property inlined (and its
   * pseudo-elements pinned), not only the listed ones: the clone looks the same.
   */
  cloneElement(source: HTMLElement): HTMLElement {
    const clone = source.cloneNode(true) as HTMLElement;
    this.#prunePseudoElementRules();

    // Rules can reach any element of the row through an id (`#row .title`, `#a + .b`,
    // `:has(#a)`, `:not(#a)`). Only rows with ids pay for the full copy.
    const hasIds = source.id !== '' || source.querySelector('[id]:not([id=""])') !== null;
    const pseudoElements: PseudoElementStyle[] | null =
      hasIds && this.#canAdoptStyleSheets() ? [] : null;

    // Apply computed styles as inline styles
    const rootComputed = this.#applyComputedStyles(source, clone, {
      copyAll: hasIds,
      focusRing: hasIds && this.#showsFocusRing(source),
      pseudoElements,
    });
    this.#resetRootPlacement(rootComputed, clone);

    // Handle special elements (canvas, video, etc.)
    this.#handleSpecialElements(source, clone);

    // Sanitize the clone for safe use as preview
    this.#sanitizeClone(clone);

    if (hasIds) {
      const prefix = this.#uniqueIdPrefix();
      const ids = this.#namespaceIds(clone, prefix);
      if (pseudoElements?.length) {
        this.#pinPseudoElements(clone, prefix, pseudoElements, ids);
      }
    }

    return clone;
  }

  /**
   * Apply computed styles from source to target element: the listed properties, or with
   * `copyAll` every property (and the pseudo-elements to pin into `pseudoElements`, when given).
   * Recursively applies to all child elements. Returns the source's computed style.
   */
  #applyComputedStyles(
    source: StyledElement,
    target: StyledElement,
    options: StyleCopyOptions,
  ): CSSStyleDeclaration {
    const computed = window.getComputedStyle(source);
    const { copyAll, pseudoElements } = options;

    if (copyAll) {
      // A focus ring is the source's state, not its look: the clone never has focus
      const focused = options.focusRing && source.matches(':focus-within');
      this.#copyAllStyles(computed, target, focused);
      if (pseudoElements && source instanceof HTMLElement) {
        this.#collectPseudoElements(source, target, focused, pseudoElements);
      }
    } else {
      this.#copyListedStyles(computed, target);
    }

    // Disable animations and transitions on clone
    target.style.animation = 'none';
    target.style.transition = 'none';

    // Recursively apply to children (SVG ones too in a full copy: an id rule can reach them)
    const sourceChildren = source.children;
    const targetChildren = target.children;

    for (let i = 0; i < sourceChildren.length && i < targetChildren.length; i++) {
      const sourceChild = sourceChildren[i];
      const targetChild = targetChildren[i];

      if (
        isStyled(sourceChild) &&
        isStyled(targetChild) &&
        (copyAll || (sourceChild instanceof HTMLElement && targetChild instanceof HTMLElement))
      ) {
        this.#applyComputedStyles(sourceChild, targetChild, options);
      }
    }

    return computed;
  }

  /**
   * Whether the source, or an element in it, has focus that shows (a keyboard drag): its focus
   * ring (an outline) is left out of a full copy. Not for a pointer press, which focuses the
   * row without `:focus-visible`: an outline then is the row's look.
   */
  #showsFocusRing(source: HTMLElement): boolean {
    // The focused element of the source's own tree: a row in a shadow root sees the host
    // as the document's active element
    const root = source.getRootNode();
    const focused =
      root instanceof Document || root instanceof ShadowRoot ? root.activeElement : null;
    if (!focused || !source.contains(focused)) {
      return false;
    }
    try {
      return focused.matches(':focus-visible');
    } catch {
      return true; // An engine without :focus-visible: any focus may show a ring
    }
  }

  /** Copy the listed visual properties (keys are already kebab-case) */
  #copyListedStyles(computed: CSSStyleDeclaration, target: StyledElement): void {
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
  }

  /** Copy every computed property but the skipped ones (and the outline of a focused element) */
  #copyAllStyles(computed: CSSStyleDeclaration, target: StyledElement, focused: boolean): void {
    // One declaration block, parsed once (cheaper than a setProperty() per property in Firefox
    // and WebKit). Appended, so the computed values win over the inline ones the clone carries
    // from the source, and the inline ones the engine does not enumerate (custom properties) stay.
    let css = '';
    for (const property of Array.from(computed)) {
      const value = computed.getPropertyValue(property);
      if (value && !this.#skipsInFullCopy(property, focused)) {
        css += `${property}: ${value}; `;
      }
    }
    if (css) {
      target.style.cssText = `${target.style.cssText} ${css}`;
    }
  }

  #skipsInFullCopy(property: string, focused: boolean): boolean {
    return SKIPPED_IN_FULL_COPY.test(property) || (focused && property.startsWith('outline'));
  }

  /**
   * Record the computed style of the source's generated `::before` and `::after`. Read now: the
   * source is hidden once the drag starts.
   */
  #collectPseudoElements(
    source: HTMLElement,
    target: StyledElement,
    focused: boolean,
    pseudoElements: PseudoElementStyle[],
  ): void {
    for (const pseudo of ['::before', '::after'] as const) {
      const computed = window.getComputedStyle(source, pseudo);
      const content = computed.getPropertyValue('content');
      if (!content || content === 'none' || content === 'normal') {
        continue;
      }
      const declarations: (readonly [string, string])[] = [];
      for (const property of Array.from(computed)) {
        const value = computed.getPropertyValue(property);
        if (value && !this.#skipsInFullCopy(property, focused)) {
          declarations.push([property, value]);
        }
      }
      pseudoElements.push({ target, pseudo, declarations });
    }
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
  #copyStyle(computed: CSSStyleDeclaration, target: StyledElement, property: string): boolean {
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
   * Sanitize the clone to prevent interaction issues. The clone is a picture of the row: the
   * root gets the same treatment as its descendants, and nothing in it can take focus or reach
   * assistive technology. (Its ids are namespaced afterwards, see #namespaceIds.)
   */
  #sanitizeClone(clone: HTMLElement): void {
    const elements = [clone, ...Array.from(clone.querySelectorAll('*'))];
    for (const el of elements) {
      if (!(el instanceof HTMLElement)) continue;

      // Remove event-related and Angular-specific attributes
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

      // Remove draggable directive attributes
      el.removeAttribute('vdndDraggable');
      el.removeAttribute('data-draggable-id');
      el.removeAttribute('data-droppable-id');

      if (el.hasAttribute('tabindex')) {
        el.setAttribute('tabindex', '-1');
      }
    }

    // Disable interactive elements, the root included
    const interactiveSelector = 'button, input, textarea, select, a, [contenteditable]';
    const interactiveElements = Array.from(clone.querySelectorAll(interactiveSelector));
    if (clone.matches(interactiveSelector)) {
      interactiveElements.unshift(clone);
    }
    interactiveElements.forEach((el) => {
      if (el instanceof HTMLElement) {
        el.style.pointerEvents = 'none';
        el.setAttribute('tabindex', '-1');
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('disabled', 'true');
      }
    });

    // Nothing in the clone takes focus or reaches assistive technology
    clone.setAttribute('inert', '');
    clone.setAttribute('aria-hidden', 'true');

    // A checked radio joins its group as soon as the clone is connected, which unchecks the
    // radio in the source item. Without a name the cloned radios belong to no group.
    clone.querySelectorAll('input[type="radio"][name]').forEach((radio) => {
      radio.removeAttribute('name');
    });

    // Remove focus styling classes that might interfere
    clone.classList.remove('vdnd-draggable-dragging');
    clone.classList.remove('vdnd-draggable-disabled');
  }

  /**
   * Give every id in the clone (HTML and SVG elements alike) a replacement no element of the
   * document has, so ID lookups and the references of the rest of the page keep finding the
   * source. References inside the clone to its own ids (`href="#x"`, `url(#x)` in attributes and
   * inline styles, idref attributes such as `for` or `aria-labelledby`) follow, so the clone's
   * gradients, `<use>` and labels resolve inside the clone. References to other ids stay.
   * Returns the replacements by original id.
   */
  #namespaceIds(clone: HTMLElement, prefix: string): Map<string, string> {
    const ids = new Map<string, string>();
    const elements = [clone, ...Array.from(clone.querySelectorAll('*'))];
    for (const el of elements) {
      const id = el.getAttribute('id');
      if (!id) {
        continue;
      }
      // Ids the source repeats map to one replacement, as they matched one another
      let replacement = ids.get(id);
      if (replacement === undefined) {
        replacement = prefix + id;
        ids.set(id, replacement);
      }
      el.setAttribute('id', replacement);
    }
    if (ids.size > 0) {
      for (const el of elements) {
        this.#rewriteIdReferences(el, ids);
      }
    }
    return ids;
  }

  /** `vdnd-preview-<n>-`, which no id of the document starts with */
  #uniqueIdPrefix(): string {
    let prefix: string;
    do {
      prefix = `vdnd-preview-${++namespacedClones}-`;
    } while (document.querySelector(`[id^="${prefix}"]`));
    return prefix;
  }

  #rewriteIdReferences(el: Element, ids: ReadonlyMap<string, string>): void {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.localName;
      if (name === 'style') {
        continue; // Rewritten through the CSSOM below
      }
      if (
        name === 'href' &&
        (attr.namespaceURI === null || attr.namespaceURI === XLINK_NAMESPACE)
      ) {
        const replacement = attr.value.startsWith('#') ? ids.get(attr.value.slice(1)) : undefined;
        if (replacement !== undefined) {
          attr.value = `#${replacement}`;
        }
      } else if (attr.namespaceURI === null && ID_REFERENCE_ATTRIBUTES.has(name)) {
        const value = attr.value
          .split(/\s+/)
          .map((token) => ids.get(token) ?? token)
          .join(' ');
        if (value !== attr.value) {
          attr.value = value;
        }
      } else if (attr.value.includes('url(')) {
        const value = this.#rewriteUrlReferences(attr.value, ids);
        if (value !== attr.value) {
          attr.value = value;
        }
      }
    }

    // Inline styles hold the copied computed values (`fill: url("#gradient")`). Through the
    // CSSOM: a strict CSP blocks writing the style attribute, not the CSSOM.
    if (!isStyled(el) || !el.style.cssText.includes('url(')) {
      return;
    }
    const style = el.style;
    for (const property of Array.from(style)) {
      const value = style.getPropertyValue(property);
      if (value.includes('url(')) {
        const rewritten = this.#rewriteUrlReferences(value, ids);
        if (rewritten !== value) {
          style.setProperty(property, rewritten, style.getPropertyPriority(property));
        }
      }
    }
  }

  /** Point `url(#id)` references to ids of the clone at their replacements */
  #rewriteUrlReferences(value: string, ids: ReadonlyMap<string, string>): string {
    const documentUrl = document.URL.split('#')[0];
    return value.replace(URL_REFERENCE, (match, quote: string, base: string, id: string) => {
      const replacement = ids.get(id);
      return replacement !== undefined && (base === '' || base === documentUrl)
        ? `url(${quote}${base}#${replacement}${quote})`
        : match;
    });
  }

  #canAdoptStyleSheets(): boolean {
    return (
      typeof CSSStyleSheet === 'function' &&
      'replaceSync' in CSSStyleSheet.prototype &&
      'adoptedStyleSheets' in Document.prototype
    );
  }

  /**
   * Pseudo-elements take no inline style, so a shared adopted sheet pins the source's generated
   * `::before` and `::after` on the clone's elements (marked with `data-vdnd-preview-pseudo`),
   * `!important` so the rules the clone still matches don't change them. Rules of clones that
   * left the page are dropped on the next clone.
   */
  #pinPseudoElements(
    clone: HTMLElement,
    prefix: string,
    pseudoElements: readonly PseudoElementStyle[],
    ids: ReadonlyMap<string, string>,
  ): void {
    const tokens = new Map<StyledElement, string>();
    const rules: string[] = [];
    for (const { target, pseudo, declarations } of pseudoElements) {
      let token = tokens.get(target);
      if (token === undefined) {
        token = `${prefix}${tokens.size}`;
        tokens.set(target, token);
        target.setAttribute('data-vdnd-preview-pseudo', token);
      }
      const body = declarations
        .map(
          ([property, value]) =>
            `${property}: ${this.#rewriteUrlReferences(value, ids)} !important`,
        )
        .join('; ');
      rules.push(
        `[data-vdnd-preview-pseudo="${token}"]${pseudo} { ${body}; ` +
          'animation: none !important; transition: none !important; }',
      );
    }
    this.#pseudoElementRules.push({ clone, css: rules.join('\n') });
    this.#writePseudoElementSheet();
  }

  /** Drop the pinned pseudo-element rules of clones that are no longer on the page */
  #prunePseudoElementRules(): void {
    const rules = this.#pseudoElementRules.filter(({ clone }) => clone.isConnected);
    if (rules.length !== this.#pseudoElementRules.length) {
      this.#pseudoElementRules = rules;
      this.#writePseudoElementSheet();
    }
  }

  #writePseudoElementSheet(): void {
    if (!this.#pseudoElementSheet) {
      this.#pseudoElementSheet = new CSSStyleSheet();
    }
    const sheet = this.#pseudoElementSheet;
    sheet.replaceSync(this.#pseudoElementRules.map(({ css }) => css).join('\n'));
    if (!document.adoptedStyleSheets.includes(sheet)) {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
  }
}
