import { Component, DebugElement, Directive, OnInit, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DraggableDirective } from './draggable.directive';
import { DroppableDirective } from './droppable.directive';
import { VirtualViewportComponent } from '../components/virtual-viewport.component';
import { DragStateService } from '../services/drag-state.service';
import { PositionCalculatorService } from '../services/position-calculator.service';
import { AutoScrollService } from '../services/auto-scroll.service';
import { ElementCloneService } from '../services/element-clone.service';
import { KeyboardDragService } from '../services/keyboard-drag.service';
import { DragStartEvent, DragEndEvent } from '../models/drag-drop.models';

// A web component whose input lives in its shadow DOM, like the form controls of many UI libraries
class ShadowInputElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = '<input type="text" />';
  }
}
if (!customElements.get('test-shadow-input')) {
  customElements.define('test-shadow-input', ShadowInputElement);
}

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

// Draggable whose required ID input is bound, so it has no value before the first render
@Component({
  template: `<div [vdndDraggable]="id" vdndDraggableGroup="test-group"></div>`,
  imports: [DraggableDirective],
})
class BoundIdHostComponent {
  id = 'bound-item';
}

// A vdnd-virtual-viewport droppable with plain rows (no *vdndVirtualFor, so no strategy)
@Component({
  template: `
    <vdnd-virtual-viewport
      vdndDroppable="viewport-list"
      vdndDroppableGroup="test-group"
      [itemHeight]="50"
      style="height: 400px"
    >
      <div data-draggable-id="viewport-row-1"></div>
      <div data-draggable-id="viewport-row-2"></div>
      <div
        vdndDraggable="viewport-row-3"
        vdndDraggableGroup="test-group"
        (dragStart)="dragStartEvents.push($event)"
      ></div>
    </vdnd-virtual-viewport>
  `,
  imports: [VirtualViewportComponent, DroppableDirective, DraggableDirective],
})
class ViewportRowsHostComponent {
  dragStartEvents: DragStartEvent[] = [];
}

// A consumer directive that extends the draggable and runs its own setup after the draggable's
@Directive({ selector: '[vdndTestExtendedDraggable]' })
class ExtendedDraggableDirective extends DraggableDirective implements OnInit {
  setUp = false;

  override ngOnInit(): void {
    super.ngOnInit();
    this.setUp = true;
  }
}

