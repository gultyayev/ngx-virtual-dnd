/**
 * @jest-environment node
 */
import '@angular/compiler';
import { ApplicationRef, Component, provideZonelessChangeDetection, Type } from '@angular/core';
import { bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import type { JSDOM as JSDOMInstance } from 'jsdom';
import { VirtualScrollContainerComponent } from './components/virtual-scroll-container.component';
import { VirtualContentComponent } from './components/virtual-content.component';
import { VirtualSortableListComponent } from './components/virtual-sortable-list.component';
import { VirtualViewportComponent } from './components/virtual-viewport.component';
import { ContentHeaderDirective } from './directives/content-header.directive';
import { DraggableDirective } from './directives/draggable.directive';
import { DroppableGroupDirective } from './directives/droppable-group.directive';
import { DroppableDirective } from './directives/droppable.directive';
import { ScrollableDirective } from './directives/scrollable.directive';
import { VirtualForDirective } from './directives/virtual-for.directive';

/**
 * Server render, then client hydration, the way an SSR app runs: the HTML comes from
 * `@angular/platform-server` (in Node, with its own server DOM), and the client bootstraps with
 * `provideClientHydration()` on that markup in a browser DOM (jsdom). Hydration claims the
 * server's nodes instead of creating new ones, so the rows the server rendered must be the very
 * nodes the client shows, in the same order.
 *
 * Not in the jsdom test environment: the server render would reuse its browser test platform
 * (Angular keeps one platform at a time), and the server's DOM emulation would replace the jsdom
 * globals. The client gets a jsdom window of its own instead, once the server is done.
 */

// Loaded by Node itself, as jest-environment-jsdom does: jest's module loader cannot load the ES
// modules jsdom depends on
const nodeRequire = process.getBuiltinModule('node:module').createRequire(__filename);
const { JSDOM } = nodeRequire('jsdom') as typeof import('jsdom');

interface Row {
  id: string;
}

const ROW_COUNT = 20;

abstract class RowsHost {
  readonly rows: Row[] = Array.from({ length: ROW_COUNT }, (_, i) => ({ id: `row-${i}` }));
  readonly rowId = (row: Row): string => row.id;
  readonly trackById = (_index: number, row: Row): string => row.id;
}

@Component({
  selector: 'vdnd-hydration-root',
  template: `
    <p data-static>Static</p>
    <ng-template #row let-row>
      <div data-row>{{ row.id }}</div>
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
class ScrollContainerHostComponent extends RowsHost {}

@Component({
  selector: 'vdnd-hydration-root',
  template: `
    <p data-static>Static</p>
    <div vdndGroup="hydration">
      <vdnd-sortable-list
        droppableId="sortable"
        group="hydration"
        [items]="rows"
        [itemHeight]="50"
        [containerHeight]="300"
        [itemIdFn]="rowId"
        [itemTemplate]="row"
      />
    </div>
    <ng-template #row let-row>
      <div [vdndDraggable]="row.id" data-row>{{ row.id }}</div>
    </ng-template>
  `,
  imports: [DroppableGroupDirective, VirtualSortableListComponent, DraggableDirective],
})
class SortableListHostComponent extends RowsHost {}

@Component({
  selector: 'vdnd-hydration-root',
  template: `
    <p data-static>Static</p>
    <div vdndGroup="hydration">
      <vdnd-virtual-viewport vdndDroppable="list" [itemHeight]="50" style="height: 200px">
        <ng-container *vdndVirtualFor="let row of rows; trackBy: trackById">
          <div [vdndDraggable]="row.id" data-row>{{ row.id }}</div>
        </ng-container>
      </vdnd-virtual-viewport>
    </div>
  `,
  imports: [
    DroppableGroupDirective,
    VirtualViewportComponent,
    DroppableDirective,
    VirtualForDirective,
    DraggableDirective,
  ],
})
class ViewportHostComponent extends RowsHost {}

@Component({
  selector: 'vdnd-hydration-root',
  template: `
    <p data-static>Static</p>
    <div vdndScrollable style="height: 300px; overflow: auto">
      <vdnd-virtual-content [itemHeight]="50">
        <div vdndContentHeader>Header</div>
        <ng-container *vdndVirtualFor="let row of rows; trackBy: trackById">
          <div data-row>{{ row.id }}</div>
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
class ContentHostComponent extends RowsHost {}

@Component({
  selector: 'vdnd-hydration-root',
  template: `
    <p data-static>Static</p>
    <div vdndScrollable style="height: 300px; overflow: auto">
      <ng-container *vdndVirtualFor="let row of rows; trackBy: trackById; itemHeight: 50">
        <div data-row>{{ row.id }}</div>
      </ng-container>
    </div>
  `,
  imports: [ScrollableDirective, VirtualForDirective],
})
class StandaloneHostComponent extends RowsHost {}

const ROOT_DOCUMENT =
  '<html><head></head><body><vdnd-hydration-root></vdnd-hydration-root></body></html>';

async function renderOnServer(component: Type<unknown>): Promise<string> {
  const html = await renderApplication(
    (context) =>
      bootstrapApplication(
        component,
        {
          providers: [
            provideZonelessChangeDetection(),
            provideServerRendering(),
            provideClientHydration(),
          ],
        },
        context,
      ),
    { document: ROOT_DOCUMENT, url: '/' },
  );
  // renderApplication destroys the server platform in a timer after it resolves
  await new Promise((resolve) => setTimeout(resolve, 20));
  return html;
}

/** The globals of Node itself, before a server render adds those of its DOM emulation */
const NODE_GLOBALS = new Set(Object.getOwnPropertyNames(globalThis));

/** jsdom has no ResizeObserver (and no layout to report) */
class NoopResizeObserver {
  observe(): void {
    // Nothing to report
  }
  unobserve(): void {
    // Nothing observed
  }
  disconnect(): void {
    // Nothing observed
  }
}

/**
 * Make a jsdom window the client's browser environment: every global of it that Node lacks
 * (replacing those the server's DOM emulation set), and a ResizeObserver. Returns a function
 * that restores the previous globals.
 */
function installBrowserGlobals(dom: JSDOMInstance): () => void {
  const target = globalThis as Record<string, unknown>;
  const source = dom.window as unknown as Record<string, unknown>;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown): void => {
    previous.set(name, Object.getOwnPropertyDescriptor(target, name));
    Object.defineProperty(target, name, { value, configurable: true, writable: true });
  };
  for (const name of Object.getOwnPropertyNames(dom.window)) {
    if (NODE_GLOBALS.has(name)) continue;
    install(name, name === 'window' ? dom.window : source[name]);
  }
  install('ResizeObserver', NoopResizeObserver);
  return () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) {
        Object.defineProperty(target, name, descriptor);
      } else {
        delete target[name];
      }
    }
  };
}

