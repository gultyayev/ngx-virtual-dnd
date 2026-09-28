import { ApplicationRef, Component, TemplateRef, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DragPreviewComponent, DragPreviewContext } from './drag-preview.component';
import { DragStateService } from '../services/drag-state.service';
import { OverlayContainerService } from '../services/overlay-container.service';
import { DroppableRegistryService } from '../services/droppable-registry.service';
import { DragSchedulerService } from '../services/drag-scheduler.service';
import { CursorPosition, DraggedItem, GrabOffset } from '../models/drag-drop.models';
import { VDND_ANIMATION_CONFIG, VdndAnimationConfig } from '../tokens/animation-config.token';

interface TestItemData {
  id: string;
  name: string;
}

// Test host for default/cloned element tests
@Component({
  template: ` <vdnd-drag-preview [cursorOffset]="cursorOffset" /> `,
  imports: [DragPreviewComponent],
})
class DefaultTestHostComponent {
  cursorOffset = { x: 8, y: 8 };
}

// Separate test host for custom template tests
@Component({
  template: `
    <ng-template #customTemplate let-data let-id="draggableId" let-droppableId="droppableId">
      <div class="custom-preview">
        <span class="preview-name">{{ data?.name }}</span>
        <span class="preview-id">{{ id }}</span>
        <span class="preview-droppable-id">{{ droppableId }}</span>
      </div>
    </ng-template>

    <vdnd-drag-preview [previewTemplate]="customTemplate" [cursorOffset]="cursorOffset" />
  `,
  imports: [DragPreviewComponent],
})
class CustomTemplateTestHostComponent {
  readonly customTemplate =
    viewChild.required<TemplateRef<DragPreviewContext<TestItemData>>>('customTemplate');
  cursorOffset = { x: 8, y: 8 };
}

// Test host with the drop animation turned on
const animationConfig: VdndAnimationConfig = {};

@Component({
  template: ` <vdnd-drag-preview /> `,
  imports: [DragPreviewComponent],
  providers: [{ provide: VDND_ANIMATION_CONFIG, useValue: animationConfig }],
})
class AnimatedTestHostComponent {}

