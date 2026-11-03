// Loads zone.js for this file only (each spec file has its own environment): the library runs
// its drag listeners outside Angular's zone, which only matters in an app that uses zone.js.
import 'zone.js';
import {
  afterEveryRender,
  Component,
  Directive,
  EnvironmentInjector,
  NgZone,
  provideZoneChangeDetection,
} from '@angular/core';
import { ComponentFixtureAutoDetect, TestBed } from '@angular/core/testing';
import { DraggableDirective } from './draggable.directive';
import { DroppableDirective } from './droppable.directive';
import { ScrollableDirective } from './scrollable.directive';
import { VirtualForDirective } from './virtual-for.directive';
import { VirtualScrollContainerComponent } from '../components/virtual-scroll-container.component';

declare const Zone: { root: { run<T>(fn: () => T): T } };

@Component({
  template: `
    <div vdndDroppable="list" vdndDroppableGroup="g" (drop)="drops = drops + 1">
      <div vdndDraggable="item-a" vdndDraggableGroup="g" (dragEnd)="dragEnds = dragEnds + 1">A</div>
      <div vdndDraggable="item-b" vdndDraggableGroup="g">B</div>
    </div>
    <p data-testid="counts">{{ dragEnds }}/{{ drops }}</p>
  `,
  imports: [DraggableDirective, DroppableDirective],
})
class ZoneHostComponent {
  // Plain fields, not signals: with zone.js only a render triggered by the zone shows them
  dragEnds = 0;
  drops = 0;
}

@Component({
  template: `<div vdndDraggable="item-a" vdndDraggableGroup="g" [dragDelay]="50">A</div>`,
  imports: [DraggableDirective],
})
class DelayedZoneHostComponent {}

// A consumer directive that overrides the pointer press handler and records where it ran
@Directive({ selector: '[vdndTestPressRecordingDraggable]' })
class PressRecordingDraggableDirective extends DraggableDirective {
  pressesInZone: boolean[] = [];

  protected override onPointerDown(event: MouseEvent | TouchEvent, isTouch: boolean): void {
    this.pressesInZone.push(NgZone.isInAngularZone());
    super.onPointerDown(event, isTouch);
  }
}

@Component({
  template: `<div
    vdndTestPressRecordingDraggable
    vdndDraggable="item-a"
    vdndDraggableGroup="g"
  ></div>`,
  imports: [PressRecordingDraggableDirective],
})
class PressRecordingHostComponent {}

interface ClickRow {
  id: string;
}

const CLICK_ROWS: ClickRow[] = Array.from({ length: 1000 }, (_, i) => ({ id: `row-${i}` }));

@Component({
  template: `
    <ng-template #row let-row>
      <button type="button" [attr.data-id]="row.id" (click)="clicks = clicks + 1">
        {{ row.id }}
      </button>
    </ng-template>
    <vdnd-virtual-scroll
      [items]="rows"
      [itemHeight]="50"
      [containerHeight]="300"
      [itemIdFn]="rowId"
      [itemTemplate]="row"
    />
    <p data-testid="clicks">{{ clicks }}</p>
  `,
  imports: [VirtualScrollContainerComponent],
})
class ScrolledRowsHostComponent {
  readonly rows = CLICK_ROWS;
  readonly rowId = (row: ClickRow): string => row.id;
  // A plain field, not a signal: with zone.js only a render triggered by the zone shows it
  clicks = 0;
}

@Component({
  template: `
    <div class="scroller" vdndScrollable>
      <ng-container *vdndVirtualFor="let row of rows; itemHeight: 50; trackBy: trackById">
        <button type="button" [attr.data-id]="row.id" (click)="clicks = clicks + 1">
          {{ row.id }}
        </button>
      </ng-container>
    </div>
    <p data-testid="clicks">{{ clicks }}</p>
  `,
  imports: [ScrollableDirective, VirtualForDirective],
})
class ScrolledVirtualForHostComponent {
  readonly rows = CLICK_ROWS;
  readonly trackById = (_index: number, row: ClickRow): string => row.id;
  clicks = 0;
}

