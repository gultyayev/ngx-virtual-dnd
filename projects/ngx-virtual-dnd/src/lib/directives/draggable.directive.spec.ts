import { Component, DebugElement, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DraggableDirective } from './draggable.directive';
import { DroppableDirective } from './droppable.directive';
import { DragStateService } from '../services/drag-state.service';
import { PositionCalculatorService } from '../services/position-calculator.service';
import { AutoScrollService } from '../services/auto-scroll.service';
import { ElementCloneService } from '../services/element-clone.service';
import { KeyboardDragService } from '../services/keyboard-drag.service';
import { DragStartEvent, DragEndEvent } from '../models/drag-drop.models';

// Test host component
@Component({
  template: `
    <div
      vdndDroppable="test-list"
      vdndDroppableGroup="test-group"
      style="height: 400px; overflow: auto; padding-top: 20px; row-gap: 10px;"
    >
      <div data-draggable-id="preceding-item-1"></div>
      <div data-draggable-id="preceding-item-2"></div>
      <div
        vdndDraggable="test-item"
        vdndDraggableGroup="test-group"
        [vdndDraggableData]="itemData"
        [disabled]="disabled()"
        [dragHandle]="dragHandle()"
        [dragThreshold]="dragThreshold()"
        [dragDelay]="dragDelay()"
        [lockAxis]="lockAxis()"
        style="height: 50px; width: 200px;"
        (dragStart)="onDragStart($event)"
        (dragEnd)="onDragEnd($event)"
      >
        <span class="handle">Handle</span>
        <span class="content">Content</span>
        <button>Button</button>
        <input type="text" />
      </div>
    </div>
    <div
      vdndDroppable="foreign-list"
      vdndDroppableGroup="test-group"
      style="height: 400px; overflow: auto;"
    ></div>
  `,
  imports: [DraggableDirective, DroppableDirective],
})
class TestHostComponent {
  itemData = { id: 1, name: 'Test Item' };
  disabled = signal(false);
  dragHandle = signal<string | undefined>(undefined);
  dragThreshold = signal(5);
  dragDelay = signal(0);
  lockAxis = signal<'x' | 'y' | null>(null);

  dragStartEvents: DragStartEvent[] = [];
  dragEndEvents: DragEndEvent[] = [];

  onDragStart(event: DragStartEvent): void {
    this.dragStartEvents.push(event);
  }

  onDragEnd(event: DragEndEvent): void {
    this.dragEndEvents.push(event);
  }
}

