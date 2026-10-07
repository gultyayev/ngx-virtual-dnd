import { readScrollInset, scrollAncestors, uncoveredRect, visibleRect } from './scroll-insets';

describe('scroll insets', () => {
  let element: HTMLElement;

  beforeEach(() => {
    element = document.createElement('div');
  });

  describe('readScrollInset', () => {
    it('should read the space covered at each edge', () => {
      element.setAttribute('data-scroll-inset-top', '64');
      element.setAttribute('data-scroll-inset-bottom', '48.5');

      expect(readScrollInset(element, 'top')).toBe(64);
      expect(readScrollInset(element, 'bottom')).toBe(48.5);
    });

    it.each(['', 'abc', '-20', 'Infinity'])('should read %p as nothing covered', (value) => {
      element.setAttribute('data-scroll-inset-top', value);

      expect(readScrollInset(element, 'top')).toBe(0);
    });

    it('should read an unmarked element as nothing covered', () => {
      expect(readScrollInset(element, 'top')).toBe(0);
      expect(readScrollInset(element, 'bottom')).toBe(0);
    });
  });

  describe('uncoveredRect', () => {
    const rect = new DOMRect(10, 100, 200, 400);

    it('should return the rect itself while nothing is covered', () => {
      expect(uncoveredRect(element, rect)).toBe(rect);
    });

    it('should shrink the rect by the space covered at its edges', () => {
      element.setAttribute('data-scroll-inset-top', '60');
      element.setAttribute('data-scroll-inset-bottom', '40');

      const uncovered = uncoveredRect(element, rect);

      expect([uncovered?.left, uncovered?.top, uncovered?.right, uncovered?.bottom]).toEqual([
        10, 160, 210, 460,
      ]);
    });

    it('should be null when the insets cover all of it', () => {
      element.setAttribute('data-scroll-inset-top', '250');
      element.setAttribute('data-scroll-inset-bottom', '150');

      expect(uncoveredRect(element, rect)).toBeNull();
    });

    it('should read the element rect when none is given', () => {
      element.getBoundingClientRect = () => rect;
      element.setAttribute('data-scroll-inset-top', '60');

      expect(uncoveredRect(element)?.top).toBe(160);
    });
  });
});

describe('visible part of an element', () => {
  const created: HTMLElement[] = [];

  /** An element in `parent` with a stubbed rect (left 0, width 200) and optional classes/insets */
  function box(
    parent: Node,
    top: number,
    bottom: number,
    options: { tag?: string; scroller?: boolean; insetTop?: number; insetBottom?: number } = {},
  ): HTMLElement {
    const el = document.createElement(options.tag ?? 'div');
    if (options.scroller) el.classList.add('vdnd-scrollable');
    if (options.insetTop) el.setAttribute('data-scroll-inset-top', String(options.insetTop));
    if (options.insetBottom)
      el.setAttribute('data-scroll-inset-bottom', String(options.insetBottom));
    el.getBoundingClientRect = () => new DOMRect(0, top, 200, bottom - top);
    parent.appendChild(el);
    created.push(el);
    return el;
  }

  const edges = (r: DOMRect | null): number[] | null => (r ? [r.top, r.bottom] : null);

  afterEach(() => {
    created.forEach((el) => el.remove());
    created.length = 0;
  });

  it('should be the element rect itself when nothing clips or covers it', () => {
    const el = box(document.body, 0, 500);
    const rect = el.getBoundingClientRect();

    expect(visibleRect(el, rect)).toBe(rect);
  });

  it('should clip to every scroll container around it, minus the space covered in each', () => {
    // A page scroller (0..800) with a 100px sticky header, holding a column scroller (50..600)
    // with a 30px sticky footer, holding a list taller than both
    const page = box(document.body, 0, 800, { scroller: true, insetTop: 100 });
    const column = box(page, 50, 600, { scroller: true, insetBottom: 30 });
    const list = box(column, -400, 2000);

    expect(edges(visibleRect(list))).toEqual([100, 570]);
  });

  it('should take its own covered space when it is a scroll container itself', () => {
    const scroller = box(document.body, 0, 400, { scroller: true, insetTop: 60, insetBottom: 40 });

    expect(edges(visibleRect(scroller))).toEqual([60, 360]);
  });

  it('should take the covered space of the vdnd-virtual-scroll inside it', () => {
    // vdnd-sortable-list's droppable wraps the vdnd-virtual-scroll that scrolls its rows
    const droppable = box(document.body, 0, 400);
    box(droppable, 0, 400, { tag: 'vdnd-virtual-scroll', insetTop: 40 });

    expect(edges(visibleRect(droppable))).toEqual([40, 400]);
  });

  it('should clip to a scroll container outside the shadow root it renders in', () => {
    const page = box(document.body, 0, 800, { scroller: true, insetTop: 100 });
    const host = box(page, 0, 800);
    const list = box(host.attachShadow({ mode: 'open' }), -200, 2000);

    expect(edges(visibleRect(list))).toEqual([100, 800]);
  });

  it('should read each rect through the given reader', () => {
    const page = box(document.body, 0, 800, { scroller: true, insetTop: 100 });
    const list = box(page, -200, 2000);
    const read = jest.fn((el: Element) => el.getBoundingClientRect());

    visibleRect(list, undefined, read);

    expect(read.mock.calls.map(([el]) => el)).toEqual([list, page]);
  });

  it('should be null when a scroll container around it hides all of it', () => {
    // The scroller shows 160..300; the list (100..130) is scrolled out above it. A DOMRect with
    // a negative height would normalize to 130..160, between them.
    const scroller = box(document.body, 160, 300, { scroller: true });
    const list = box(scroller, 100, 130);

    expect(visibleRect(list)).toBeNull();
  });

  it('should be null when it is behind what a scroll container around it covers', () => {
    const scroller = box(document.body, 100, 300, { scroller: true, insetTop: 60 });
    const list = box(scroller, 100, 130);

    expect(visibleRect(list)).toBeNull();
  });

  it('should list the scroll containers around an element, nearest first', () => {
    const page = box(document.body, 0, 800, { scroller: true });
    const column = box(page, 0, 800, { scroller: true });
    const plain = box(column, 0, 800);
    const inset = box(plain, 0, 800, { tag: 'vdnd-virtual-viewport', insetTop: 10 });
    const list = box(inset, 0, 800);

    expect(scrollAncestors(list)).toEqual([inset, column, page]);
  });
});
