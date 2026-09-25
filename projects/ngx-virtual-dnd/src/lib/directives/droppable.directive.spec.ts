import { Component, DebugElement, Directive, OnInit, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DroppableDirective } from './droppable.directive';
import { DroppableGroupDirective } from './droppable-group.directive';
import { DragStateService } from '../services/drag-state.service';
import { AutoScrollConfig, AutoScrollService } from '../services/auto-scroll.service';
import { PositionCalculatorService } from '../services/position-calculator.service';
import {
  DraggedItem,
  DropEvent,
  END_OF_LIST,
  PlaceholderMoveEvent,
} from '../models/drag-drop.models';

// Test host component
@Component({
  template: `
    <div
      [vdndDroppable]="droppableId()"
      vdndDroppableGroup="test-group"
      [vdndDroppableData]="listData"
      [disabled]="disabled()"
      [autoScrollEnabled]="autoScrollEnabled()"
      [autoScrollConfig]="autoScrollConfig()"
      style="height: 300px; overflow: auto;"
      (drop)="onDrop($event)"
      (placeholderMove)="onPlaceholderMove($event)"
    >
      @for (item of items; track item.id) {
        <div [attr.data-draggable-id]="item.id" style="height: 50px;">
          {{ item.name }}
        </div>
      }
    </div>
  `,
  imports: [DroppableDirective],
})
class TestHostComponent {
  listData = { listId: 'list-1' };
  droppableId = signal('test-list');
  items = [
    { id: 'item-1', name: 'Item 1' },
    { id: 'item-2', name: 'Item 2' },
    { id: 'item-3', name: 'Item 3' },
  ];
  disabled = signal(false);
  autoScrollEnabled = signal(true);
  autoScrollConfig = signal<Partial<AutoScrollConfig>>({});

  dropEvents: DropEvent[] = [];

  onDrop(event: DropEvent): void {
    this.dropEvents.push(event);
  }

  placeholderMoveEvents: PlaceholderMoveEvent[] = [];

  onPlaceholderMove(event: PlaceholderMoveEvent): void {
    this.placeholderMoveEvents.push(event);
  }
}

// Droppable that inherits a bound group, which has no value before the first render
@Component({
  template: `<div [vdndGroup]="group"><div vdndDroppable="grouped-list"></div></div>`,
  imports: [DroppableDirective, DroppableGroupDirective],
})
class BoundGroupHostComponent {
  group = 'test-group';
}

// A consumer directive that extends the droppable with an ngOnInit of its own
@Directive({ selector: '[vdndTestExtendedDroppable]' })
class ExtendedDroppableDirective extends DroppableDirective implements OnInit {
  initCalls = 0;

  ngOnInit(): void {
    this.initCalls++;
  }
}

@Component({
  template: `<div
    vdndTestExtendedDroppable
    vdndDroppable="extended-list"
    vdndDroppableGroup="test-group"
  ></div>`,
  imports: [ExtendedDroppableDirective],
})
class ExtendedDroppableHostComponent {}