@Component({
  template: `
    <div vdndDroppable="extended-list" vdndDroppableGroup="test-group">
      <div
        vdndTestExtendedDraggable
        vdndDraggable="extended-item"
        vdndDraggableGroup="test-group"
      ></div>
    </div>
  `,
  imports: [ExtendedDraggableDirective, DroppableDirective],
})
class ExtendedDraggableHostComponent {}

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

  it('should cancel a pointer drag when the window loses focus mid-drag', () => {
    attemptPointerDrag(draggableNative);

    window.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(dragStateService.isDragging()).toBe(false);
    expect(component.dragEndEvents.length).toBe(1);
    expect(component.dragEndEvents[0].cancelled).toBe(true);
    expect(draggableNative.style.display).not.toBe('none');
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

  describe('web component marked no-drag', () => {
    // Events from inside its shadow DOM reach the draggable retargeted to the component element
    let shadowHost: HTMLElement;
    let shadowInput: HTMLInputElement;
    let targetsSeen: EventTarget[];

    beforeEach(() => {
      shadowHost = document.createElement('test-shadow-input');
      shadowHost.classList.add('no-drag');
      draggableNative.append(shadowHost);
      shadowInput = shadowHost.shadowRoot!.querySelector('input')!;
      targetsSeen = [];
      for (const type of ['mousedown', 'keydown']) {
        draggableNative.addEventListener(type, (event) => targetsSeen.push(event.target!));
      }
    });

    it('should not start a pointer drag from a press inside it', () => {
      shadowInput.dispatchEvent(
        new MouseEvent('mousedown', {
          clientX: 100,
          clientY: 100,
          button: 0,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 120 }));

      expect(targetsSeen).toEqual([shadowHost]);
      expect(dragStateService.isDragging()).toBe(false);
    });

    it('should let Space reach its input instead of starting a keyboard drag', () => {
      const space = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      shadowInput.dispatchEvent(space);

      expect(targetsSeen).toEqual([shadowHost]);
      expect(space.defaultPrevented).toBe(false);
      expect(TestBed.inject(KeyboardDragService).isActive()).toBe(false);
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

  describe('while another drag is active', () => {
    let otherElement: HTMLElement;

    beforeEach(() => {
      otherElement = document.createElement('div');
      document.body.appendChild(otherElement);
    });

    afterEach(() => {
      otherElement.remove();
    });

    function startOtherDrag(isKeyboardDrag = false): void {
      dragStateService.startDrag(
        {
          draggableId: 'other-item',
          droppableId: 'foreign-list',
          element: otherElement,
          height: 50,
          width: 200,
        },
        { x: 10, y: 10 },
        undefined,
        null,
        'foreign-list',
        null,
        0,
        0,
        isKeyboardDrag,
      );
    }

    it('should not start a pointer drag that would replace an active drag', () => {
      startOtherDrag();

      attemptPointerDrag(draggableNative);

      expect(dragStateService.draggedItem()?.draggableId).toBe('other-item');
      expect(component.dragStartEvents).toEqual([]);
    });

    it('should not start a pointer drag that would replace an active keyboard drag', () => {
      startOtherDrag(true);

      attemptPointerDrag(draggableNative);

      expect(dragStateService.draggedItem()?.draggableId).toBe('other-item');
      expect(dragStateService.isKeyboardDrag()).toBe(true);
      expect(component.dragStartEvents).toEqual([]);
    });

    it("should not take focus from a press during another item's keyboard drag", () => {
      startOtherDrag(true);
      const press = new MouseEvent('mousedown', {
        clientX: 100,
        clientY: 100,
        button: 0,
        bubbles: true,
        cancelable: true,
      });

      draggableNative.dispatchEvent(press);

      // A focused item would take the next Space and end the keyboard drag in its own name
      expect(press.defaultPrevented).toBe(true);
      expect(dragStateService.isKeyboardDrag()).toBe(true);
    });

    it('should not start a pending press once another drag has started', () => {
      // Both presses land before either crosses the threshold (two fingers on a touch screen)
      draggableNative.dispatchEvent(
        new MouseEvent('mousedown', {
          clientX: 100,
          clientY: 100,
          button: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
      startOtherDrag();
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 120 }));

      expect(dragStateService.draggedItem()?.draggableId).toBe('other-item');
      expect(component.dragStartEvents).toEqual([]);
      expect(component.dragEndEvents).toEqual([]);
    });

    it('should clear the pending state of a press that loses the race to another drag', () => {
      component.dragDelay.set(100);
      fixture.detectChanges();
      jest.useFakeTimers();
      try {
        draggableNative.dispatchEvent(
          new MouseEvent('mousedown', {
            clientX: 100,
            clientY: 100,
            button: 0,
            bubbles: true,
            cancelable: true,
          }),
        );
        jest.advanceTimersByTime(100);
        fixture.detectChanges();
        expect(draggableNative.classList.contains('vdnd-drag-pending')).toBe(true);

        startOtherDrag();
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 120 }));
        fixture.detectChanges();

        expect(draggableNative.classList.contains('vdnd-drag-pending')).toBe(false);
        expect(component.dragStartEvents).toEqual([]);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should not start a keyboard drag that would replace an active pointer drag', () => {
      startOtherDrag();
      const keyboardDrag = TestBed.inject(KeyboardDragService);

      draggableNative.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
      );

      expect(keyboardDrag.isActive()).toBe(false);
      expect(dragStateService.draggedItem()?.draggableId).toBe('other-item');
      expect(component.dragStartEvents).toEqual([]);
    });

    describe("with keys pressed on this item during another item's keyboard drag", () => {
      let reachedDocument: string[];
      const recordKey = (event: KeyboardEvent): void => {
        reachedDocument.push(event.key);
      };

      beforeEach(() => {
        reachedDocument = [];
        // The other item's keyboard drag listens on the document
        document.addEventListener('keydown', recordKey);
      });

      afterEach(() => {
        document.removeEventListener('keydown', recordKey);
      });

      const keys = [' ', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

      describe.each([false, true])('(this item disabled: %s)', (disabled) => {
        beforeEach(() => {
          component.disabled.set(disabled);
          fixture.detectChanges();
        });

        it.each(keys)('should leave %p to the drag it belongs to', (key) => {
          startOtherDrag(true);
          const targetIndexBefore = dragStateService.keyboardTargetIndex();

          draggableNative.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
          );
          fixture.detectChanges();

          // Not ended, moved or cancelled in this item's name...
          expect(component.dragEndEvents).toEqual([]);
          expect(dragStateService.isKeyboardDrag()).toBe(true);
          expect(dragStateService.draggedItem()?.draggableId).toBe('other-item');
          expect(dragStateService.keyboardTargetIndex()).toBe(targetIndexBefore);
          // ...but passed on to the other item's document listener
          expect(reachedDocument).toEqual([key]);
        });
      });
    });

    it('should start a pointer drag again once the other drag has ended', () => {
      startOtherDrag();
      attemptPointerDrag(draggableNative);
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 120 }));
      dragStateService.endDrag();

      attemptPointerDrag(draggableNative);

      expect(dragStateService.draggedItem()?.draggableId).toBe('test-item');
      expect(component.dragStartEvents.length).toBe(1);
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

    function startPointerDrag(
      position: { x: number; y: number },
      target: HTMLElement = draggableNative,
    ): void {
      target.dispatchEvent(
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

    it('should count preceding items in a vdnd-virtual-viewport without *vdndVirtualFor', () => {
      const viewportHost = TestBed.createComponent(ViewportRowsHostComponent);
      viewportHost.detectChanges();
      const viewport = viewportHost.nativeElement.querySelector(
        '[data-droppable-id="viewport-list"]',
      ) as HTMLElement;
      const row = viewportHost.nativeElement.querySelector(
        '[data-draggable-id="viewport-row-3"]',
      ) as HTMLElement;
      // Rows with gaps: the third row starts 140px down, which reads as index 3 by position
      mockRect(row, 140, 50);
      mockRect(viewport, 0, 400);
      jest
        .spyOn(TestBed.inject(PositionCalculatorService), 'findDroppableAtPoint')
        .mockReturnValue(viewport);

      startPointerDrag({ x: 100, y: 155 }, row);

      expect(viewportHost.componentInstance.dragStartEvents[0].sourceIndex).toBe(2);
      viewportHost.destroy();
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

    it('should let Space reach an input inside the draggable instead of starting a drag', () => {
      const keyboardDrag = TestBed.inject(KeyboardDragService);
      const input = draggableNative.querySelector('input') as HTMLInputElement;
      const space = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(space);

      expect(space.defaultPrevented).toBe(false);
      expect(keyboardDrag.isActive()).toBe(false);
      expect(component.dragStartEvents).toEqual([]);
    });

    it('should let Space activate a button inside the draggable instead of starting a drag', () => {
      const keyboardDrag = TestBed.inject(KeyboardDragService);
      const button = draggableNative.querySelector('button') as HTMLButtonElement;
      const space = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(space);

      expect(space.defaultPrevented).toBe(false);
      expect(keyboardDrag.isActive()).toBe(false);
      expect(component.dragStartEvents).toEqual([]);
    });

    it('should let Space reach a no-drag element inside the draggable instead of starting a drag', () => {
      const keyboardDrag = TestBed.inject(KeyboardDragService);
      const customControl = draggableNative.querySelector('.content') as HTMLElement;
      customControl.tabIndex = 0;
      customControl.classList.add('no-drag');
      const space = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      customControl.dispatchEvent(space);

      expect(space.defaultPrevented).toBe(false);
      expect(keyboardDrag.isActive()).toBe(false);
      expect(component.dragStartEvents).toEqual([]);
    });

    it('should let Space reach an element inside a no-drag element instead of starting a drag', () => {
      const keyboardDrag = TestBed.inject(KeyboardDragService);
      const region = draggableNative.querySelector('.content') as HTMLElement;
      region.classList.add('no-drag');
      const customControl = document.createElement('span');
      customControl.tabIndex = 0;
      region.appendChild(customControl);
      const space = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      customControl.dispatchEvent(space);

      expect(space.defaultPrevented).toBe(false);
      expect(keyboardDrag.isActive()).toBe(false);
      expect(component.dragStartEvents).toEqual([]);
    });

    describe('on a draggable that carries no-drag itself', () => {
      beforeEach(() => {
        draggableNative.classList.add('no-drag');
      });

      it('should still pick the item up with Space on the draggable', () => {
        const keyboardDrag = TestBed.inject(KeyboardDragService);
        const space = new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          bubbles: true,
          cancelable: true,
        });
        draggableNative.dispatchEvent(space);

        expect(space.defaultPrevented).toBe(true);
        expect(keyboardDrag.isActive()).toBe(true);
      });

      it('should let Space reach an element inside it instead of starting a drag', () => {
        const keyboardDrag = TestBed.inject(KeyboardDragService);
        const content = draggableNative.querySelector('.content') as HTMLElement;
        content.tabIndex = 0;
        const space = new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          bubbles: true,
          cancelable: true,
        });
        content.dispatchEvent(space);

        expect(space.defaultPrevented).toBe(false);
        expect(keyboardDrag.isActive()).toBe(false);
        expect(component.dragStartEvents).toEqual([]);
      });
    });

    it('should pick the item up with Space inside a draggable that sits in a no-drag element', () => {
      const keyboardDrag = TestBed.inject(KeyboardDragService);
      const outer = document.createElement('div');
      outer.classList.add('no-drag');
      draggableNative.parentElement!.insertBefore(outer, draggableNative);
      outer.appendChild(draggableNative);
      const content = draggableNative.querySelector('.content') as HTMLElement;
      content.tabIndex = 0;
      const space = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      content.dispatchEvent(space);

      expect(space.defaultPrevented).toBe(true);
      expect(keyboardDrag.isActive()).toBe(true);
      expect(component.dragStartEvents.length).toBe(1);
    });

    it('should pick the item up with Space on a button that is the drag handle', () => {
      component.dragHandle.set('button');
      fixture.detectChanges();
      const keyboardDrag = TestBed.inject(KeyboardDragService);
      const handle = draggableNative.querySelector('button') as HTMLButtonElement;
      const space = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      handle.dispatchEvent(space);

      expect(space.defaultPrevented).toBe(true);
      expect(keyboardDrag.isActive()).toBe(true);
      expect(component.dragStartEvents.length).toBe(1);
    });

    it('should let Space reach a control outside the drag handle', () => {
      component.dragHandle.set('button');
      fixture.detectChanges();
      const keyboardDrag = TestBed.inject(KeyboardDragService);
      const input = draggableNative.querySelector('input') as HTMLInputElement;
      const space = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(space);

      expect(space.defaultPrevented).toBe(false);
      expect(keyboardDrag.isActive()).toBe(false);
      expect(component.dragStartEvents).toEqual([]);
    });

    it('should let Space reach a control inside the drag handle', () => {
      // A handle region, such as a card header, that holds a text field
      const header = document.createElement('div');
      header.className = 'card-header';
      const input = draggableNative.querySelector('input') as HTMLInputElement;
      header.appendChild(input);
      draggableNative.appendChild(header);
      component.dragHandle.set('.card-header');
      fixture.detectChanges();
      const keyboardDrag = TestBed.inject(KeyboardDragService);
      const space = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(space);

      expect(space.defaultPrevented).toBe(false);
      expect(keyboardDrag.isActive()).toBe(false);
      expect(component.dragStartEvents).toEqual([]);
    });

    it('should still start a keyboard drag from a focusable non-control child such as a handle', () => {
      const keyboardDrag = TestBed.inject(KeyboardDragService);
      const handle = draggableNative.querySelector('.handle') as HTMLElement;
      handle.tabIndex = 0;
      const space = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      handle.dispatchEvent(space);

      expect(space.defaultPrevented).toBe(true);
      expect(keyboardDrag.isActive()).toBe(true);
      expect(component.dragStartEvents.length).toBe(1);
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

    it('should destroy cleanly before its first change detection', () => {
      const unrendered = TestBed.createComponent(TestHostComponent);

      expect(() => unrendered.destroy()).not.toThrow();
    });

    it('should destroy cleanly before its first change detection with a bound ID', () => {
      const unrendered = TestBed.createComponent(BoundIdHostComponent);

      expect(() => unrendered.destroy()).not.toThrow();
    });
  });

  describe('subclassing', () => {
    it('should run the draggable setup for a subclass that extends ngOnInit', () => {
      const extended = TestBed.createComponent(ExtendedDraggableHostComponent);
      extended.detectChanges();
      const extendedEl = extended.debugElement.query(By.directive(ExtendedDraggableDirective));

      expect(extendedEl.injector.get(ExtendedDraggableDirective).setUp).toBe(true);
      // The draggable's own setup ran as well: Space picks the item up
      extendedEl.nativeElement.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
      );
      expect(TestBed.inject(KeyboardDragService).isActive()).toBe(true);

      extended.destroy();
    });
  });
});
