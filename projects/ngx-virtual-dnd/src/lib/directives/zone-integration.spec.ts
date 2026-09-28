// Loads zone.js for this file only (each spec file has its own environment): the library runs
// its drag listeners outside Angular's zone, which only matters in an app that uses zone.js.
import 'zone.js';
import {
  afterEveryRender,
  Component,
  EnvironmentInjector,
  provideZoneChangeDetection,
} from '@angular/core';
import { ComponentFixtureAutoDetect, TestBed } from '@angular/core/testing';
import { DraggableDirective } from './draggable.directive';
import { DroppableDirective } from './droppable.directive';

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
});