interface Hydrated {
  document: Document;
  /** The rows in the server's markup, before the client bootstrapped */
  serverRows: Element[];
  /** Their text, before the client bootstrapped */
  serverTexts: string[];
  /** A static element of the root template, before the client bootstrapped */
  serverStatic: Element | null;
}

const rowText = (row: Element): string => row.textContent?.trim() ?? '';

describe('Client hydration of server-rendered rows', () => {
  let consoleError: jest.SpyInstance;
  let restoreGlobals: (() => void) | null = null;
  let appRef: ApplicationRef | null = null;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // Each bootstrap logs "Angular is running in development mode", the client its hydration
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    appRef?.destroy();
    appRef = null;
    restoreGlobals?.();
    restoreGlobals = null;
    jest.restoreAllMocks();
  });

  async function hydrate(component: Type<unknown>): Promise<Hydrated> {
    const html = await renderOnServer(component);
    const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
    restoreGlobals = installBrowserGlobals(dom);
    const doc = dom.window.document;
    const serverRows = Array.from(doc.querySelectorAll('[data-row]'));
    const serverTexts = serverRows.map(rowText);
    const serverStatic = doc.querySelector('[data-static]');

    appRef = await bootstrapApplication(component, {
      providers: [provideZonelessChangeDetection(), provideClientHydration()],
    });
    await appRef.whenStable();
    return { document: doc, serverRows, serverTexts, serverStatic };
  }

  /** The client shows the server's row nodes, in the server's order. */
  function expectServerRowsKept(hydrated: Hydrated): void {
    const { document: doc, serverRows, serverTexts, serverStatic } = hydrated;
    expect(consoleError).not.toHaveBeenCalled();
    // Control: the server rendered rows 0..n, and hydration kept a static element's node
    expect(serverRows.length).toBeGreaterThan(1);
    expect(serverTexts).toEqual(serverTexts.map((_, i) => `row-${i}`));
    expect(serverStatic).not.toBeNull();
    expect(doc.querySelector('[data-static]')).toBe(serverStatic);

    const clientRows = Array.from(doc.querySelectorAll('[data-row]'));
    expect(clientRows.map(rowText)).toEqual(clientRows.map((_, i) => `row-${i}`));
    // The same nodes: claimed from the server's markup, not created anew
    expect(serverRows.map((row, i) => clientRows[i] === row)).toEqual(serverRows.map(() => true));
  }

  it.each([
    ['vdnd-virtual-scroll', ScrollContainerHostComponent],
    ['vdnd-sortable-list', SortableListHostComponent],
    ['*vdndVirtualFor in vdnd-virtual-viewport', ViewportHostComponent],
    ['*vdndVirtualFor in vdnd-virtual-content', ContentHostComponent],
    ['*vdndVirtualFor in a vdndScrollable', StandaloneHostComponent],
  ])('%s keeps the server rows, in order', async (_name, host) => {
    expectServerRowsKept(await hydrate(host));
  });
});