describe('rows rendered by a scroll in a zone.js app', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    globalThis.ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    } as unknown as typeof ResizeObserver;
    // jsdom has no layout: every scroll container is 300px tall
    jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    TestBed.configureTestingModule({
      providers: [
        provideZoneChangeDetection(),
        { provide: ComponentFixtureAutoDetect, useValue: true },
      ],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    globalThis.ResizeObserver = originalResizeObserver;
  });

  // The rows render in the scroll event, which reaches the library outside Angular's zone. A row
  // created there would run its listeners outside the zone, and nothing would render what they do.
  for (const [name, host, scrollerSelector] of [
    ['vdnd-virtual-scroll', ScrolledRowsHostComponent, 'vdnd-virtual-scroll'],
    ['*vdndVirtualFor', ScrolledVirtualForHostComponent, '.scroller'],
  ] as const) {
    it(`runs the listeners of the rows a scroll renders in the zone (${name})`, async () => {
      const fixture = TestBed.createComponent<{ clicks: number }>(host);
      await fixture.whenStable();
      const element: HTMLElement = fixture.nativeElement;
      const scroller = element.querySelector<HTMLElement>(scrollerSelector);
      if (!scroller) {
        throw new Error(`${scrollerSelector} not rendered`);
      }

      Zone.root.run(() => {
        scroller.scrollTop = 5000;
        scroller.dispatchEvent(new Event('scroll'));
      });
      await fixture.whenStable();
      // The last row in range: *vdndVirtualFor reuses the views of the rows that left (created in
      // the zone) for the first rows that come in, and creates this one in the scroll event
      const row = element.querySelector<HTMLElement>('[data-id="row-109"]');
      if (!row) {
        throw new Error('row-109 not rendered by the scroll');
      }
      Zone.root.run(() => row.click());

      expect(element.querySelector('[data-testid="clicks"]')?.textContent).toBe('1');
      fixture.destroy();
    });
  }
});

describe('drag outputs in a zone.js app', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZoneChangeDetection(),
        { provide: ComponentFixtureAutoDetect, useValue: true },
      ],
    });
  });

  it('renders a keyboard drop in one change detection, with focus back on the item', async () => {
    const fixture = TestBed.createComponent(ZoneHostComponent);
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    const item = host.querySelector<HTMLElement>('[data-draggable-id="item-a"]');
    if (!item) {
      throw new Error('item-a not rendered');
    }

    item.focus();
    item.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();

    let renders = 0;
    afterEveryRender(() => renders++, { injector: TestBed.inject(EnvironmentInjector) });
    // The drop key reaches the library's document listener, outside Angular's zone
    Zone.root.run(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      ),
    );

    expect(host.querySelector('[data-testid="counts"]')?.textContent).toBe('1/1');
    expect(renders).toBe(1);
    expect(document.activeElement).toBe(host.querySelector('[data-draggable-id="item-a"]'));
    fixture.destroy();
  });

  it('renders the dragStart and dragEnd of a pointer drag, each in one change detection', async () => {
    const fixture = TestBed.createComponent(ZoneHostComponent);
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    const item = host.querySelector<HTMLElement>('[data-draggable-id="item-a"]');
    if (!item) {
      throw new Error('item-a not rendered');
    }
    let renders = 0;
    afterEveryRender(() => renders++, { injector: TestBed.inject(EnvironmentInjector) });

    item.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 10, clientY: 10, button: 0, bubbles: true }),
    );
    await fixture.whenStable();
    renders = 0;
    // Pointer moves and the release reach the library's listeners outside Angular's zone
    Zone.root.run(() =>
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 40 })),
    );
    expect(renders).toBe(1);
    expect(item.style.display).toBe('none');

    renders = 0;
    Zone.root.run(() =>
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 10, clientY: 40 })),
    );

    // jsdom has no layout, so the release hits no droppable: dragEnd without a drop
    expect(host.querySelector('[data-testid="counts"]')?.textContent).toBe('1/0');
    expect(renders).toBe(1);
    fixture.destroy();
  });

  it('shows a touch press as ready to drag once its delay has passed', async () => {
    const fixture = TestBed.createComponent(DelayedZoneHostComponent);
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    const item = host.querySelector<HTMLElement>('[data-draggable-id="item-a"]');
    if (!item) {
      throw new Error('item-a not rendered');
    }

    const touch = { clientX: 10, clientY: 10 } as Touch;
    // The touch listener runs outside Angular's zone, and so does the delay it starts
    Zone.root.run(() =>
      item.dispatchEvent(
        new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch], bubbles: true }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    await fixture.whenStable();

    expect(item.classList.contains('vdnd-drag-pending')).toBe(true);
    Zone.root.run(() =>
      document.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch] })),
    );
    fixture.destroy();
  });

  it('runs the press handler of a touch in the zone, as it does for a mouse press', async () => {
    const fixture = TestBed.createComponent(PressRecordingHostComponent);
    await fixture.whenStable();
    const item = fixture.nativeElement.querySelector('[data-draggable-id="item-a"]') as HTMLElement;
    const touch = { clientX: 10, clientY: 10 } as Touch;

    Zone.root.run(() => {
      item.dispatchEvent(
        new MouseEvent('mousedown', { clientX: 10, clientY: 10, button: 0, bubbles: true }),
      );
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 10, clientY: 10 }));
      item.dispatchEvent(
        new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch], bubbles: true }),
      );
      document.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch] }));
    });

    const directive = fixture.debugElement.children[0].injector.get(
      PressRecordingDraggableDirective,
    );
    expect(directive.pressesInZone).toEqual([true, true]);
    fixture.destroy();
  });
});
