import { Component, TemplateRef, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DragPreviewComponent, DragPreviewContext } from './drag-preview.component';
import { DragStateService } from '../services/drag-state.service';
import { OverlayContainerService } from '../services/overlay-container.service';
import { CursorPosition, DraggedItem, GrabOffset } from '../models/drag-drop.models';

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

      it('should update position when cursor moves', () => {
        const item = createMockDraggedItem();
        dragStateService.startDrag(item, { x: 100, y: 100 }, { x: 0, y: 0 });
        fixture.detectChanges();
        fixture.detectChanges();

        let preview = queryPreview('.vdnd-drag-preview');
        expect(preview!.style.transform).toBe('translate3d(100px, 100px, 0)');

        dragStateService.updateDragPosition({
          cursorPosition: { x: 200, y: 200 },
          activeDroppableId: null,
          placeholderId: null,
          placeholderIndex: null,
        });
        fixture.detectChanges();
        fixture.detectChanges();

        preview = queryPreview('.vdnd-drag-preview');
        expect(preview!.style.transform).toBe('translate3d(200px, 200px, 0)');
      });
    });

    describe('axis locking', () => {
      it('should lock x axis when configured', () => {
        const item = createMockDraggedItem();
        const initialPosition = { x: 100, y: 100 };
        const grabOffset = { x: 0, y: 0 };

        dragStateService.startDrag(item, initialPosition, grabOffset, 'x');
        fixture.detectChanges();
        fixture.detectChanges();

        dragStateService.updateDragPosition({
          cursorPosition: { x: 200, y: 200 },
          activeDroppableId: null,
          placeholderId: null,
          placeholderIndex: null,
        });
        fixture.detectChanges();
        fixture.detectChanges();

        const preview = queryPreview('.vdnd-drag-preview');
        expect(preview!.style.transform).toBe('translate3d(100px, 200px, 0)');
      });

      it('should lock y axis when configured', () => {
        const item = createMockDraggedItem();
        const initialPosition = { x: 100, y: 100 };
        const grabOffset = { x: 0, y: 0 };

        dragStateService.startDrag(item, initialPosition, grabOffset, 'y');
        fixture.detectChanges();
        fixture.detectChanges();

        dragStateService.updateDragPosition({
          cursorPosition: { x: 200, y: 200 },
          activeDroppableId: null,
          placeholderId: null,
          placeholderIndex: null,
        });
        fixture.detectChanges();
        fixture.detectChanges();

        const preview = queryPreview('.vdnd-drag-preview');
        expect(preview!.style.transform).toBe('translate3d(200px, 100px, 0)');
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
});