describe('DroppableDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let component: TestHostComponent;
  let droppableEl: DebugElement;
  let droppableNative: HTMLElement;
  let directive: DroppableDirective;
  let dragStateService: DragStateService;
  let autoScrollService: AutoScrollService;

  const createMockDraggedItem = (overrides?: Partial<DraggedItem>): DraggedItem => ({
    draggableId: 'item-1',
    droppableId: 'test-list',
    element: document.createElement('div'),
    height: 50,
    width: 200,
    data: { id: 'item-1', name: 'Item 1' },
    ...overrides,
  });

  const makeScrollable = (element: HTMLElement): void => {
    element.style.overflowY = 'auto';
    Object.defineProperties(element, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 200 },
      clientWidth: { configurable: true, value: 200 },
    });
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [DragStateService, AutoScrollService, PositionCalculatorService],
    });

    fixture = TestBed.createComponent(TestHostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    droppableEl = fixture.debugElement.query(By.directive(DroppableDirective));
    droppableNative = droppableEl.nativeElement;
    directive = droppableEl.injector.get(DroppableDirective);
    dragStateService = TestBed.inject(DragStateService);
    autoScrollService = TestBed.inject(AutoScrollService);
  });

  afterEach(() => {
    dragStateService.endDrag();
    fixture.destroy();
  });

  describe('initialization', () => {
    it('should have data-droppable-id attribute', () => {
      expect(droppableNative.getAttribute('data-droppable-id')).toBe('test-list');
    });

    it('should have data-droppable-group attribute', () => {
      expect(droppableNative.getAttribute('data-droppable-group')).toBe('test-group');
    });

    it('should have vdnd-droppable class', () => {
      expect(droppableNative.classList.contains('vdnd-droppable')).toBe(true);
    });

    it('should not have vdnd-droppable-active class initially', () => {
      expect(droppableNative.classList.contains('vdnd-droppable-active')).toBe(false);
    });
  });

  describe('disabled state', () => {
    it('should have vdnd-droppable-disabled class when disabled', () => {
      component.disabled.set(true);
      fixture.detectChanges();

      expect(droppableNative.classList.contains('vdnd-droppable-disabled')).toBe(true);
    });

    it('should not reflect data-droppable-disabled attribute when enabled', () => {
      expect(droppableNative.hasAttribute('data-droppable-disabled')).toBe(false);
    });

    it('should reflect data-droppable-disabled attribute when disabled', () => {
      component.disabled.set(true);
      fixture.detectChanges();

      expect(droppableNative.hasAttribute('data-droppable-disabled')).toBe(true);
    });

    it('should not be active when disabled', () => {
      component.disabled.set(true);
      fixture.detectChanges();

      const item = createMockDraggedItem();
      dragStateService.startDrag(item);
      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 100 },
        activeDroppableId: 'test-list',
        placeholderId: null,
        placeholderIndex: null,
      });
      fixture.detectChanges();

      expect(directive.isActive()).toBe(false);
      expect(droppableNative.classList.contains('vdnd-droppable-active')).toBe(false);

      dragStateService.endDrag();
    });
  });

  describe('isActive computed', () => {
    it('should return false when not dragging', () => {
      expect(directive.isActive()).toBe(false);
    });

    it('should return true when this droppable is active', () => {
      const item = createMockDraggedItem();
      dragStateService.startDrag(item);
      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 100 },
        activeDroppableId: 'test-list',
        placeholderId: null,
        placeholderIndex: null,
      });
      fixture.detectChanges();

      expect(directive.isActive()).toBe(true);

      dragStateService.endDrag();
    });

    it('should return false when different droppable is active', () => {
      const item = createMockDraggedItem();
      dragStateService.startDrag(item);
      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 100 },
        activeDroppableId: 'other-list',
        placeholderId: null,
        placeholderIndex: null,
      });
      fixture.detectChanges();

      expect(directive.isActive()).toBe(false);

      dragStateService.endDrag();
    });
  });

  describe('active state class', () => {
    it('should add vdnd-droppable-active class when active', () => {
      const item = createMockDraggedItem();
      dragStateService.startDrag(item);
      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 100 },
        activeDroppableId: 'test-list',
        placeholderId: null,
        placeholderIndex: null,
      });
      fixture.detectChanges();

      expect(droppableNative.classList.contains('vdnd-droppable-active')).toBe(true);

      dragStateService.endDrag();
    });

    it('should remove vdnd-droppable-active class when inactive', () => {
      const item = createMockDraggedItem();
      dragStateService.startDrag(item);
      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 100 },
        activeDroppableId: 'test-list',
        placeholderId: null,
        placeholderIndex: null,
      });
      fixture.detectChanges();

      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 100 },
        activeDroppableId: null,
        placeholderId: null,
        placeholderIndex: null,
      });
      fixture.detectChanges();

      expect(droppableNative.classList.contains('vdnd-droppable-active')).toBe(false);

      dragStateService.endDrag();
    });
  });

  describe('placeholderId computed', () => {
    it('should return null when not active', () => {
      expect(directive.placeholderId()).toBeNull();
    });

    it('should return placeholder ID when active', () => {
      const item = createMockDraggedItem();
      dragStateService.startDrag(item);
      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 100 },
        activeDroppableId: 'test-list',
        placeholderId: 'item-2',
        placeholderIndex: 1,
      });
      fixture.detectChanges();

      expect(directive.placeholderId()).toBe('item-2');

      dragStateService.endDrag();
    });
  });

  describe('drop emission', () => {
    it('calculates source index when the source droppable ID has selector-sensitive characters', () => {
      const unsafeDroppableId = 'source-"quoted"\\[one]';
      component.droppableId.set(unsafeDroppableId);
      fixture.detectChanges();

      const item = createMockDraggedItem({
        draggableId: 'item-2',
        droppableId: unsafeDroppableId,
      });

      dragStateService.startDrag(item);
      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 100 },
        activeDroppableId: unsafeDroppableId,
        placeholderId: 'item-3',
        placeholderIndex: null,
      });
      fixture.detectChanges();

      dragStateService.endDrag();
      fixture.detectChanges();

      expect(component.dropEvents.at(-1)?.source.index).toBe(1);
    });

    it('emits the drop when the target becomes active only at release (pointer-up flush)', () => {
      // The dragged item originates from another list; this droppable is never the active
      // target DURING the drag — it becomes active only in the same synchronous block as
      // endDrag (the pointer-up flush processes the final position, then clears state), so
      // the effect never observes isActive() === true and #wasActive stays false.
      const item = createMockDraggedItem({ draggableId: 'item-2', droppableId: 'other-list' });

      dragStateService.startDrag(
        item,
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        null,
        'other-list',
        null,
        null,
        0,
      );
      fixture.detectChanges(); // effect observes active=false; #wasActive stays false

      // Flush + end in one task, with no change detection in between.
      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 100 },
        activeDroppableId: 'test-list',
        placeholderId: 'item-3',
        placeholderIndex: 2,
      });
      dragStateService.endDrag();
      fixture.detectChanges();

      expect(component.dropEvents.length).toBe(1);
      expect(component.dropEvents.at(-1)?.destination.droppableId).toBe('test-list');
    });

    it('does not emit a drop for a droppable the release did not target', () => {
      const item = createMockDraggedItem({ draggableId: 'item-2', droppableId: 'other-list' });

      dragStateService.startDrag(
        item,
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        null,
        'other-list',
        null,
        null,
        0,
      );
      fixture.detectChanges();

      // Release resolves to a DIFFERENT droppable — this one must stay silent.
      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 100 },
        activeDroppableId: 'somewhere-else',
        placeholderId: null,
        placeholderIndex: 1,
      });
      dragStateService.endDrag();
      fixture.detectChanges();

      expect(component.dropEvents.length).toBe(0);
    });

    it('does not replay a completed drop when disabled toggles after the drag ends', () => {
      // A cross-list drop lands on this droppable via the pointer-up flush.
      const item = createMockDraggedItem({ draggableId: 'item-2', droppableId: 'other-list' });

      dragStateService.startDrag(
        item,
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        null,
        'other-list',
        null,
        null,
        0,
      );
      fixture.detectChanges();

      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 100 },
        activeDroppableId: 'test-list',
        placeholderId: 'item-3',
        placeholderIndex: 2,
      });
      dragStateService.endDrag();
      fixture.detectChanges();

      expect(component.dropEvents.length).toBe(1);

      // endedDragState still names this droppable, but the drop was already consumed.
      // Toggling disabled re-runs the effect — it must NOT re-emit the historical drop.
      component.disabled.set(true);
      fixture.detectChanges();
      component.disabled.set(false);
      fixture.detectChanges();

      expect(component.dropEvents.length).toBe(1);
    });

    it('does not emit a drop when an active target is disabled just before release', () => {
      const item = createMockDraggedItem({ draggableId: 'item-2', droppableId: 'other-list' });

      dragStateService.startDrag(
        item,
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        null,
        'other-list',
        null,
        null,
        0,
      );
      fixture.detectChanges();

      // Become the active target during the drag so #wasActive becomes true.
      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 100 },
        activeDroppableId: 'test-list',
        placeholderId: 'item-3',
        placeholderIndex: 2,
      });
      fixture.detectChanges();
      expect(directive.isActive()).toBe(true);

      // Disable and end in the same task (no change detection in between), so the effect
      // sees isDragging=false with a stale #wasActive=true and a live disabled()=true.
      component.disabled.set(true);
      dragStateService.endDrag();
      fixture.detectChanges();

      expect(component.dropEvents.length).toBe(0);

      // Re-enabling after the drag ended must not resurrect the suppressed drop either.
      component.disabled.set(false);
      fixture.detectChanges();

      expect(component.dropEvents.length).toBe(0);
    });

    it('uses the latest placeholder index when emitting a same-list drop', () => {
      const item = createMockDraggedItem({
        draggableId: 'item-2',
        droppableId: 'test-list',
      });

      dragStateService.startDrag(
        item,
        { x: 100, y: 100 },
        { x: 0, y: 0 },
        null,
        'test-list',
        'item-3',
        2,
        1,
        true,
      );
      fixture.detectChanges();

      dragStateService.setKeyboardTargetIndex(2);

      dragStateService.endDrag();
      fixture.detectChanges();

      expect(component.dropEvents.at(-1)?.destination.index).toBe(2);
    });
  });

  describe('performance: signal splitting', () => {
    it('does not re-run the drop effect on placeholder-only updates while active', () => {
      // The active droppable reads the terminal drop state from endedDragState at drag end,
      // NOT by polling every frame. Its effect must therefore stay keyed on the low-frequency
      // fields (active/dragging/draggedItem) and NOT re-run as the placeholder marches across
      // items at 60fps. See issue #28.
      const item = createMockDraggedItem();
      dragStateService.startDrag(item);
      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 100 },
        activeDroppableId: 'test-list',
        placeholderId: 'item-1',
        placeholderIndex: 0,
      });
      fixture.detectChanges();
      expect(directive.isActive()).toBe(true);

      // The drop effect reads endedDragState() on every run and nothing else does during a
      // live drag, so it is a faithful proxy for "the effect re-ran". Count reads triggered
      // purely by placeholder movement (activeDroppableId held constant).
      const effectRunSpy = jest.spyOn(dragStateService, 'endedDragState');

      for (let i = 1; i <= 5; i++) {
        dragStateService.updateDragPosition({
          cursorPosition: { x: 100, y: 100 + i },
          activeDroppableId: 'test-list',
          placeholderId: `item-${i}`,
          placeholderIndex: i,
        });
        fixture.detectChanges();
      }

      expect(effectRunSpy).not.toHaveBeenCalled();

      // Sanity check: the probe does see the effect run on a low-frequency change
      dragStateService.endDrag();
      fixture.detectChanges();
      expect(effectRunSpy).toHaveBeenCalled();

      effectRunSpy.mockRestore();
    });

    it('still emits the final placeholder index after placeholder-only updates', () => {
      // Removing per-frame caching must not lose the last placeholder position: endDrag()
      // snapshots the live signals, so the drop still carries the final index. Cross-list
      // drop keeps the index free of the same-list hidden-source adjustment.
      const item = createMockDraggedItem({ draggableId: 'item-2', droppableId: 'other-list' });
      dragStateService.startDrag(
        item,
        { x: 100, y: 100 },
        { x: 0, y: 0 },
        null,
        'other-list',
        'item-1',
        0,
        0,
      );
      fixture.detectChanges();

      // First frame becomes the active target, later frames move the placeholder only.
      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 120 },
        activeDroppableId: 'test-list',
        placeholderId: 'item-1',
        placeholderIndex: 0,
      });
      fixture.detectChanges();

      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 200 },
        activeDroppableId: 'test-list',
        placeholderId: END_OF_LIST,
        placeholderIndex: 3,
      });
      fixture.detectChanges();

      dragStateService.endDrag();
      fixture.detectChanges();

      expect(component.dropEvents.length).toBe(1);
      expect(component.dropEvents.at(-1)?.destination.index).toBe(3);
    });
  });

  describe('placeholderMove emission', () => {
    /** Start a same-list drag of item-1 (index 0) with the placeholder in its own slot. */
    const startSameListDrag = (): void => {
      dragStateService.startDrag(
        createMockDraggedItem(),
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        null,
        'test-list',
        END_OF_LIST,
        1, // same-list placeholder index includes the +1 hidden-source adjustment
        0,
      );
      fixture.detectChanges();
    };

    const movePlaceholder = (placeholderIndex: number | null, activeDroppableId = 'test-list') => {
      dragStateService.updateDragPosition({
        cursorPosition: { x: 0, y: 0 },
        activeDroppableId,
        placeholderId: END_OF_LIST,
        placeholderIndex,
      });
      fixture.detectChanges();
    };

    it('does not emit for the initial placeholder in the dragged item own slot', () => {
      startSameListDrag();

      expect(component.placeholderMoveEvents).toEqual([]);
    });

    it('emits every displacement with drop-convention indexes', () => {
      startSameListDrag();

      movePlaceholder(3);
      movePlaceholder(4);
      movePlaceholder(1);

      expect(component.placeholderMoveEvents.map((e) => [e.previousIndex, e.currentIndex])).toEqual(
        [
          [0, 2],
          [2, 3],
          [3, 0],
        ],
      );
      expect(component.placeholderMoveEvents[0]).toEqual({
        draggableId: 'item-1',
        sourceDroppableId: 'test-list',
        droppableId: 'test-list',
        previousIndex: 0,
        currentIndex: 2,
        data: { id: 'item-1', name: 'Item 1' },
      });
    });

    it('does not emit when the placeholder index is unchanged', () => {
      startSameListDrag();

      movePlaceholder(3);
      movePlaceholder(3);

      expect(component.placeholderMoveEvents.length).toBe(1);
    });

    it('reports the source index as previous for a first placement away from the own slot', () => {
      dragStateService.startDrag(
        createMockDraggedItem(),
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        null,
        'test-list',
        END_OF_LIST,
        3,
        0,
      );
      fixture.detectChanges();

      expect(component.placeholderMoveEvents.map((e) => e.previousIndex)).toEqual([0]);
      expect(component.placeholderMoveEvents.map((e) => e.currentIndex)).toEqual([2]);
    });

    it('emits with a null previous index when entering from another droppable', () => {
      dragStateService.startDrag(
        createMockDraggedItem({ droppableId: 'other-list' }),
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        null,
        'other-list',
        END_OF_LIST,
        1,
        0,
      );
      fixture.detectChanges();

      movePlaceholder(2);

      expect(component.placeholderMoveEvents.length).toBe(1);
      expect(component.placeholderMoveEvents[0]).toEqual(
        expect.objectContaining({
          sourceDroppableId: 'other-list',
          droppableId: 'test-list',
          previousIndex: null,
          // Cross-list indexes have no hidden-source adjustment
          currentIndex: 2,
        }),
      );
    });

    it('emits on re-entering the source list after leaving it', () => {
      startSameListDrag();

      movePlaceholder(1, 'other-list');
      movePlaceholder(1);

      expect(component.placeholderMoveEvents.map((e) => [e.previousIndex, e.currentIndex])).toEqual(
        [[null, 0]],
      );
    });

    it('does not emit when the placeholder leaves or the drag ends', () => {
      startSameListDrag();
      movePlaceholder(3);
      component.placeholderMoveEvents = [];

      movePlaceholder(0, 'other-list');
      movePlaceholder(3);
      component.placeholderMoveEvents = [];
      dragStateService.endDrag();
      fixture.detectChanges();

      expect(component.placeholderMoveEvents).toEqual([]);
    });

    it('does not emit for a droppable the placeholder never enters', () => {
      dragStateService.startDrag(
        createMockDraggedItem({ droppableId: 'other-list' }),
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        null,
        'other-list',
        END_OF_LIST,
        1,
        0,
      );
      fixture.detectChanges();

      movePlaceholder(4, 'other-list');

      expect(component.placeholderMoveEvents).toEqual([]);
    });
  });

  describe('public methods', () => {
    it('getElement should return native element', () => {
      expect(directive.getElement()).toBe(droppableNative);
    });

    it('scrollBy should adjust scrollTop', () => {
      droppableNative.scrollTop = 0;
      directive.scrollBy(50);
      expect(droppableNative.scrollTop).toBe(50);
    });

    it('getScrollTop should return current scrollTop', () => {
      droppableNative.scrollTop = 100;
      expect(directive.getScrollTop()).toBe(100);
    });

    it('getScrollHeight should return scrollHeight', () => {
      makeScrollable(droppableNative);
      expect(directive.getScrollHeight()).toBe(600);
    });
  });

  describe('cleanup on destroy', () => {
    it('should destroy cleanly before its first change detection with a bound ID', () => {
      const unrendered = TestBed.createComponent(TestHostComponent);

      expect(() => unrendered.destroy()).not.toThrow();
    });

    it('should destroy cleanly before its first change detection inside a bound group', () => {
      const unrendered = TestBed.createComponent(BoundGroupHostComponent);

      expect(() => unrendered.destroy()).not.toThrow();
    });

    it('should clean up a subclass with its own ngOnInit when destroyed while active', () => {
      const extended = TestBed.createComponent(ExtendedDroppableHostComponent);
      extended.detectChanges();
      dragStateService.startDrag(createMockDraggedItem());
      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 100 },
        activeDroppableId: 'extended-list',
        placeholderId: null,
        placeholderIndex: null,
      });
      extended.detectChanges();
      const extendedDirective = extended.debugElement
        .query(By.directive(ExtendedDroppableDirective))
        .injector.get(ExtendedDroppableDirective);

      extended.destroy();

      expect(extendedDirective.initCalls).toBe(1);
      expect(dragStateService.activeDroppableId()).toBeNull();
    });

    it('should clear active droppable if destroyed while active', () => {
      const item = createMockDraggedItem();
      dragStateService.startDrag(item);
      dragStateService.updateDragPosition({
        cursorPosition: { x: 100, y: 100 },
        activeDroppableId: 'test-list',
        placeholderId: null,
        placeholderIndex: null,
      });
      fixture.detectChanges();

      expect(dragStateService.activeDroppableId()).toBe('test-list');

      fixture.destroy();

      expect(dragStateService.activeDroppableId()).toBeNull();

      dragStateService.endDrag();
    });
  });

  describe('auto-scroll integration', () => {
    it('should register even when the element is not scrollable at init', () => {
      // Registration must NOT depend on live DOM dimensions: a list populated from an
      // observable/HTTP renders empty first (scrollHeight === clientHeight), then grows
      // scrollable. DOM size is not reactive, so gating registration on it would leave
      // such a list permanently unregistered. AutoScrollService checks scrollability
      // fresh per drag instead.
      const registerSpy = jest.spyOn(autoScrollService, 'registerContainer');
      registerSpy.mockClear();

      const newFixture = TestBed.createComponent(TestHostComponent);
      newFixture.detectChanges();

      const newDroppableEl = newFixture.debugElement.query(By.directive(DroppableDirective))
        .nativeElement as HTMLElement;

      // No makeScrollable() call — element reports scrollHeight === clientHeight (0 in jsdom).
      expect(newDroppableEl.scrollHeight).toBe(newDroppableEl.clientHeight);
      expect(registerSpy).toHaveBeenCalledWith('test-list', newDroppableEl, {});

      newFixture.destroy();
    });

    it('should register when autoScrollEnabled changes to true after init', () => {
      const registerSpy = jest.spyOn(autoScrollService, 'registerContainer');
      registerSpy.mockClear();

      const newFixture = TestBed.createComponent(TestHostComponent);
      newFixture.componentInstance.autoScrollEnabled.set(false);
      newFixture.detectChanges();

      const newDroppableEl = newFixture.debugElement.query(By.directive(DroppableDirective))
        .nativeElement as HTMLElement;
      makeScrollable(newDroppableEl);
      newFixture.componentInstance.autoScrollConfig.set({ threshold: 80 });

      newFixture.componentInstance.autoScrollEnabled.set(true);
      newFixture.detectChanges();

      expect(registerSpy).toHaveBeenCalledWith('test-list', newDroppableEl, { threshold: 80 });

      newFixture.destroy();
    });

    it('should re-register when droppable ID changes', () => {
      const registerSpy = jest.spyOn(autoScrollService, 'registerContainer');
      const unregisterSpy = jest.spyOn(autoScrollService, 'unregisterContainer');
      registerSpy.mockClear();
      unregisterSpy.mockClear();

      const newFixture = TestBed.createComponent(TestHostComponent);
      newFixture.componentInstance.autoScrollEnabled.set(false);
      newFixture.detectChanges();

      const newDroppableEl = newFixture.debugElement.query(By.directive(DroppableDirective))
        .nativeElement as HTMLElement;
      makeScrollable(newDroppableEl);

      newFixture.componentInstance.autoScrollEnabled.set(true);
      newFixture.detectChanges();
      registerSpy.mockClear();
      unregisterSpy.mockClear();

      newFixture.componentInstance.droppableId.set('updated-list');
      newFixture.detectChanges();

      expect(unregisterSpy).toHaveBeenCalledWith('test-list');
      expect(registerSpy).toHaveBeenCalledWith('updated-list', newDroppableEl, {});

      newFixture.destroy();
    });

    it('should unregister from auto-scroll on destroy', () => {
      const unregisterSpy = jest.spyOn(autoScrollService, 'unregisterContainer');

      fixture.destroy();

      expect(unregisterSpy).toHaveBeenCalledWith('test-list');
    });
  });
});