describe('DraggableDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let component: TestHostComponent;
  let draggableEl: DebugElement;
  let draggableNative: HTMLElement;
  let directive: DraggableDirective;
  let dragStateService: DragStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [
        DragStateService,
        PositionCalculatorService,
        AutoScrollService,
        ElementCloneService,
      ],
    });

    fixture = TestBed.createComponent(TestHostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    draggableEl = fixture.debugElement.query(By.directive(DraggableDirective));
    draggableNative = draggableEl.nativeElement;
    directive = draggableEl.injector.get(DraggableDirective);
    dragStateService = TestBed.inject(DragStateService);
  });

  afterEach(() => {
    dragStateService.endDrag();
    fixture.destroy();
  });

  /**
   * Press on `target` and move the pointer past the 5px threshold — the full gesture that
   * starts a pointer drag. A mousedown alone never starts one, so negative tests must use this.
   */
  function attemptPointerDrag(target: Element, button = 0): void {
    target.dispatchEvent(
      new MouseEvent('mousedown', {
        clientX: 100,
        clientY: 100,
        button,
        bubbles: true,
        cancelable: true,
      }),
    );
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 120 }));
  }

  it('should start a drag when pressing and moving past the threshold', () => {
    attemptPointerDrag(draggableNative);

    expect(dragStateService.isDragging()).toBe(true);
    expect(component.dragStartEvents.length).toBe(1);
  });

  describe('initialization', () => {
    it('should have data-draggable-id attribute', () => {
      expect(draggableNative.getAttribute('data-draggable-id')).toBe('test-item');
    });

    it('should have vdnd-draggable class', () => {
      expect(draggableNative.classList.contains('vdnd-draggable')).toBe(true);
    });

    it('should have tabindex 0 when not disabled', () => {
      expect(draggableNative.getAttribute('tabindex')).toBe('0');
    });

    it('should have aria-grabbed false initially', () => {
      expect(draggableNative.getAttribute('aria-grabbed')).toBe('false');
    });

    it('should not have vdnd-draggable-dragging class initially', () => {
      expect(draggableNative.classList.contains('vdnd-draggable-dragging')).toBe(false);
    });
  });

  describe('disabled state', () => {
    it('should have vdnd-draggable-disabled class when disabled', () => {
      component.disabled.set(true);
      fixture.detectChanges();

      expect(draggableNative.classList.contains('vdnd-draggable-disabled')).toBe(true);
    });

    it('should have tabindex -1 when disabled', () => {
      component.disabled.set(true);
      fixture.detectChanges();

      expect(draggableNative.getAttribute('tabindex')).toBe('-1');
    });

    it('should not start drag when disabled', () => {
      component.disabled.set(true);
      fixture.detectChanges();

      attemptPointerDrag(draggableNative);

      expect(dragStateService.isDragging()).toBe(false);
    });
  });

  describe('mousedown handling', () => {
    it('should not start drag on right click', () => {
      attemptPointerDrag(draggableNative, 2);

      expect(dragStateService.isDragging()).toBe(false);
    });

    it('should not start drag when pressing on a button', () => {
      attemptPointerDrag(draggableNative.querySelector('button')!);

      expect(dragStateService.isDragging()).toBe(false);
    });

    it('should not start drag when pressing on an input', () => {
      attemptPointerDrag(draggableNative.querySelector('input')!);

      expect(dragStateService.isDragging()).toBe(false);
    });

    it('should prevent default on mousedown', () => {
      const mousedown = new MouseEvent('mousedown', {
        clientX: 100,
        clientY: 100,
        button: 0,
        bubbles: true,
        cancelable: true,
      });
      draggableNative.dispatchEvent(mousedown);

      expect(mousedown.defaultPrevented).toBe(true);
    });
  });

  describe('drag handle', () => {
    beforeEach(() => {
      component.dragHandle.set('.handle');
      fixture.detectChanges();
    });

    it('should not start drag when pressing outside the handle', () => {
      attemptPointerDrag(draggableNative.querySelector('.content')!);

      expect(dragStateService.isDragging()).toBe(false);
    });

    it('should start drag when pressing on the handle', () => {
      attemptPointerDrag(draggableNative.querySelector('.handle')!);

      expect(dragStateService.isDragging()).toBe(true);
    });
  });

  describe('isDragging computed', () => {
    it('should return false when not dragging', () => {
      expect(directive.isDragging()).toBe(false);
    });

    it('should return false when different element is dragged', () => {
      // Simulate another element being dragged
      dragStateService.startDrag({
        draggableId: 'other-item',
        droppableId: 'test-list',
        element: document.createElement('div'),
        height: 50,
        width: 200,
      });

      expect(directive.isDragging()).toBe(false);

      dragStateService.endDrag();
    });
  });

  describe('drag state via service', () => {
    it('should show dragging class when service indicates this item is dragged', () => {
      // Directly set drag state via service
      dragStateService.startDrag({
        draggableId: 'test-item',
        droppableId: 'test-list',
        element: draggableNative,
        height: 50,
        width: 200,
      });
      fixture.detectChanges();

      expect(directive.isDragging()).toBe(true);
      expect(draggableNative.classList.contains('vdnd-draggable-dragging')).toBe(true);

      dragStateService.endDrag();
    });

    it('should hide element when dragging (display: none)', () => {
      dragStateService.startDrag({
        draggableId: 'test-item',
        droppableId: 'test-list',
        element: draggableNative,
        height: 50,
        width: 200,
      });
      fixture.detectChanges();

      expect(draggableNative.style.display).toBe('none');

      dragStateService.endDrag();
    });

    it('should set aria-grabbed when dragging', () => {
      dragStateService.startDrag({
        draggableId: 'test-item',
        droppableId: 'test-list',
        element: draggableNative,
        height: 50,
        width: 200,
      });
      fixture.detectChanges();

      expect(draggableNative.getAttribute('aria-grabbed')).toBe('true');

      dragStateService.endDrag();
    });

    it('should remove dragging class after drag ends', () => {
      dragStateService.startDrag({
        draggableId: 'test-item',
        droppableId: 'test-list',
        element: draggableNative,
        height: 50,
        width: 200,
      });
      fixture.detectChanges();

      dragStateService.endDrag();
      fixture.detectChanges();

      expect(draggableNative.classList.contains('vdnd-draggable-dragging')).toBe(false);
    });

    it('should restore display after drag ends', () => {
      dragStateService.startDrag({
        draggableId: 'test-item',
        droppableId: 'test-list',
        element: draggableNative,
        height: 50,
        width: 200,
      });
      fixture.detectChanges();

      dragStateService.endDrag();
      fixture.detectChanges();

      expect(draggableNative.style.display).not.toBe('none');
    });
  });

  describe('axis locking input', () => {
    it('should store null lockAxis in drag state when no axis is locked', () => {
      component.lockAxis.set(null);
      fixture.detectChanges();

      attemptPointerDrag(draggableNative);

      expect(dragStateService.isDragging()).toBe(true);
      expect(dragStateService.lockAxis()).toBeNull();
    });

    it('should pass x lockAxis to drag state and lock to the press position', () => {
      component.lockAxis.set('x');
      fixture.detectChanges();

      attemptPointerDrag(draggableNative);

      expect(dragStateService.isDragging()).toBe(true);
      expect(dragStateService.lockAxis()).toBe('x');
      // The axis locks where the pointer was pressed, not where the threshold was crossed
      expect(dragStateService.initialPosition()).toEqual({ x: 100, y: 100 });
    });

    it('should pass y lockAxis to drag state when starting a drag', () => {
      component.lockAxis.set('y');
      fixture.detectChanges();

      attemptPointerDrag(draggableNative);

      expect(dragStateService.isDragging()).toBe(true);
      expect(dragStateService.lockAxis()).toBe('y');
    });
  });

  describe('source index calculation', () => {
    function mockRect(element: HTMLElement, top: number, height: number): void {
      jest.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: top,
        top,
        right: 200,
        bottom: top + height,
        left: 0,
        width: 200,
        height,
        toJSON: () => ({}),
      } as DOMRect);
    }

    function startPointerDrag(position: { x: number; y: number }): void {
      draggableNative.dispatchEvent(
        new MouseEvent('mousedown', {
          clientX: 100,
          clientY: 145,
          button: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          clientX: position.x,
          clientY: position.y,
          bubbles: true,
        }),
      );
    }

    it('should calculate the source index from the parent when activation is over another list', () => {
      const positionCalculator = TestBed.inject(PositionCalculatorService);
      const source = fixture.nativeElement.querySelector(
        '[data-droppable-id="test-list"]',
      ) as HTMLElement;
      const foreign = fixture.nativeElement.querySelector(
        '[data-droppable-id="foreign-list"]',
      ) as HTMLElement;
      mockRect(draggableNative, 140, 50);
      mockRect(source, 0, 400);
      mockRect(foreign, 500, 400);
      jest.spyOn(positionCalculator, 'findDroppableAtPoint').mockReturnValue(foreign);

      startPointerDrag({ x: 500, y: 550 });

      expect(component.dragStartEvents[0].sourceIndex).toBe(2);
    });

    it('should count preceding items for a non-virtual list with padding and gaps', () => {
      const positionCalculator = TestBed.inject(PositionCalculatorService);
      const source = fixture.nativeElement.querySelector(
        '[data-droppable-id="test-list"]',
      ) as HTMLElement;
      mockRect(draggableNative, 140, 50);
      mockRect(source, 0, 400);
      jest.spyOn(positionCalculator, 'findDroppableAtPoint').mockReturnValue(source);

      startPointerDrag({ x: 100, y: 155 });

      expect(component.dragStartEvents[0].sourceIndex).toBe(2);
    });
  });

  describe('keyboard handling', () => {
    it('should prevent default on space when not disabled', () => {
      const space = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      draggableNative.dispatchEvent(space);

      expect(space.defaultPrevented).toBe(true);
    });

    it('should not prevent default on space when disabled', () => {
      component.disabled.set(true);
      fixture.detectChanges();

      const space = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      draggableNative.dispatchEvent(space);

      // When disabled, returns true which doesn't prevent default
      expect(space.defaultPrevented).toBe(false);
    });

    it('should leave escape alone when not dragging', () => {
      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      draggableNative.dispatchEvent(escape);

      expect(escape.defaultPrevented).toBe(false);
      expect(component.dragEndEvents).toEqual([]);
    });

    it('should move exactly one position per arrow press when the source element is still focused', () => {
      const keyboardDrag = TestBed.inject(KeyboardDragService);

      // Start a keyboard drag via Space on the element
      draggableNative.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
      );
      expect(keyboardDrag.isActive()).toBe(true);
      const initialIndex = keyboardDrag.targetIndex() ?? 0;

      // Race window: the arrow key arrives before Angular applies display:none, so the
      // still-focused source element receives the keydown (host binding) AND it bubbles to the
      // document-level listener registered by KeyboardDragHandler. The item must move only ONE
      // position. (ArrowUp: the test item is last in its list, so ArrowDown would clamp and
      // mask a double move.)
      draggableNative.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
      );

      expect(keyboardDrag.targetIndex()).toBe(initialIndex - 1);
    });

    it('should cancel drag on escape when dragging', () => {
      dragStateService.startDrag({
        draggableId: 'test-item',
        droppableId: 'test-list',
        element: draggableNative,
        height: 50,
        width: 200,
      });
      fixture.detectChanges();

      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      });
      draggableNative.dispatchEvent(escape);
      fixture.detectChanges();

      expect(dragStateService.isDragging()).toBe(false);
      expect(dragStateService.wasCancelled()).toBe(true);
      expect(component.dragEndEvents).toEqual([
        expect.objectContaining({
          draggableId: 'test-item',
          cancelled: true,
          destinationIndex: null,
        }),
      ]);
    });
  });

  describe('cleanup', () => {
    it('should cancel an active drag when destroyed mid-drag', () => {
      attemptPointerDrag(draggableNative);
      expect(dragStateService.isDragging()).toBe(true);

      fixture.destroy();

      expect(dragStateService.isDragging()).toBe(false);
      expect(dragStateService.wasCancelled()).toBe(true);
      expect(component.dragEndEvents.at(-1)?.cancelled).toBe(true);
    });
  });
});
