import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VirtualScrollContainerComponent } from './components/virtual-scroll-container.component';
import { VirtualViewportComponent } from './components/virtual-viewport.component';
import { VirtualContentComponent } from './components/virtual-content.component';
import { ScrollableDirective } from './directives/scrollable.directive';
import { VirtualForDirective } from './directives/virtual-for.directive';
import { ContentHeaderDirective } from './directives/content-header.directive';
import { DraggableDirective } from './directives/draggable.directive';

/**
 * A browser dispatches a scroll event in the frame whose scroll position it reports, before
 * running its animation frame callbacks, laying out and painting, and reports a resize to its
 * ResizeObservers after laying that frame out, before painting it. A virtual list that renders
 * the rows for a new position or size any later (an animation frame, the change detection it
 * schedules) paints the frame with the rows of the previous one: blank space wherever they don't
 * reach. So the rows must be in the DOM when the scroll event or the observer callback returns.
 *
 * Every list here: 1,000 rows of 50px in a 300px viewport (6 rows), overscan 3. Scrolled to
 * 5,000px, rows 100-105 are in view: rows 97 to 109 render, and the first of them sits at 4,850px.
 */

interface Row {
  id: string;
}

const ROWS: Row[] = Array.from({ length: 1000 }, (_, i) => ({ id: `row-${i}` }));

/** row IDs from..to inclusive */
const rowIds = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `row-${from + i}`);

/** jsdom has no ResizeObserver: this one reports what `resized()` tells it about its targets. */
class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  readonly #targets = new Set<Element>();
  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
    MockResizeObserver.instances.push(this);
  }

  /** What it observes */
  get targets(): ReadonlySet<Element> {
    return this.#targets;
  }

  observe(target: Element): void {
    this.#targets.add(target);
  }

  unobserve(target: Element): void {
    this.#targets.delete(target);
  }

  disconnect(): void {
    this.#targets.clear();
  }

  /** Report `target` at `height`, as the browser does after laying out a frame that resized it. */
  report(target: Element, height: number): void {
    if (!this.#targets.has(target)) return;
    const entry = { target, contentRect: { height } } as unknown as ResizeObserverEntry;
    this.#callback([entry], this as unknown as ResizeObserver);
  }
}

/** The browser laid `element` out at `height`: its observers report it. */
function resized(element: Element, height: number): void {
  for (const observer of MockResizeObserver.instances) {
    observer.report(element, height);
  }
}

/** Height every scroll container reports (jsdom has no layout) */
let viewportHeight = 300;

@Component({
  template: `
    <ng-template #row let-row>
      <div class="row" [attr.data-id]="row.id">{{ row.id }}</div>
    </ng-template>
    <vdnd-virtual-scroll
      [items]="rows"
      [itemHeight]="50"
      [containerHeight]="300"
      [itemIdFn]="rowId"
      [itemTemplate]="row"
    />
  `,
  imports: [VirtualScrollContainerComponent],
})
class VirtualScrollHostComponent {
  readonly rows = ROWS;
  readonly rowId = (row: Row): string => row.id;
}

@Component({
  template: `
    <ng-template #row let-row>
      <div class="row" [attr.data-id]="row.id">{{ row.id }}</div>
    </ng-template>
    <vdnd-virtual-scroll [items]="rows" [itemHeight]="50" [itemIdFn]="rowId" [itemTemplate]="row" />
  `,
  imports: [VirtualScrollContainerComponent],
})
class MeasuredVirtualScrollHostComponent {
  readonly rows = ROWS;
  readonly rowId = (row: Row): string => row.id;
}

@Component({
  template: `
    <ng-template #row let-row>
      <div class="row" [attr.data-id]="row.id" [vdndDraggable]="row.id">{{ row.id }}</div>
    </ng-template>
    <vdnd-virtual-scroll
      [items]="rows"
      [itemHeight]="50"
      [dynamicItemHeight]="true"
      [containerHeight]="300"
      [itemIdFn]="rowId"
      [itemTemplate]="row"
    />
  `,
  imports: [VirtualScrollContainerComponent, DraggableDirective],
})
class DynamicVirtualScrollHostComponent {
  readonly rows = ROWS;
  readonly rowId = (row: Row): string => row.id;
}

@Component({
  template: `
    <vdnd-virtual-viewport [itemHeight]="50">
      <ng-container *vdndVirtualFor="let row of rows(); trackBy: trackById">
        <div class="row" [attr.data-id]="row.id">{{ row.id }}</div>
      </ng-container>
    </vdnd-virtual-viewport>
  `,
  imports: [VirtualViewportComponent, VirtualForDirective],
})
class ViewportHostComponent {
  readonly rows = signal(ROWS);
  readonly trackById = (_index: number, row: Row): string => row.id;
}

@Component({
  template: `
    <div class="scroller" vdndScrollable>
      <ng-container *vdndVirtualFor="let row of rows(); itemHeight: 50; trackBy: trackById">
        <div class="row" [attr.data-id]="row.id">{{ row.id }}</div>
      </ng-container>
    </div>
  `,
  imports: [ScrollableDirective, VirtualForDirective],
})
class ScrollableHostComponent {
  readonly rows = signal(ROWS);
  readonly trackById = (_index: number, row: Row): string => row.id;
}

