import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VirtualScrollContainerComponent } from './components/virtual-scroll-container.component';
import { VirtualViewportComponent } from './components/virtual-viewport.component';
import { VirtualContentComponent } from './components/virtual-content.component';
import { ScrollableDirective } from './directives/scrollable.directive';
import { VirtualForDirective } from './directives/virtual-for.directive';

/**
 * A browser dispatches a scroll event in the frame whose scroll position it reports, before
 * running its animation frame callbacks, laying out and painting. A virtual list that renders
 * the rows for that position any later (an animation frame, the change detection it schedules)
 * paints the frame with the rows of the previous position: blank space wherever the list moved
 * further than its overscan. So the rows must be in the DOM when the scroll event returns.
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

class MockResizeObserver {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}

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

describe('rendering a scroll in its scroll event', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    // jsdom has no layout: every scroll container is 300px tall (6 rows of 50px)
    jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
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