describe('DragPreviewComponent', () => {
  const createMockDraggedItem = (overrides?: Partial<DraggedItem>): DraggedItem => {
    const element = document.createElement('div');
    element.innerHTML = 'Original Element';

    const clonedElement = document.createElement('div');
    clonedElement.innerHTML = 'Cloned Element';
    clonedElement.className = 'cloned-content';

    return {
      draggableId: 'item-1',
      droppableId: 'list-1',
      element,
      clonedElement,
      height: 50,
      width: 200,
      data: { id: 'item-1', name: 'Test Item' } as TestItemData,
      ...overrides,
    };
  };

  /** Query the preview inside the overlay container (outside the fixture DOM). */
  const queryPreview = (selector: string): HTMLElement | null =>
    document.querySelector(`.vdnd-overlay-container ${selector}`);

  describe('with default template', () => {
    let fixture: ComponentFixture<DefaultTestHostComponent>;
    let dragStateService: DragStateService;
    let overlayContainerService: OverlayContainerService;

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [DefaultTestHostComponent],
        providers: [DragStateService],
      });

      fixture = TestBed.createComponent(DefaultTestHostComponent);
      dragStateService = TestBed.inject(DragStateService);
      overlayContainerService = TestBed.inject(OverlayContainerService);
      fixture.detectChanges();
      fixture.detectChanges();
    });

    afterEach(() => {
      dragStateService.endDrag();
      fixture.destroy();
      overlayContainerService.ngOnDestroy();
    });

    describe('overlay teleport', () => {
      it('should teleport host element into the overlay container', () => {
        const overlayContainer = document.querySelector('.vdnd-overlay-container');
        expect(overlayContainer).not.toBeNull();

        const host = overlayContainer!.querySelector('vdnd-drag-preview');
        expect(host).not.toBeNull();
      });
    });

    describe('visibility', () => {
      it('should not be visible when not dragging', () => {
        const preview = queryPreview('.vdnd-drag-preview');
        expect(preview).toBeNull();
      });

      it('should be visible when dragging', () => {
        const item = createMockDraggedItem();
        dragStateService.startDrag(item, { x: 100, y: 100 });
        fixture.detectChanges();
        fixture.detectChanges();

        const preview = queryPreview('.vdnd-drag-preview');
        expect(preview).not.toBeNull();
      });

      it('should not be visible when dragging but cursor position is null', () => {
        const item = createMockDraggedItem();
        dragStateService.startDrag(item);
        fixture.detectChanges();
        fixture.detectChanges();

        const preview = queryPreview('.vdnd-drag-preview');
        expect(preview).toBeNull();
      });

      it('should become hidden when drag ends', () => {
        const item = createMockDraggedItem();
        dragStateService.startDrag(item, { x: 100, y: 100 });
        fixture.detectChanges();
        fixture.detectChanges();

        let preview = queryPreview('.vdnd-drag-preview');
        expect(preview).not.toBeNull();

        dragStateService.endDrag();
        fixture.detectChanges();
        fixture.detectChanges();

        preview = queryPreview('.vdnd-drag-preview');
        expect(preview).toBeNull();
      });
    });

    describe('positioning', () => {
      it('should position based on cursor and grab offset', () => {
        const item = createMockDraggedItem();
        const cursorPosition: CursorPosition = { x: 150, y: 200 };
        const grabOffset: GrabOffset = { x: 10, y: 20 };

        dragStateService.startDrag(item, cursorPosition, grabOffset);
        fixture.detectChanges();
        fixture.detectChanges();

        const preview = queryPreview('.vdnd-drag-preview');
        expect(preview!.style.transform).toBe('translate3d(140px, 180px, 0)');
      });

      it('should use default cursorOffset when no grab offset', () => {
        // Default cursorOffset is { x: 8, y: 8 }
        const item = createMockDraggedItem();
        dragStateService.startDrag(item, { x: 100, y: 100 }); // No grab offset
        fixture.detectChanges();
        fixture.detectChanges();

        const preview = queryPreview('.vdnd-drag-preview');
        // Should use default cursorOffset input: (100-8, 100-8) = (92, 92)
        expect(preview!.style.transform).toBe('translate3d(92px, 92px, 0)');
      });
    });

    describe('dimensions', () => {
      it('should use dragged item dimensions', () => {
        const item = createMockDraggedItem({ width: 250, height: 75 });
        dragStateService.startDrag(item, { x: 100, y: 100 });
        fixture.detectChanges();
        fixture.detectChanges();

        const preview = queryPreview('.vdnd-drag-preview');
        expect(preview!.style.width).toBe('250px');
        expect(preview!.style.height).toBe('75px');
      });
    });

    describe('cloned element', () => {
      it('should render the dragged item clone when no custom template', () => {
        const item = createMockDraggedItem();
        dragStateService.startDrag(item, { x: 100, y: 100 });
        fixture.detectChanges();
        fixture.detectChanges();

        const cloneContainer = queryPreview('.vdnd-drag-preview-clone');
        expect(cloneContainer).not.toBeNull();
        // The prepared clone itself is inserted (not re-cloned)
        expect(cloneContainer!.firstElementChild).toBe(item.clonedElement!);
        expect(cloneContainer!.textContent).toBe('Cloned Element');
      });

      it('should not register as a template preview', () => {
        expect(overlayContainerService.hasTemplatePreview()).toBe(false);
      });
    });

    describe('default preview', () => {
      it('should show default preview when no template or clone', () => {
        const item = createMockDraggedItem({ clonedElement: undefined });
        dragStateService.startDrag(item, { x: 100, y: 100 });
        fixture.detectChanges();
        fixture.detectChanges();

        const defaultPreview = queryPreview('.vdnd-drag-preview-default');
        expect(defaultPreview).not.toBeNull();
        expect(defaultPreview!.textContent!.trim()).toContain('item-1');
      });
    });
  });

  describe('with custom template', () => {
    let fixture: ComponentFixture<CustomTemplateTestHostComponent>;
    let dragStateService: DragStateService;
    let overlayContainerService: OverlayContainerService;

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [CustomTemplateTestHostComponent],
        providers: [DragStateService],
      });

      fixture = TestBed.createComponent(CustomTemplateTestHostComponent);
      dragStateService = TestBed.inject(DragStateService);
      overlayContainerService = TestBed.inject(OverlayContainerService);
      fixture.detectChanges();
      fixture.detectChanges();
    });

    afterEach(() => {
      dragStateService.endDrag();
      fixture.destroy();
      overlayContainerService.ngOnDestroy();
    });

    it('should render custom template when provided', () => {
      const item = createMockDraggedItem();
      dragStateService.startDrag(item, { x: 100, y: 100 });
      fixture.detectChanges();
      fixture.detectChanges();

      const customPreview = queryPreview('.custom-preview');
      expect(customPreview).not.toBeNull();
    });

    it('should provide correct context to template', () => {
      const item = createMockDraggedItem({
        draggableId: 'test-id',
        data: { id: 'data-1', name: 'My Item' },
      });
      dragStateService.startDrag(item, { x: 100, y: 100 });
      fixture.detectChanges();
      fixture.detectChanges();

      const previewName = queryPreview('.preview-name');
      const previewId = queryPreview('.preview-id');
      const previewDroppableId = queryPreview('.preview-droppable-id');

      expect(previewName!.textContent).toBe('My Item');
      expect(previewId!.textContent).toBe('test-id');
      expect(previewDroppableId!.textContent).toBe('list-1');
    });

    it('should register as a template preview while mounted', () => {
      expect(overlayContainerService.hasTemplatePreview()).toBe(true);

      fixture.destroy();

      expect(overlayContainerService.hasTemplatePreview()).toBe(false);
    });

    it('should remove its host from the overlay container when destroyed', () => {
      expect(document.querySelector('.vdnd-overlay-container vdnd-drag-preview')).not.toBeNull();

      fixture.destroy();

      expect(document.querySelector('.vdnd-overlay-container vdnd-drag-preview')).toBeNull();
    });

    it('should use custom template instead of cloned element', () => {
      const item = createMockDraggedItem();
      dragStateService.startDrag(item, { x: 100, y: 100 });
      fixture.detectChanges();
      fixture.detectChanges();

      const cloneContainer = queryPreview('.vdnd-drag-preview-clone');
      const customPreview = queryPreview('.custom-preview');

      expect(cloneContainer).toBeNull();
      expect(customPreview).not.toBeNull();
    });
  });

  describe('frame writes', () => {
    const originalRAF = globalThis.requestAnimationFrame;
    const originalCancelRAF = globalThis.cancelAnimationFrame;
    let rafCallbacks: Map<number, FrameRequestCallback>;
    let rafId: number;
    let fixture: ComponentFixture<DefaultTestHostComponent>;
    let dragStateService: DragStateService;
    let scheduler: DragSchedulerService;
    let overlayContainerService: OverlayContainerService;

    /** Run the queued animation frames, without any change detection. */
    const flushRAF = (): void => {
      const batch = [...rafCallbacks.values()];
      rafCallbacks.clear();
      batch.forEach((cb) => cb(performance.now()));
    };

    /** Start a drag the way DraggableDirective does: the scheduler tick writes the cursor. */
    const startPointerDrag = (lockAxis: 'x' | 'y' | null = null): void => {
      dragStateService.startDrag(
        createMockDraggedItem(),
        { x: 100, y: 100 },
        { x: 0, y: 0 },
        lockAxis,
      );
      fixture.detectChanges();
      fixture.detectChanges();
      scheduler.start((cursor, cursorDirty) => {
        if (cursorDirty && cursor) {
          dragStateService.updateDragPosition({
            cursorPosition: cursor,
            activeDroppableId: null,
            placeholderId: null,
            placeholderIndex: null,
          });
        }
      });
    };

    beforeEach(() => {
      rafCallbacks = new Map();
      rafId = 0;
      globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        rafCallbacks.set(++rafId, cb);
        return rafId;
      }) as typeof requestAnimationFrame;
      globalThis.cancelAnimationFrame = (id: number) => {
        rafCallbacks.delete(id);
      };

      TestBed.configureTestingModule({ imports: [DefaultTestHostComponent] });
      fixture = TestBed.createComponent(DefaultTestHostComponent);
      dragStateService = TestBed.inject(DragStateService);
      scheduler = TestBed.inject(DragSchedulerService);
      overlayContainerService = TestBed.inject(OverlayContainerService);
      fixture.detectChanges();
      fixture.detectChanges();
    });

    afterEach(() => {
      scheduler.stop();
      dragStateService.endDrag();
      fixture.destroy();
      overlayContainerService.ngOnDestroy();
      globalThis.requestAnimationFrame = originalRAF;
      globalThis.cancelAnimationFrame = originalCancelRAF;
    });

    it('moves the preview inside the scheduler frame, before change detection runs', () => {
      startPointerDrag();
      const preview = queryPreview('.vdnd-drag-preview')!;
      expect(preview.style.transform).toBe('translate3d(100px, 100px, 0)');

      scheduler.queueCursorUpdate({ x: 200, y: 150 });
      flushRAF();

      expect(preview.style.transform).toBe('translate3d(200px, 150px, 0)');
    });

    it('schedules no render when only the cursor moves', async () => {
      startPointerDrag();
      await fixture.whenStable();
      expect(fixture.isStable()).toBe(true);

      scheduler.queueCursorUpdate({ x: 200, y: 150 });
      flushRAF();

      // A pending render would mean a full ApplicationRef.tick() on every pointer frame
      expect(fixture.isStable()).toBe(true);
    });

    it('locks the x axis in the frame write', () => {
      startPointerDrag('x');
      const preview = queryPreview('.vdnd-drag-preview')!;

      scheduler.queueCursorUpdate({ x: 200, y: 300 });
      flushRAF();

      expect(preview.style.transform).toBe('translate3d(100px, 300px, 0)');
    });

    it('locks the y axis in the frame write', () => {
      startPointerDrag('y');
      const preview = queryPreview('.vdnd-drag-preview')!;

      scheduler.queueCursorUpdate({ x: 200, y: 300 });
      flushRAF();

      expect(preview.style.transform).toBe('translate3d(200px, 100px, 0)');
    });

    it('agrees with the rendered position once change detection catches up', () => {
      startPointerDrag();
      scheduler.queueCursorUpdate({ x: 200, y: 150 });
      flushRAF();
      fixture.detectChanges();

      expect(queryPreview('.vdnd-drag-preview')!.style.transform).toBe(
        'translate3d(200px, 150px, 0)',
      );
    });

    it('stops writing once destroyed', () => {
      startPointerDrag();
      const preview = queryPreview('.vdnd-drag-preview')!;
      fixture.destroy();

      scheduler.queueCursorUpdate({ x: 200, y: 150 });
      flushRAF();

      expect(preview.style.transform).toBe('translate3d(100px, 100px, 0)');
    });
  });

  describe('drop animation', () => {
    const originalAnimate = Element.prototype.animate;
    let fixture: ComponentFixture<AnimatedTestHostComponent>;
    let dragStateService: DragStateService;
    let overlayContainerService: OverlayContainerService;
    let animations: Map<Element, { keyframes: Keyframe[]; cancel: jest.Mock; finish: () => void }>;

    /** Change detection plus the afterNextRender hooks that follow it. */
    const render = (): void => {
      fixture.detectChanges();
      TestBed.inject(ApplicationRef).tick();
    };

    const addListItem = (droppableId: string, draggableId: string, top: number): HTMLElement => {
      let droppable = document.querySelector<HTMLElement>(`[data-droppable-id="${droppableId}"]`);
      if (!droppable) {
        droppable = document.createElement('div');
        droppable.setAttribute('data-droppable-id', droppableId);
        droppable.getBoundingClientRect = () =>
          ({ left: 0, top: 0, right: 300, bottom: 500, width: 300, height: 500 }) as DOMRect;
        document.body.appendChild(droppable);
        // As DroppableDirective does once rendered
        TestBed.inject(DroppableRegistryService).register(droppable, droppableId, 'group');
      }
      const item = document.createElement('div');
      item.setAttribute('data-draggable-id', draggableId);
      item.getBoundingClientRect = () =>
        ({ left: 0, top, right: 200, bottom: top + 50, width: 200, height: 50 }) as DOMRect;
      droppable.appendChild(item);
      return item;
    };

    const startDrag = (activeDroppableId = 'list-1'): void => {
      dragStateService.startDrag(
        createMockDraggedItem(),
        { x: 100, y: 100 },
        { x: 10, y: 10 },
        null,
        activeDroppableId,
        null,
        2,
        0,
      );
      render();
    };

    beforeEach(() => {
      delete animationConfig.dropDuration;
      animations = new Map();
      Element.prototype.animate = function (this: Element, keyframes: Keyframe[]) {
        const animation = {
          keyframes,
          cancel: jest.fn(),
          onfinish: null as (() => void) | null,
          finish: () => animation.onfinish?.(),
        };
        animations.set(this, animation);
        return animation as unknown as Animation;
      } as typeof Element.prototype.animate;

      TestBed.configureTestingModule({ imports: [AnimatedTestHostComponent] });
      fixture = TestBed.createComponent(AnimatedTestHostComponent);
      dragStateService = TestBed.inject(DragStateService);
      overlayContainerService = TestBed.inject(OverlayContainerService);
      render();
    });

    afterEach(() => {
      Element.prototype.animate = originalAnimate;
      fixture.destroy();
      overlayContainerService.ngOnDestroy();
      document.querySelectorAll('[data-droppable-id]').forEach((el) => el.remove());
    });

    it('keeps the preview at the release point and glides it onto the dropped item', () => {
      const landed = addListItem('list-1', 'item-1', 120);
      startDrag();

      dragStateService.endDrag();
      render();

      const preview = queryPreview('.vdnd-drag-preview')!;
      expect(preview.getAttribute('data-testid')).toBe('vdnd-drag-preview-dropping');
      expect(preview.style.transform).toBe('translate3d(90px, 90px, 0)');
      // The preview travels to the item, which stays invisible until it lands
      expect(animations.get(preview)?.keyframes.at(-1)?.['width']).toBe('200px');
      expect(animations.get(landed)?.keyframes).toEqual([{ opacity: 0 }, { opacity: 0 }]);

      animations.get(preview)!.finish();
      render();

      expect(queryPreview('.vdnd-drag-preview')).toBeNull();
      expect(animations.get(landed)!.cancel).toHaveBeenCalled();
    });

    it('starts the glide from a release position written outside a frame', () => {
      addListItem('list-1', 'item-1', 120);
      startDrag();

      // DraggableDirective flushes the release position synchronously, then ends the drag
      dragStateService.updateDragPosition({
        cursorPosition: { x: 300, y: 250 },
        activeDroppableId: 'list-1',
        placeholderId: null,
        placeholderIndex: 2,
      });
      dragStateService.endDrag();
      render();

      const preview = queryPreview('.vdnd-drag-preview')!;
      expect(preview.style.transform).toBe('translate3d(290px, 240px, 0)');
      expect(animations.get(preview)?.keyframes[0]['transform']).toBe(
        'translate3d(290px, 240px, 0) translate(0px, 0px)',
      );
    });

    it('fades out in place when the dropped item is not rendered', () => {
      startDrag();

      dragStateService.cancelDrag();
      render();

      const preview = queryPreview('.vdnd-drag-preview')!;
      expect(animations.get(preview)?.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    });

    it('returns a cancelled drag to the source list, not the hovered one', () => {
      const original = addListItem('list-1', 'item-1', 0);
      const hovered = addListItem('list-2', 'item-1', 200);
      startDrag('list-2');

      dragStateService.cancelDrag();
      render();

      expect(animations.has(original)).toBe(true);
      expect(animations.has(hovered)).toBe(false);
    });

    it('a new drag cuts the drop animation short', () => {
      const landed = addListItem('list-1', 'item-1', 120);
      startDrag();
      dragStateService.endDrag();
      render();
      const glide = animations.get(queryPreview('.vdnd-drag-preview')!)!;

      startDrag();

      expect(glide.cancel).toHaveBeenCalled();
      expect(animations.get(landed)!.cancel).toHaveBeenCalled();
      const preview = queryPreview('.vdnd-drag-preview')!;
      expect(preview.getAttribute('data-testid')).toBe('vdnd-drag-preview');
    });

    it('hides the preview immediately when the drop duration is 0', () => {
      animationConfig.dropDuration = 0;
      startDrag();

      dragStateService.endDrag();
      render();

      expect(queryPreview('.vdnd-drag-preview')).toBeNull();
      expect(animations.size).toBe(0);
    });
  });
});