@Component({
  template: `
    <div class="scroller" vdndScrollable>
      @if (shown()) {
        <ng-container *vdndVirtualFor="let row of rows(); itemHeight: 50; trackBy: trackById">
          <div class="row" [attr.data-id]="row.id">{{ row.id }}</div>
        </ng-container>
      }
    </div>
  `,
  imports: [ScrollableDirective, VirtualForDirective],
})
class RemovableListHostComponent {
  readonly rows = signal(ROWS);
  readonly shown = signal(true);
  readonly trackById = (_index: number, row: Row): string => row.id;
}

@Component({
  template: `
    <div class="scroller" vdndScrollable>
      <vdnd-virtual-content [itemHeight]="50">
        <ng-container *vdndVirtualFor="let row of rows(); trackBy: trackById">
          <div class="row" [attr.data-id]="row.id">{{ row.id }}</div>
        </ng-container>
      </vdnd-virtual-content>
    </div>
  `,
  imports: [ScrollableDirective, VirtualContentComponent, VirtualForDirective],
})
class VirtualContentHostComponent {
  readonly rows = signal(ROWS);
  readonly trackById = (_index: number, row: Row): string => row.id;
}

@Component({
  template: `
    <div class="scroller" vdndScrollable>
      <vdnd-virtual-content [itemHeight]="50">
        <h3 vdndContentHeader>Today</h3>
        <ng-container *vdndVirtualFor="let row of rows(); trackBy: trackById">
          <div class="row" [attr.data-id]="row.id">{{ row.id }}</div>
        </ng-container>
      </vdnd-virtual-content>
    </div>
  `,
  imports: [
    ScrollableDirective,
    VirtualContentComponent,
    ContentHeaderDirective,
    VirtualForDirective,
  ],
})
class VirtualContentHeaderHostComponent {
  readonly rows = signal(ROWS);
  readonly trackById = (_index: number, row: Row): string => row.id;
}

const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  MockResizeObserver.instances = [];
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  viewportHeight = 300;
  jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => viewportHeight);
});

afterEach(() => {
  jest.restoreAllMocks();
  globalThis.ResizeObserver = originalResizeObserver;
});

function setUp<T>(host: new () => T): ComponentFixture<T> {
  TestBed.configureTestingModule({ imports: [host] });
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  return fixture;
}

const renderedIds = (fixture: ComponentFixture<unknown>): string[] =>
  Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.row')).map(
    (row) => row.getAttribute('data-id') ?? '',
  );

/** Scroll like the browser does: move the element, then dispatch its scroll event. */
const scroll = (scroller: HTMLElement, scrollTop: number): void => {
  scroller.scrollTop = scrollTop;
  scroller.dispatchEvent(new Event('scroll'));
};

const query = (fixture: ComponentFixture<unknown>, selector: string): HTMLElement => {
  const element = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`${selector} not rendered`);
  return element;
};

