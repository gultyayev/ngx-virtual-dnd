import {
  Component,
  DebugElement,
  Directive,
  ErrorHandler,
  NgZone,
  OnInit,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DraggableDirective } from './draggable.directive';
import { DroppableDirective } from './droppable.directive';
import { ScrollableDirective } from './scrollable.directive';
import { VirtualViewportComponent } from '../components/virtual-viewport.component';
import { DragStateService } from '../services/drag-state.service';
import { PositionCalculatorService } from '../services/position-calculator.service';
import { AutoScrollService } from '../services/auto-scroll.service';
import { ElementCloneService } from '../services/element-clone.service';
import { KeyboardDragService } from '../services/keyboard-drag.service';
import { DragStartEvent, DragEndEvent, DropEvent } from '../models/drag-drop.models';

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
      (drop)="onDrop($event)"
    >
      <div data-draggable-id="preceding-item-1"></div>
      <div data-draggable-id="preceding-item-2"></div>
      <div
        [vdndDraggable]="draggableId()"
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
        (keydown)="keysSeenPrevented.push($event.defaultPrevented)"
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
  draggableId = signal('test-item');
  itemData = { id: 1, name: 'Test Item' };
  disabled = signal(false);
  dragHandle = signal<string | undefined>(undefined);
  dragThreshold = signal(5);
  dragDelay = signal(0);
  lockAxis = signal<'x' | 'y' | null>(null);

  dragStartEvents: DragStartEvent[] = [];
  dragEndEvents: DragEndEvent[] = [];
  dropEvents: DropEvent[] = [];
  /** `defaultPrevented` of each key event a (keydown) listener of the consumer saw on the item */
  keysSeenPrevented: boolean[] = [];
  /** Order in which the end-of-drag outputs fired */
  endOutputs: string[] = [];

  onDragStart(event: DragStartEvent): void {
    this.dragStartEvents.push(event);
  }

  onDragEnd(event: DragEndEvent): void {
    this.dragEndEvents.push(event);
    this.endOutputs.push('dragEnd');
  }

  onDrop(event: DropEvent): void {
    this.dropEvents.push(event);
    this.endOutputs.push('drop');
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

// A plain list whose draggables are each wrapped in a row element, one row holding a nested list
@Component({
  template: `
    <div
      vdndDroppable="wrapped-list"
      vdndDroppableGroup="test-group"
      (drop)="dropEvents.push($event)"
    >
      <div>
        <div vdndDraggable="one" vdndDraggableGroup="test-group">
          One
          <div vdndDroppable="nested-list" vdndDroppableGroup="test-group">
            <div><div vdndDraggable="nested-a" vdndDraggableGroup="test-group"></div></div>
            <div><div vdndDraggable="nested-b" vdndDraggableGroup="test-group"></div></div>
          </div>
        </div>
      </div>
      <div><div vdndDraggable="two" vdndDraggableGroup="test-group">Two</div></div>
      <div>
        <div
          vdndDraggable="three"
          vdndDraggableGroup="test-group"
          (dragStart)="dragStartEvents.push($event)"
        >
          Three
        </div>
      </div>
    </div>
  `,
  imports: [DroppableDirective, DraggableDirective],
})
class WrappedRowsHostComponent {
  dragStartEvents: DragStartEvent[] = [];
  dropEvents: DropEvent[] = [];
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

// A consumer directive that overrides a key handler
@Directive({ selector: '[vdndTestKeyOverridingDraggable]' })
class KeyOverridingDraggableDirective extends DraggableDirective {
  failure: Error | null = null;

  protected override onEnterKey(): boolean {
    return false;
  }

  protected override onKeyboardActivate(event: Event): void {
    if (this.failure) {
      throw this.failure;
    }
    super.onKeyboardActivate(event);
  }
}

@Component({
  template: `
    <div vdndDroppable="overriding-list" vdndDroppableGroup="test-group">
      <div
        vdndTestKeyOverridingDraggable
        vdndDraggable="overriding-item"
        vdndDraggableGroup="test-group"
      ></div>
    </div>
  `,
  imports: [KeyOverridingDraggableDirective, DroppableDirective],
})
class KeyOverridingHostComponent {}

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

// A consumer directive that overrides the pointer press handler
@Directive({ selector: '[vdndTestPressOverridingDraggable]' })
class PressOverridingDraggableDirective extends DraggableDirective {
  failure: Error | null = null;

  protected override onPointerDown(event: MouseEvent | TouchEvent, isTouch: boolean): void {
    if (this.failure) {
      throw this.failure;
    }
    super.onPointerDown(event, isTouch);
  }
}

@Component({
  template: `
    <div
      vdndTestPressOverridingDraggable
      vdndDraggable="press-overriding-item"
      vdndDraggableGroup="test-group"
    ></div>
  `,
  imports: [PressOverridingDraggableDirective],
})
class PressOverridingHostComponent {}

// Draggables that are themselves controls
@Component({
  template: `
    <div vdndDroppable="control-list" vdndDroppableGroup="test-group">
      <button type="button" vdndDraggable="button-item" vdndDraggableGroup="test-group">
        <span class="label">Button item</span>
      </button>
      <input type="text" vdndDraggable="input-item" vdndDraggableGroup="test-group" />
      <textarea vdndDraggable="textarea-item" vdndDraggableGroup="test-group"></textarea>
      <select vdndDraggable="select-item" vdndDraggableGroup="test-group">
        <option>One</option>
      </select>
      <div contenteditable="true" vdndDraggable="editable-item" vdndDraggableGroup="test-group">
        <span class="text">Editable item</span>
      </div>
      <!-- A block that is its own editing host, with a non-editable grip -->
      <div
        contenteditable="true"
        vdndDraggable="editable-handle-item"
        vdndDraggableGroup="test-group"
        dragHandle=".grip"
      >
        <span class="grip" contenteditable="false" tabindex="0">::</span>
        <span class="text">Editable block</span>
      </div>
      <!-- An editable block whose handle selector matches the block itself -->
      <div
        contenteditable="true"
        class="blk"
        vdndDraggable="self-handle-item"
        vdndDraggableGroup="test-group"
        dragHandle=".blk"
      >
        <span class="text">Self-handle block</span>
      </div>
      @for (type of buttonLikeInputTypes; track type) {
        <input
          [type]="type"
          [vdndDraggable]="type + '-input-item'"
          vdndDraggableGroup="test-group"
        />
      }
      <input type="checkbox" vdndDraggable="checkbox-item" vdndDraggableGroup="test-group" />
    </div>
  `,
  imports: [DraggableDirective, DroppableDirective],
})
class ControlDraggablesHostComponent {
  readonly buttonLikeInputTypes = ['button', 'submit', 'reset', 'image'];
}

// A draggable rendered with a drag delay from the start, as lists that scroll by touch are
@Component({
  template: `<div
    vdndDraggable="delayed-item"
    vdndDraggableGroup="test-group"
    [dragDelay]="300"
  ></div>`,
  imports: [DraggableDirective],
})
class DelayedHostComponent {}

// A constrained list inside an open shadow root, scrolled by a `.vdnd-scrollable` outside it
@Component({
  selector: 'vdnd-test-shadow-list',
  encapsulation: ViewEncapsulation.ShadowDom,
  template: `
    <div vdndDroppable="shadow-list" vdndDroppableGroup="test-group" [constrainToContainer]="true">
      <div
        vdndDraggable="shadow-item"
        vdndDraggableGroup="test-group"
        style="height: 50px; width: 200px;"
      ></div>
    </div>
  `,
  imports: [DraggableDirective, DroppableDirective],
})
class ShadowListComponent {}

@Component({
  template: `<div class="vdnd-scrollable"><vdnd-test-shadow-list /></div>`,
  imports: [ShadowListComponent],
})
class ShadowListHostComponent {}

// A constrained list in a `vdndScrollable` whose top and bottom sticky content covers
@Component({
  template: `
    <div vdndScrollable [scrollInsetTop]="insetTop()" [scrollInsetBottom]="40">
      <div vdndDroppable="inset-list" vdndDroppableGroup="test-group" [constrainToContainer]="true">
        <div vdndDraggable="inset-item" vdndDraggableGroup="test-group"></div>
      </div>
    </div>
  `,
  imports: [ScrollableDirective, DroppableDirective, DraggableDirective],
})
class InsetScrollableHostComponent {
  readonly insetTop = signal(60);
}

// A draggable an `@if` inside its list removes, while the list itself stays
@Component({
  template: `
    <div vdndDroppable="surviving-list" vdndDroppableGroup="test-group">
      @if (show()) {
        <div
          vdndDraggable="conditional-item"
          vdndDraggableGroup="test-group"
          (dragStart)="dragStartEvents.push($event)"
          (dragEnd)="dragEndEvents.push($event)"
        ></div>
      }
    </div>
  `,
  imports: [DraggableDirective, DroppableDirective],
})
class ConditionalDraggableHostComponent {
  show = signal(true);
  dragStartEvents: DragStartEvent[] = [];
  dragEndEvents: DragEndEvent[] = [];
}

/** Whether `addEventListener` options make the listener passive */
function isPassive(options: boolean | AddEventListenerOptions | undefined): boolean {
  return typeof options === 'object' && options.passive === true;
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

    it('should not mark a mouse drag as a touch drag', () => {
      attemptPointerDrag(draggableNative);
      fixture.detectChanges();

      expect(document.body.classList.contains('vdnd-dragging')).toBe(true);
      expect(document.body.classList.contains('vdnd-dragging-touch')).toBe(false);
    });

    it('should not start drag when pressing inside an editable element in the row', () => {
      const editable = draggableNative.querySelector('.content') as HTMLElement;
      editable.setAttribute('contenteditable', 'true');

      attemptPointerDrag(editable);

      expect(dragStateService.isDragging()).toBe(false);
    });

    it('should start a drag when pressing a contenteditable="false" element in the row', () => {
      const notEditable = draggableNative.querySelector('.content') as HTMLElement;
      notEditable.setAttribute('contenteditable', 'false');

      attemptPointerDrag(notEditable);

      expect(dragStateService.isDragging()).toBe(true);
    });

    it('should start a drag inside a draggable that sits in a contenteditable element', () => {
      // Draggable blocks in a rich-text editor
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      draggableNative.parentElement!.insertBefore(editor, draggableNative);
      editor.appendChild(draggableNative);

      attemptPointerDrag(draggableNative.querySelector('.content')!);

      expect(dragStateService.isDragging()).toBe(true);
      expect(component.dragStartEvents.length).toBe(1);
    });

    it('should start a drag inside a draggable that sits in a button', () => {
      const outer = document.createElement('button');
      draggableNative.parentElement!.insertBefore(outer, draggableNative);
      outer.appendChild(draggableNative);

      attemptPointerDrag(draggableNative.querySelector('.content')!);

      expect(dragStateService.isDragging()).toBe(true);
    });

    it('should start a drag when pressing a contenteditable="FALSE" element in the row', () => {
      // Browsers read the attribute value case-insensitively
      const notEditable = draggableNative.querySelector('.content') as HTMLElement;
      notEditable.setAttribute('contenteditable', 'FALSE');

      attemptPointerDrag(notEditable);

      expect(dragStateService.isDragging()).toBe(true);
    });

    describe('on draggables that are controls', () => {
      let controlsFixture: ComponentFixture<ControlDraggablesHostComponent>;
      let buttonItem: HTMLButtonElement;

      const item = (id: string): HTMLElement =>
        controlsFixture.nativeElement.querySelector(`[data-draggable-id="${id}"]`);

      beforeEach(() => {
        controlsFixture = TestBed.createComponent(ControlDraggablesHostComponent);
        controlsFixture.detectChanges();
        buttonItem = item('button-item') as HTMLButtonElement;
      });

      afterEach(() => {
        dragStateService.endDrag();
        controlsFixture.destroy();
      });

      // A press on a text field, a select or an editable element focuses it, opens it or places
      // the caret: it keeps doing that instead of starting a drag
      it.each(['input-item', 'textarea-item', 'select-item', 'editable-item', 'checkbox-item'])(
        'should not start a pointer drag or prevent the press on %s',
        (id) => {
          const mousedown = new MouseEvent('mousedown', {
            clientX: 100,
            clientY: 100,
            button: 0,
            bubbles: true,
            cancelable: true,
          });
          item(id).dispatchEvent(mousedown);
          document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 120 }));

          expect(mousedown.defaultPrevented).toBe(false);
          expect(dragStateService.isDragging()).toBe(false);
        },
      );

      it('should not start a pointer drag from text inside an editable draggable', () => {
        attemptPointerDrag(item('editable-item').querySelector('.text')!);

        expect(dragStateService.isDragging()).toBe(false);
      });

      it.each(['button', 'submit', 'reset', 'image'])(
        'should start a pointer drag on an input of type %s, like a button',
        (type) => {
          attemptPointerDrag(item(`${type}-input-item`));

          expect(dragStateService.isDragging()).toBe(true);
          expect(dragStateService.draggedItemId()).toBe(`${type}-input-item`);
        },
      );

      it('should keep the press on an editable draggable whose handle selector matches itself', () => {
        // The draggable is not a handle inside itself: its text stays editable with the mouse
        const mousedown = new MouseEvent('mousedown', {
          clientX: 100,
          clientY: 100,
          button: 0,
          bubbles: true,
          cancelable: true,
        });
        item('self-handle-item').querySelector('.text')!.dispatchEvent(mousedown);
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 120 }));

        expect(mousedown.defaultPrevented).toBe(false);
        expect(dragStateService.isDragging()).toBe(false);
      });

      describe('with Space', () => {
        const pressSpace = (target: Element): KeyboardEvent => {
          const space = new KeyboardEvent('keydown', {
            key: ' ',
            code: 'Space',
            bubbles: true,
            cancelable: true,
          });
          target.dispatchEvent(space);
          return space;
        };

        // Space types a space (or toggles, or opens) in a draggable that takes text or a choice
        it.each(['input-item', 'textarea-item', 'select-item', 'editable-item', 'checkbox-item'])(
          'should let Space reach %s instead of starting a keyboard drag',
          (id) => {
            const space = pressSpace(item(id));

            expect(space.defaultPrevented).toBe(false);
            expect(TestBed.inject(KeyboardDragService).isActive()).toBe(false);
            expect(dragStateService.isDragging()).toBe(false);
          },
        );

        it('should let Space reach the text of an editable draggable with a drag handle', () => {
          const space = pressSpace(item('editable-handle-item').querySelector('.text')!);

          expect(space.defaultPrevented).toBe(false);
          expect(TestBed.inject(KeyboardDragService).isActive()).toBe(false);
        });

        it('should let Space reach an editable draggable whose handle selector matches itself', () => {
          const space = pressSpace(item('self-handle-item'));

          expect(space.defaultPrevented).toBe(false);
          expect(TestBed.inject(KeyboardDragService).isActive()).toBe(false);
        });

        it('should pick an editable draggable up with Space on its focusable drag handle', () => {
          const space = pressSpace(item('editable-handle-item').querySelector('.grip')!);

          expect(space.defaultPrevented).toBe(true);
          expect(TestBed.inject(KeyboardDragService).isActive()).toBe(true);
          expect(dragStateService.draggedItemId()).toBe('editable-handle-item');
        });

        it.each(['button-item', 'button-input-item', 'submit-input-item'])(
          'should pick %s up with Space',
          (id) => {
            const space = pressSpace(item(id));

            expect(space.defaultPrevented).toBe(true);
            expect(TestBed.inject(KeyboardDragService).isActive()).toBe(true);
            expect(dragStateService.draggedItemId()).toBe(id);
          },
        );
      });

      describe('on an editable draggable with a drag handle', () => {
        it('should start a pointer drag from the handle', () => {
          attemptPointerDrag(item('editable-handle-item').querySelector('.grip')!);

          expect(dragStateService.isDragging()).toBe(true);
          expect(dragStateService.draggedItemId()).toBe('editable-handle-item');
        });

        it('should keep the press on its text for the caret', () => {
          const mousedown = new MouseEvent('mousedown', {
            clientX: 100,
            clientY: 100,
            button: 0,
            bubbles: true,
            cancelable: true,
          });
          item('editable-handle-item').querySelector('.text')!.dispatchEvent(mousedown);
          document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 120 }));

          expect(mousedown.defaultPrevented).toBe(false);
          expect(dragStateService.isDragging()).toBe(false);
        });
      });

      it('should start a pointer drag when pressing the button', () => {
        attemptPointerDrag(buttonItem);

        expect(dragStateService.isDragging()).toBe(true);
        expect(dragStateService.draggedItemId()).toBe('button-item');
      });

      it('should start a pointer drag when pressing content inside the button', () => {
        attemptPointerDrag(buttonItem.querySelector('.label')!);

        expect(dragStateService.isDragging()).toBe(true);
        expect(dragStateService.draggedItemId()).toBe('button-item');
      });

      it('should pick the item up with Space on the button', () => {
        const space = new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          bubbles: true,
          cancelable: true,
        });
        buttonItem.dispatchEvent(space);

        expect(space.defaultPrevented).toBe(true);
        expect(TestBed.inject(KeyboardDragService).isActive()).toBe(true);
      });
    });
  });

  describe('touchstart listener', () => {
    // A swipe that starts on a row with a non-passive touchstart listener can't scroll until the
    // main thread has run the listener. With a drag delay the press never cancels the scroll, so
    // the listener must be passive; without one it must stay able to cancel it.
    const touchStart = (): TouchEvent => {
      const touch = { clientX: 100, clientY: 100 } as Touch;
      return new TouchEvent('touchstart', {
        touches: [touch],
        changedTouches: [touch],
        bubbles: true,
        cancelable: true,
      });
    };

    interface Registration {
      element: unknown;
      listener: unknown;
      passive: boolean;
    }

    /** The touchstart listeners added to and removed from elements while `run` runs */
    function recordTouchStartListeners(run: () => void): {
      added: Registration[];
      removed: Omit<Registration, 'passive'>[];
    } {
      const add = jest.spyOn(HTMLElement.prototype, 'addEventListener');
      const remove = jest.spyOn(HTMLElement.prototype, 'removeEventListener');
      try {
        run();
        return {
          added: add.mock.calls
            .map(([type, listener, options], call) => ({
              type,
              element: add.mock.contexts[call],
              listener,
              passive: isPassive(options),
            }))
            .filter(({ type }) => type === 'touchstart')
            .map(({ element, listener, passive }) => ({ element, listener, passive })),
          removed: remove.mock.calls
            .map(([type, listener], call) => ({
              type,
              element: remove.mock.contexts[call],
              listener,
            }))
            .filter(({ type }) => type === 'touchstart')
            .map(({ element, listener }) => ({ element, listener })),
        };
      } finally {
        add.mockRestore();
        remove.mockRestore();
      }
    }

    it('should listen passively on an item rendered with a drag delay', () => {
      let delayed!: ComponentFixture<DelayedHostComponent>;
      const { added } = recordTouchStartListeners(() => {
        delayed = TestBed.createComponent(DelayedHostComponent);
        delayed.detectChanges();
      });
      const item = delayed.debugElement.query(By.directive(DraggableDirective)).nativeElement;

      const onItem = added.filter(({ element }) => element === item);
      expect(onItem.map(({ passive }) => passive)).toEqual([true]);
      delayed.destroy();
    });

    it('should listen on an item without a drag delay with a listener that can cancel the scroll', () => {
      let other!: ComponentFixture<BoundIdHostComponent>;
      const { added } = recordTouchStartListeners(() => {
        other = TestBed.createComponent(BoundIdHostComponent);
        other.detectChanges();
      });
      const item = other.debugElement.query(By.directive(DraggableDirective)).nativeElement;

      const onItem = added.filter(({ element }) => element === item);
      expect(onItem.map(({ passive }) => passive)).toEqual([false]);
      other.destroy();
    });

    it('should switch to a passive listener when a drag delay is set', () => {
      const { added, removed } = recordTouchStartListeners(() => {
        component.dragDelay.set(300);
        fixture.detectChanges();
      });

      expect(added.filter(({ element }) => element === draggableNative)).toEqual([
        expect.objectContaining({ passive: true }),
      ]);
      // The listener that could cancel the scroll is gone
      expect(removed.filter(({ element }) => element === draggableNative).length).toBe(1);
    });

    it('should keep its listener while the delay changes but stays above zero', () => {
      component.dragDelay.set(300);
      fixture.detectChanges();

      const { added, removed } = recordTouchStartListeners(() => {
        component.dragDelay.set(500);
        fixture.detectChanges();
      });

      expect(added).toEqual([]);
      expect(removed).toEqual([]);
    });

    it('should not let a touch press without a drag delay scroll the page', () => {
      const press = touchStart();
      draggableNative.dispatchEvent(press);

      expect(press.defaultPrevented).toBe(true);
    });

    it('should again stop the page scrolling when the drag delay is removed', () => {
      component.dragDelay.set(300);
      fixture.detectChanges();
      component.dragDelay.set(0);
      fixture.detectChanges();

      const press = touchStart();
      draggableNative.dispatchEvent(press);

      expect(press.defaultPrevented).toBe(true);
    });

    it('should leave a touch press with a drag delay free to scroll the page', () => {
      component.dragDelay.set(300);
      fixture.detectChanges();

      const press = touchStart();
      draggableNative.dispatchEvent(press);

      expect(press.defaultPrevented).toBe(false);
    });

    it('should start a touch drag once the delay has passed', () => {
      component.dragDelay.set(100);
      fixture.detectChanges();
      jest.useFakeTimers();
      try {
        draggableNative.dispatchEvent(touchStart());
        jest.advanceTimersByTime(100);
        fixture.detectChanges();
        expect(draggableNative.classList.contains('vdnd-drag-pending')).toBe(true);

        const touch = { clientX: 100, clientY: 120 } as Touch;
        const move = new TouchEvent('touchmove', {
          touches: [touch],
          changedTouches: [touch],
          bubbles: true,
          cancelable: true,
        });
        document.dispatchEvent(move);

        expect(dragStateService.isDragging()).toBe(true);
        expect(move.defaultPrevented).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should mark a touch drag on the body, which shows no grabbing cursor', () => {
      component.dragDelay.set(0);
      fixture.detectChanges();

      draggableNative.dispatchEvent(touchStart());
      const touch = { clientX: 100, clientY: 120 } as Touch;
      document.dispatchEvent(
        new TouchEvent('touchmove', {
          touches: [touch],
          changedTouches: [touch],
          bubbles: true,
          cancelable: true,
        }),
      );
      fixture.detectChanges();

      expect(dragStateService.isDragging()).toBe(true);
      expect(document.body.classList.contains('vdnd-dragging')).toBe(true);
      expect(document.body.classList.contains('vdnd-dragging-touch')).toBe(true);
    });

    it('should listen passively with a negative delay, which never cancels the scroll', () => {
      const { added } = recordTouchStartListeners(() => {
        component.dragDelay.set(-1);
        fixture.detectChanges();
      });

      expect(added.filter(({ element }) => element === draggableNative)).toEqual([
        expect.objectContaining({ passive: true }),
      ]);
      const press = touchStart();
      draggableNative.dispatchEvent(press);
      expect(press.defaultPrevented).toBe(false);
    });

    it('should report an error thrown by an overridden press handler to the ErrorHandler', () => {
      const handleError = jest
        .spyOn(TestBed.inject(ErrorHandler), 'handleError')
        .mockImplementation(() => {
          // Recorded below
        });
      const overriding = TestBed.createComponent(PressOverridingHostComponent);
      overriding.detectChanges();
      const debugItem = overriding.debugElement.query(
        By.directive(PressOverridingDraggableDirective),
      );
      const failure = new Error('press handler failed');
      debugItem.injector.get(PressOverridingDraggableDirective).failure = failure;

      debugItem.nativeElement.dispatchEvent(touchStart());

      expect(handleError).toHaveBeenCalledWith(failure);
      overriding.destroy();
    });

    it('should remove its listener when destroyed', () => {
      const { added } = recordTouchStartListeners(() => {
        component.dragDelay.set(300);
        fixture.detectChanges();
      });
      const listener = added.find(({ element }) => element === draggableNative)?.listener;
      expect(listener).toBeDefined();

      const { removed } = recordTouchStartListeners(() => fixture.destroy());

      expect(removed).toContainEqual({ element: draggableNative, listener });
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

    it('should not turn the whole row into a handle when an ancestor matches the selector', () => {
      const outer = document.createElement('div');
      outer.className = 'handle';
      draggableNative.parentElement!.insertBefore(outer, draggableNative);
      outer.appendChild(draggableNative);

      attemptPointerDrag(draggableNative.querySelector('.content')!);

      expect(dragStateService.isDragging()).toBe(false);
    });

    it('should still start drag from the handle inside a row whose ancestor matches the selector', () => {
      const outer = document.createElement('div');
      outer.className = 'handle';
      draggableNative.parentElement!.insertBefore(outer, draggableNative);
      outer.appendChild(draggableNative);

      attemptPointerDrag(draggableNative.querySelector('.handle')!);

      expect(dragStateService.isDragging()).toBe(true);
    });

    it('should not start drag when pressing a button that is the handle', () => {
      // Documented: presses inside buttons never start a drag, the handle included
      component.dragHandle.set('button');
      fixture.detectChanges();

      attemptPointerDrag(draggableNative.querySelector('button')!);

      expect(dragStateService.isDragging()).toBe(false);
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

    describe('with each item wrapped in a row element', () => {
      let wrappedHost: ComponentFixture<WrappedRowsHostComponent>;
      let list: HTMLElement;
      let third: HTMLElement;

      beforeEach(() => {
        wrappedHost = TestBed.createComponent(WrappedRowsHostComponent);
        wrappedHost.detectChanges();
        list = wrappedHost.nativeElement.querySelector('[data-droppable-id="wrapped-list"]');
        third = wrappedHost.nativeElement.querySelector('[data-draggable-id="three"]');
      });

      afterEach(() => {
        wrappedHost.destroy();
      });

      it('should count the items of the list, not of a nested list, on pointer pickup', () => {
        mockRect(third, 140, 50);
        mockRect(list, 0, 400);
        jest
          .spyOn(TestBed.inject(PositionCalculatorService), 'findDroppableAtPoint')
          .mockReturnValue(list);

        startPointerDrag({ x: 100, y: 155 }, third);

        expect(wrappedHost.componentInstance.dragStartEvents[0].sourceIndex).toBe(2);
      });

      it('should report the logical source and destination on a keyboard drop', () => {
        third.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: ' ',
            code: 'Space',
            bubbles: true,
            cancelable: true,
          }),
        );
        wrappedHost.detectChanges();
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
        );
        wrappedHost.detectChanges();
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        );

        const { dragStartEvents, dropEvents } = wrappedHost.componentInstance;
        expect({
          dragStartSource: dragStartEvents[0]?.sourceIndex,
          dropSource: dropEvents[0]?.source.index,
          dropDestination: dropEvents[0]?.destination.index,
        }).toEqual({ dragStartSource: 2, dropSource: 2, dropDestination: 1 });
      });
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

    it('should pick the item up with Space on a contenteditable="false" element in the row', () => {
      const keyboardDrag = TestBed.inject(KeyboardDragService);
      const notEditable = draggableNative.querySelector('.content') as HTMLElement;
      notEditable.setAttribute('contenteditable', 'false');
      notEditable.tabIndex = 0;
      const space = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      notEditable.dispatchEvent(space);

      expect(space.defaultPrevented).toBe(true);
      expect(keyboardDrag.isActive()).toBe(true);
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

    it('should listen for keydown on the item once', () => {
      const addEventListener = jest.spyOn(HTMLElement.prototype, 'addEventListener');
      // An item without keydown listeners of its own
      const other = TestBed.createComponent(BoundIdHostComponent);
      other.detectChanges();
      const item = other.debugElement.query(By.directive(DraggableDirective)).nativeElement;

      const keydownListeners = addEventListener.mock.calls.filter(
        ([type], call) => type === 'keydown' && addEventListener.mock.contexts[call] === item,
      );
      expect(keydownListeners.length).toBe(1);
      addEventListener.mockRestore();
      other.destroy();
    });

    it("should handle a key before the consumer's own keydown listener on the item", () => {
      draggableNative.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
      );

      // The item was picked up, and the consumer's listener saw that
      expect(TestBed.inject(KeyboardDragService).isActive()).toBe(true);
      expect(component.keysSeenPrevented).toEqual([true]);
    });

    it('should prevent the default action of a key whose handler returns false', () => {
      const overriding = TestBed.createComponent(KeyOverridingHostComponent);
      overriding.detectChanges();
      const item = overriding.debugElement.query(
        By.directive(KeyOverridingDraggableDirective),
      ).nativeElement;

      const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      item.dispatchEvent(enter);

      expect(enter.defaultPrevented).toBe(true);
      overriding.destroy();
    });

    it('should report an error thrown by a key handler to the ErrorHandler', () => {
      const errorHandler = TestBed.inject(ErrorHandler);
      const handleError = jest.spyOn(errorHandler, 'handleError').mockImplementation(() => {
        // Recorded below
      });
      const overriding = TestBed.createComponent(KeyOverridingHostComponent);
      overriding.detectChanges();
      const debugItem = overriding.debugElement.query(
        By.directive(KeyOverridingDraggableDirective),
      );
      const failure = new Error('handler failed');
      debugItem.injector.get(KeyOverridingDraggableDirective).failure = failure;

      debugItem.nativeElement.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', cancelable: true }),
      );

      expect(handleError).toHaveBeenCalledWith(failure);
      overriding.destroy();
    });

    it('should not pick the item up with Space while a modifier key is held', () => {
      const keyboardDrag = TestBed.inject(KeyboardDragService);

      for (const modifier of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey']) {
        const space = new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          [modifier]: true,
          bubbles: true,
          cancelable: true,
        });
        draggableNative.dispatchEvent(space);

        expect(space.defaultPrevented).toBe(false);
      }
      expect(keyboardDrag.isActive()).toBe(false);
      expect(component.dragStartEvents).toEqual([]);
    });

    it('should not cancel a drag with Escape while a modifier key is held', () => {
      attemptPointerDrag(draggableNative);

      draggableNative.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true, cancelable: true }),
      );

      expect(dragStateService.isDragging()).toBe(true);
    });

    it('should cancel a drag with the legacy Esc key name', () => {
      attemptPointerDrag(draggableNative);

      const escape = new KeyboardEvent('keydown', { key: 'Esc', cancelable: true });
      draggableNative.dispatchEvent(escape);

      expect(dragStateService.isDragging()).toBe(false);
      expect(escape.defaultPrevented).toBe(true);
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

    it("emits dragEnd, then the target list's drop, in the keypress that drops", () => {
      draggableNative.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();
      expect(dragStateService.isDragging()).toBe(true);

      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );

      expect(component.endOutputs).toEqual(['dragEnd', 'drop']);
      expect(component.dropEvents[0]).toEqual(
        expect.objectContaining({
          source: expect.objectContaining({ draggableId: 'test-item', droppableId: 'test-list' }),
          destination: expect.objectContaining({
            droppableId: 'test-list',
            index: component.dragEndEvents[0].destinationIndex,
          }),
        }),
      );
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

  describe('when the item changes to another one during a press (a recycled row)', () => {
    const press = (): void => {
      draggableNative.dispatchEvent(
        new MouseEvent('mousedown', {
          clientX: 100,
          clientY: 100,
          button: 0,
          bubbles: true,
          cancelable: true,
        }),
      );
    };

    it('should not drag the other item', () => {
      press();
      component.draggableId.set('other-item');
      fixture.detectChanges();

      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 120 }));

      expect(dragStateService.isDragging()).toBe(false);
      expect(component.dragStartEvents).toEqual([]);
    });

    it('should not show the other item as ready to drag', () => {
      component.dragDelay.set(100);
      fixture.detectChanges();
      jest.useFakeTimers();
      try {
        press();
        component.draggableId.set('other-item');
        fixture.detectChanges();

        jest.advanceTimersByTime(100);
        fixture.detectChanges();

        expect(draggableNative.classList.contains('vdnd-drag-pending')).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should stop showing the item as ready to drag when it changes to another one', () => {
      component.dragDelay.set(100);
      fixture.detectChanges();
      jest.useFakeTimers();
      try {
        press();
        jest.advanceTimersByTime(100);
        fixture.detectChanges();
        expect(draggableNative.classList.contains('vdnd-drag-pending')).toBe(true);

        component.draggableId.set('other-item');
        fixture.detectChanges();

        expect(draggableNative.classList.contains('vdnd-drag-pending')).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should still drag an item pressed again after the change', () => {
      press();
      component.draggableId.set('other-item');
      fixture.detectChanges();
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 120 }));
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 120 }));

      attemptPointerDrag(draggableNative);

      expect(dragStateService.draggedItem()?.draggableId).toBe('other-item');
    });
  });

  describe('outputs inside the Angular zone', () => {
    // The pointer and keyboard listeners run outside Angular's zone. With zone.js, a template
    // listener marks its view dirty but schedules no render, so the outputs must be emitted
    // inside the zone for the consumer's handler to render.
    let emittedInZone: string[];

    beforeEach(() => {
      const zone = TestBed.inject(NgZone);
      const run = zone.run.bind(zone);
      let insideRun = false;
      jest.spyOn(zone, 'run').mockImplementation(<T>(fn: () => T): T => {
        const wasInside = insideRun;
        insideRun = true;
        try {
          return run(fn);
        } finally {
          insideRun = wasInside;
        }
      });
      emittedInZone = [];
      const draggable = fixture.debugElement
        .query(By.directive(DraggableDirective))
        .injector.get(DraggableDirective);
      draggable.dragStart.subscribe(() => emittedInZone.push(`dragStart:${insideRun}`));
      draggable.dragEnd.subscribe(() => emittedInZone.push(`dragEnd:${insideRun}`));
    });

    it('emits dragStart and dragEnd of a pointer drag inside the zone', () => {
      attemptPointerDrag(draggableNative);
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 120 }));

      expect(emittedInZone).toEqual(['dragStart:true', 'dragEnd:true']);
    });

    it('emits dragStart and dragEnd of a keyboard drop inside the zone', () => {
      draggableNative.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );

      expect(emittedInZone).toEqual(['dragStart:true', 'dragEnd:true']);
    });

    it('emits dragEnd of a cancelled keyboard drag inside the zone', () => {
      draggableNative.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );

      expect(emittedInZone.at(-1)).toBe('dragEnd:true');
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

    it('should report the source list as droppableId when only the dragged item is destroyed mid-drag', () => {
      const conditional = TestBed.createComponent(ConditionalDraggableHostComponent);
      conditional.detectChanges();
      const item = conditional.nativeElement.querySelector(
        '[data-draggable-id="conditional-item"]',
      ) as HTMLElement;

      attemptPointerDrag(item);
      expect(dragStateService.sourceDroppableId()).toBe('surviving-list');

      conditional.componentInstance.show.set(false);
      conditional.detectChanges();

      const ends = conditional.componentInstance.dragEndEvents;
      expect(dragStateService.isDragging()).toBe(false);
      expect(ends.length).toBe(1);
      expect(ends[0].cancelled).toBe(true);
      expect(ends[0].droppableId).toBe('surviving-list');
      expect(ends[0].droppableId).toBe(
        conditional.componentInstance.dragStartEvents[0].droppableId,
      );

      conditional.destroy();
    });

    it('should report the source list as droppableId when only the keyboard-dragged item is destroyed', () => {
      const conditional = TestBed.createComponent(ConditionalDraggableHostComponent);
      conditional.detectChanges();
      const item = conditional.nativeElement.querySelector(
        '[data-draggable-id="conditional-item"]',
      ) as HTMLElement;
      const keyboardDrag = TestBed.inject(KeyboardDragService);

      item.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
      );
      expect(keyboardDrag.isActive()).toBe(true);
      expect(dragStateService.sourceDroppableId()).toBe('surviving-list');

      conditional.componentInstance.show.set(false);
      conditional.detectChanges();

      const ends = conditional.componentInstance.dragEndEvents;
      expect(dragStateService.isDragging()).toBe(false);
      expect(keyboardDrag.isActive()).toBe(false);
      expect(ends.length).toBe(1);
      expect(ends[0].cancelled).toBe(true);
      expect(ends[0].droppableId).toBe('surviving-list');

      conditional.destroy();
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

  describe('inside an open shadow root', () => {
    /** A rect at the top left of the page */
    const rect = (right: number, bottom: number): DOMRect =>
      ({ top: 0, left: 0, right, bottom, width: right, height: bottom, x: 0, y: 0 }) as DOMRect;

    it('should constrain the drag to a scrollable container outside the shadow root', () => {
      const shadowFixture = TestBed.createComponent(ShadowListHostComponent);
      shadowFixture.detectChanges();
      const host: HTMLElement = shadowFixture.nativeElement;
      const scrollable = host.querySelector<HTMLElement>('.vdnd-scrollable')!;
      const shadowRoot = host.querySelector('vdnd-test-shadow-list')!.shadowRoot!;
      const list = shadowRoot.querySelector<HTMLElement>('[data-droppable-id]')!;
      const item = shadowRoot.querySelector<HTMLElement>('[data-draggable-id]')!;
      // The list is taller than the scrollable viewport that shows it
      scrollable.getBoundingClientRect = () => rect(300, 300);
      list.getBoundingClientRect = () => rect(300, 2000);
      const cursorOverride = jest.spyOn(TestBed.inject(AutoScrollService), 'setCursorOverride');

      attemptPointerDrag(item);
      expect(dragStateService.isDragging()).toBe(true);
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 1000 }));
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 1000 }));

      // Clamped to the scrollable's bottom (300), not the list's (2000)
      expect(cursorOverride).toHaveBeenLastCalledWith({ x: 100, y: 300 });
      shadowFixture.destroy();
    });
  });

  describe('in a scrollable with scroll insets', () => {
    /** A rect at the top left of the page */
    const rect = (top: number, right: number, bottom: number): DOMRect =>
      ({
        top,
        left: 0,
        right,
        bottom,
        width: right,
        height: bottom - top,
        x: 0,
        y: top,
      }) as DOMRect;

    let insetFixture: ComponentFixture<InsetScrollableHostComponent>;
    let item: HTMLElement;

    beforeEach(() => {
      insetFixture = TestBed.createComponent(InsetScrollableHostComponent);
      insetFixture.detectChanges();
      const host: HTMLElement = insetFixture.nativeElement;
      // A 300px tall viewport (60px covered at its top, 40px at its bottom) on a taller list
      host.querySelector<HTMLElement>('.vdnd-scrollable')!.getBoundingClientRect = () =>
        rect(0, 300, 300);
      host.querySelector<HTMLElement>('[data-droppable-id]')!.getBoundingClientRect = () =>
        rect(0, 300, 2000);
      item = host.querySelector<HTMLElement>('[data-draggable-id]')!;
      // Pressed at y 100, 20px below its top edge
      item.getBoundingClientRect = () => rect(80, 200, 130);
    });

    afterEach(() => insetFixture.destroy());

    /** Drag the item to `y`, release there, and return the clamped positions */
    function dragTo(y: number): { cursor: unknown; autoScrollCursor: unknown } {
      const cursorOverride = jest.spyOn(TestBed.inject(AutoScrollService), 'setCursorOverride');
      const updateDragPosition = jest.spyOn(dragStateService, 'updateDragPosition');
      attemptPointerDrag(item);
      expect(dragStateService.isDragging()).toBe(true);
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: y }));
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 150, clientY: y }));
      return {
        cursor: updateDragPosition.mock.lastCall?.[0].cursorPosition,
        autoScrollCursor: cursorOverride.mock.lastCall?.[0],
      };
    }

    it('should keep the constrained preview above the space covered at the bottom', () => {
      const { cursor, autoScrollCursor } = dragTo(1000);

      // The preview's bottom edge 1px above 260 (300 - 40): 260 - (50 - 20) - 1
      expect(cursor).toEqual({ x: 150, y: 229 });
      // The autoscroll cursor stops at the uncovered bottom edge, deep in its edge zone
      expect(autoScrollCursor).toEqual({ x: 150, y: 260 });
    });

    it('should keep the constrained preview below the space covered at the top', () => {
      const { cursor, autoScrollCursor } = dragTo(-500);

      // The preview's top edge 1px below 60: 60 + 20 + 1
      expect(cursor).toEqual({ x: 150, y: 81 });
      expect(autoScrollCursor).toEqual({ x: 150, y: 60 });
    });

    it('should not clamp a pointer inside the uncovered part', () => {
      const { cursor, autoScrollCursor } = dragTo(150);

      expect(cursor).toEqual({ x: 150, y: 150 });
      expect(autoScrollCursor).toEqual({ x: 150, y: 150 });
    });

    it('should keep constraining a drag whose first move lands on the covered space', () => {
      const updateDragPosition = jest.spyOn(dragStateService, 'updateDragPosition');
      item.dispatchEvent(
        new MouseEvent('mousedown', { clientX: 100, clientY: 100, button: 0, bubbles: true }),
      );
      // Pulled up fast: the move that starts the drag is already over the space covered at the top
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 40 }));
      expect(dragStateService.isDragging()).toBe(true);
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: -500 }));
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 150, clientY: -500 }));

      expect(updateDragPosition.mock.lastCall?.[0].cursorPosition).toEqual({ x: 150, y: 81 });
    });

    describe('when the covered space changes mid-drag', () => {
      const nextFrame = (): Promise<void> =>
        new Promise((resolve) => requestAnimationFrame(() => resolve()));

      afterEach(() => {
        document.dispatchEvent(new MouseEvent('mouseup', { clientX: 150, clientY: 150 }));
      });

      it('should stop targeting the rows it grows over', () => {
        const positionCalculator = TestBed.inject(PositionCalculatorService);
        attemptPointerDrag(item);
        expect(
          positionCalculator.findDroppableAtPoint(150, 100, item, 'test-group'),
        ).not.toBeNull();

        // A collapsed header expands over y 60..150
        insetFixture.componentInstance.insetTop.set(150);
        insetFixture.detectChanges();

        expect(positionCalculator.findDroppableAtPoint(150, 100, item, 'test-group')).toBeNull();
      });

      it('should clamp the resting pointer again', async () => {
        const updateDragPosition = jest.spyOn(dragStateService, 'updateDragPosition');
        attemptPointerDrag(item);
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: -500 }));
        await nextFrame();
        expect(updateDragPosition.mock.lastCall?.[0].cursorPosition).toEqual({ x: 150, y: 81 });

        insetFixture.componentInstance.insetTop.set(100);
        insetFixture.detectChanges();
        await nextFrame();

        // The preview's top edge 1px below the new covered space: 100 + 20 + 1
        expect(updateDragPosition.mock.lastCall?.[0].cursorPosition).toEqual({ x: 150, y: 121 });
      });
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