describe('rendering a scroll in its scroll event', () => {
  it('renders the rows and the offset of vdnd-virtual-scroll', () => {
    const fixture = setUp(VirtualScrollHostComponent);
    expect(renderedIds(fixture)).toEqual(rowIds(0, 9));

    scroll(query(fixture, 'vdnd-virtual-scroll'), 5000);

    expect(renderedIds(fixture)).toEqual(rowIds(97, 109));
    expect(query(fixture, '.vdnd-virtual-scroll-content-wrapper').style.transform).toBe(
      'translateY(4850px)',
    );
    fixture.destroy();
  });

  it('renders the rows and the offset of *vdndVirtualFor in vdnd-virtual-viewport', () => {
    const fixture = setUp(ViewportHostComponent);
    expect(renderedIds(fixture)).toEqual(rowIds(0, 9));

    scroll(query(fixture, 'vdnd-virtual-viewport'), 5000);

    expect(renderedIds(fixture)).toEqual(rowIds(97, 109));
    expect(query(fixture, '.vdnd-viewport-content').style.transform).toBe('translateY(4850px)');
    fixture.destroy();
  });

  it('renders the rows of *vdndVirtualFor in vdndScrollable at their offsets', () => {
    const fixture = setUp(ScrollableHostComponent);
    expect(renderedIds(fixture)).toEqual(rowIds(0, 9));

    scroll(query(fixture, '.scroller'), 5000);

    expect(renderedIds(fixture)).toEqual(rowIds(97, 109));
    expect(query(fixture, '[data-id="row-97"]').style.top).toBe('4850px');
    fixture.destroy();
  });

  it('renders the rows and the offset of vdnd-virtual-content in vdndScrollable', () => {
    const fixture = setUp(VirtualContentHostComponent);
    expect(renderedIds(fixture)).toEqual(rowIds(0, 9));

    scroll(query(fixture, '.scroller'), 5000);

    expect(renderedIds(fixture)).toEqual(rowIds(97, 109));
    expect(query(fixture, '.vdnd-content-wrapper').style.transform).toBe('translateY(4850px)');
    fixture.destroy();
  });

  it('stops rendering a list removed from the scroll container it renders in', () => {
    const fixture = setUp(RemovableListHostComponent);
    const scroller = query(fixture, '.scroller');
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    fixture.componentInstance.shown.set(false);
    fixture.detectChanges();
    expect(() => scroll(scroller, 5000)).not.toThrow();

    expect(renderedIds(fixture)).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('leaves the rows as they are for a scroll that brings no row into range', () => {
    const fixture = setUp(VirtualScrollHostComponent);
    const scroller = query(fixture, 'vdnd-virtual-scroll');
    const firstRow = query(fixture, '[data-id="row-0"]');

    // 20px down: rows 0-6 are in view, and rows 0-9 still cover them with the overscan below
    scroll(scroller, 20);

    expect(renderedIds(fixture)).toEqual(rowIds(0, 9));
    expect(query(fixture, '[data-id="row-0"]')).toBe(firstRow);
    fixture.destroy();
  });
});

describe('rendering a resize in its resize observer callback', () => {
  // 300px to 700px tall at the top of the list: rows 0-13 in view, rows 0-17 render
  for (const [name, host, scrollerSelector] of [
    ['vdnd-virtual-scroll', MeasuredVirtualScrollHostComponent, 'vdnd-virtual-scroll'],
    ['*vdndVirtualFor in vdnd-virtual-viewport', ViewportHostComponent, 'vdnd-virtual-viewport'],
    ['*vdndVirtualFor in vdndScrollable', ScrollableHostComponent, '.scroller'],
    ['vdnd-virtual-content in vdndScrollable', VirtualContentHostComponent, '.scroller'],
  ] as const) {
    it(`renders the rows a taller scroll container shows (${name})`, () => {
      const fixture = setUp<unknown>(host);
      expect(renderedIds(fixture)).toEqual(rowIds(0, 9));

      viewportHeight = 700;
      resized(query(fixture, scrollerSelector), 700);

      expect(renderedIds(fixture)).toEqual(rowIds(0, 17));
      fixture.destroy();
    });
  }

  // A list shown again (display: none on an ancestor, a tab switched back) or put back in the
  // page gets its scroll position restored without a scroll event: only the resize tells
  for (const [name, host, scrollerSelector] of [
    ['vdnd-virtual-scroll', VirtualScrollHostComponent, 'vdnd-virtual-scroll'],
    ['*vdndVirtualFor in vdnd-virtual-viewport', ViewportHostComponent, 'vdnd-virtual-viewport'],
    ['*vdndVirtualFor in vdndScrollable', ScrollableHostComponent, '.scroller'],
  ] as const) {
    it(`renders the rows of a scroll position restored without a scroll event (${name})`, () => {
      const fixture = setUp<unknown>(host);
      const scroller = query(fixture, scrollerSelector);

      scroller.scrollTop = 5000;
      resized(scroller, 300);

      expect(renderedIds(fixture)).toEqual(rowIds(97, 109));
      fixture.destroy();
    });
  }

  it('stops measuring the rows the render takes out of the DOM, in that render', () => {
    // A row out of the DOM reports a size of 0, at a depth the browser can't deliver while it is
    // still reporting resizes: measured in a resize render, it raises a ResizeObserver loop error
    const fixture = setUp(DynamicVirtualScrollHostComponent);
    fixture.detectChanges();
    const scroller = query(fixture, 'vdnd-virtual-scroll');
    const rowObserver = MockResizeObserver.instances.find((observer) =>
      [...observer.targets].some((target) => target.hasAttribute('data-draggable-id')),
    );
    if (!rowObserver) throw new Error('No observer measures the rows');
    const measuredRows = [...rowObserver.targets];

    scroller.scrollTop = 5000;
    resized(scroller, 300);

    expect(renderedIds(fixture)).toContain('row-100');
    expect(measuredRows.every((row) => !row.isConnected)).toBe(true);
    expect([...rowObserver.targets].filter((target) => !target.isConnected)).toEqual([]);
    fixture.destroy();
  });

  it('renders the rows a taller header above vdnd-virtual-content moves into view', () => {
    const fixture = setUp(VirtualContentHeaderHostComponent);
    const scroller = query(fixture, '.scroller');
    const header = query(fixture, '[vdndcontentheader]');
    const rowsBox = query(fixture, '.vdnd-virtual-area');
    // jsdom has no layout: the scroller is 300px tall at the top of the page, and the rows start
    // right below the header
    let headerHeight = 0;
    scroller.getBoundingClientRect = () => ({ top: 0, height: 300 }) as DOMRect;
    Object.defineProperty(scroller, 'offsetHeight', { value: 300, configurable: true });
    rowsBox.getBoundingClientRect = () => ({ top: headerHeight - scroller.scrollTop }) as DOMRect;
    resized(header, headerHeight);
    scroll(scroller, 5000);
    expect(renderedIds(fixture)).toEqual(rowIds(97, 109));

    // 400px taller: the rows start 400px further down, 4,600px into them is in view
    headerHeight = 400;
    resized(header, headerHeight);

    expect(renderedIds(fixture)).toEqual(rowIds(89, 101));
    fixture.destroy();
  });
});
