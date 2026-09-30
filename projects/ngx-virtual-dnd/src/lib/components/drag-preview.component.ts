import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  OnDestroy,
  signal,
  TemplateRef,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DragStateService } from '../services/drag-state.service';
import { DragSchedulerService } from '../services/drag-scheduler.service';
import { OverlayContainerService } from '../services/overlay-container.service';
import { CursorPosition, DraggedItem, DragState, GrabOffset } from '../models/drag-drop.models';
import { VDND_ANIMATION_CONFIG } from '../tokens/animation-config.token';
import { DropAnimator, findDropTarget } from '../utils/drop-animator';
import { DroppableRegistryService } from '../services/droppable-registry.service';

/**
 * Context provided to the drag preview template.
 */
export interface DragPreviewContext<T = unknown> {
  /** The data associated with the dragged item */
  $implicit: T;
  /** The draggable ID */
  draggableId: string;
  /** The source droppable ID */
  droppableId: string;
}

/** Everything the preview position depends on except the cursor, which moves every frame. */
interface Placement {
  /** The position while the preview settles after a drop; null while it follows the cursor */
  settled: CursorPosition | null;
  /** Offset from the cursor to the preview's top-left corner */
  offset: GrabOffset;
  lockAxis: 'x' | 'y' | null;
  initialPosition: CursorPosition | null;
}

/** A preview that outlives its drag while it glides into the drop position. */
interface SettlingPreview {
  item: DraggedItem;
  position: CursorPosition;
}

/**
 * Renders a preview of the dragged item that follows the cursor.
 *
 * The component automatically teleports itself into a body-level overlay container,
 * so it works correctly even inside ancestors with CSS `transform` (e.g. Ionic pages).
 * It can be placed anywhere in the component tree.
 *
 * When `VDND_ANIMATION_CONFIG` is provided, the preview stays up briefly after a drop or
 * cancel and glides into the item's final position.
 *
 * @example
 * ```html
 * <vdnd-drag-preview>
 *   <ng-template let-data let-id="draggableId">
 *     <div class="drag-preview">{{ data.name }}</div>
 *   </ng-template>
 * </vdnd-drag-preview>
 * ```
 */
@Component({
  selector: 'vdnd-drag-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  template: `
    @if (isVisible()) {
      <div
        #preview
        class="vdnd-drag-preview"
        [class.vdnd-drag-preview-dropping]="isSettling()"
        [attr.data-testid]="isSettling() ? 'vdnd-drag-preview-dropping' : 'vdnd-drag-preview'"
        [style.width.px]="dimensions().width"
        [style.height.px]="dimensions().height"
      >
        @if (previewTemplate()) {
          <ng-container *ngTemplateOutlet="previewTemplate()!; context: templateContext()">
          </ng-container>
        } @else if (clonedElement()) {
          <div class="vdnd-drag-preview-clone" #cloneContainer></div>
        } @else {
          <div class="vdnd-drag-preview-default">
            {{ displayedItem()?.draggableId }}
          </div>
        }
      </div>
    }
  `,
  styles: `
    .vdnd-drag-preview {
      box-sizing: border-box;
      position: fixed;
      left: 0;
      top: 0;
      will-change: transform;
      pointer-events: none;
      z-index: 1000;
    }

    .vdnd-drag-preview-clone {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
  `,
})
export class DragPreviewComponent<T = unknown> implements OnDestroy {
  protected readonly dragState = inject(DragStateService);
  readonly #overlayContainer = inject(OverlayContainerService);
  readonly #elementRef = inject(ElementRef<HTMLElement>);
  readonly #injector = inject(Injector);
  readonly #droppableRegistry = inject(DroppableRegistryService);
  readonly #scheduler = inject(DragSchedulerService);
  readonly #dropAnimator = this.#createDropAnimator();

  /** Optional custom template for the preview */
  previewTemplate = input<TemplateRef<DragPreviewContext<T>>>();

  /** Offset from cursor to preview (to avoid cursor being on top of preview) */
  cursorOffset = input<{ x: number; y: number }>({ x: 8, y: 8 });

  /** Reference to the clone container element (cannot use ES private with viewChild) */
  private readonly cloneContainer = viewChild<ElementRef<HTMLElement>>('cloneContainer');

  /** The rendered preview box (cannot use ES private with viewChild) */
  private readonly previewElement = viewChild<ElementRef<HTMLElement>>('preview');

  /** Set while the preview animates into the drop position after the drag ended */
  readonly #settling = signal<SettlingPreview | null>(null);

  /** Whether the drag was still active on the last state change (detects drag end) */
  #wasDragging = false;

  /** Whether the preview is playing the drop animation */
  protected readonly isSettling = computed(() => this.#settling() !== null);

  /** The item shown: the live dragged item, or the dropped one while it settles */
  protected readonly displayedItem = computed(
    () => this.dragState.draggedItem() ?? this.#settling()?.item ?? null,
  );

  /**
   * Where the preview goes, from everything but the cursor. The template and its effects never
   * read the cursor: a signal read there would schedule a full application render on every
   * pointer frame, and that render lands after the frame is painted (one frame late).
   */
  readonly #placement = computed((): Placement => {
    const settling = this.#settling();
    if (settling && !this.dragState.isDragging()) {
      return {
        settled: settling.position,
        offset: { x: 0, y: 0 },
        initialPosition: null,
        lockAxis: null,
      };
    }
    return this.#placementFor({
      grabOffset: this.dragState.grabOffset(),
      initialPosition: this.dragState.initialPosition(),
      lockAxis: this.dragState.lockAxis(),
    });
  });

  /**
   * Moves the preview inside the drag scheduler's frame, right after the hit-test wrote the
   * cursor (bound for stable add/remove). The render-time write in the constructor covers the
   * rest: the preview appearing, keyboard drags and the settle.
   */
  readonly #writeFramePosition = (): void => {
    const preview = this.previewElement()?.nativeElement;
    if (!preview || this.#settling() || !this.dragState.isDragging()) {
      return;
    }
    this.#place(preview, this.#placement(), this.dragState.cursorPosition());
  };

  /** Whether this preview's template registration is currently counted (kept balanced). */
  #templateRegistered = false;

  /** The cloned element from drag state (used when no custom template is provided) */
  protected readonly clonedElement = computed(() => {
    if (this.previewTemplate()) {
      return null; // Custom template takes precedence
    }
    return this.displayedItem()?.clonedElement ?? null;
  });

  constructor() {
    // Counted from creation: drags clone the dragged element only while a mounted preview
    // shows the clone (one without a template, which registers below)
    this.#overlayContainer.setPreviewMounted(true);
    this.#scheduler.addFrameWriter(this.#writeFramePosition);

    // Teleport host element into the body-level overlay container after first render.
    // This escapes any ancestor CSS transforms that would break position: fixed.
    afterNextRender(() => {
      const container = this.#overlayContainer.getContainerElement();
      if (container) {
        container.appendChild(this.#elementRef.nativeElement);
      }
    });

    // Place the preview when it appears or anything but the cursor changes (drag start,
    // keyboard drags, the settle). The cursor is read untracked; pointer moves are written by
    // #writeFramePosition. Runs before the settle's afterNextRender reads the transform.
    afterRenderEffect({
      write: () => {
        const preview = this.previewElement()?.nativeElement;
        const placement = this.#placement();
        if (preview) {
          this.#place(preview, placement, untracked(this.dragState.cursorPosition));
        }
      },
    });

    // Publish whether this preview renders via a custom template, so the drag
    // directives can skip the drag-start element clone when no preview shows it.
    effect(() => {
      const hasTemplate = !!this.previewTemplate();
      if (hasTemplate && !this.#templateRegistered) {
        this.#overlayContainer.setTemplatePreviewActive(true);
        this.#templateRegistered = true;
      } else if (!hasTemplate && this.#templateRegistered) {
        this.#overlayContainer.setTemplatePreviewActive(false);
        this.#templateRegistered = false;
      }
    });

    // Effect to insert the cloned element into the container
    effect(() => {
      const container = this.cloneContainer()?.nativeElement;
      const clone = this.clonedElement();

      if (!container) {
        return;
      }

      // Clear previous content and append the prepared clone element.
      // Avoid cloning again: ElementCloneService already creates a styled/sanitized clone.
      container.innerHTML = '';
      if (clone) {
        container.appendChild(clone);
      }
    });

    // Drop animation: when a drag ends, keep the preview up and glide it into place.
    // A new drag cuts any settle short.
    effect(() => {
      const isDragging = this.dragState.isDragging();
      untracked(() => {
        const wasDragging = this.#wasDragging;
        this.#wasDragging = isDragging;
        if (isDragging) {
          this.#stopSettling();
        } else if (wasDragging) {
          this.#startSettling();
        }
      });
    });
  }

  ngOnDestroy(): void {
    this.#scheduler.removeFrameWriter(this.#writeFramePosition);
    this.#dropAnimator?.cancel();
    this.#overlayContainer.setPreviewMounted(false);
    if (this.#templateRegistered) {
      this.#overlayContainer.setTemplatePreviewActive(false);
      this.#templateRegistered = false;
    }
    this.#elementRef.nativeElement.remove();
  }

  /**
   * Whether the preview is visible. A drag shows it once it has a position: `initialPosition`
   * is set from the drag-start cursor and, unlike `cursorPosition`, does not change per frame.
   */
  protected readonly isVisible = computed(() => {
    return (
      (this.dragState.isDragging() && this.dragState.initialPosition() !== null) ||
      this.isSettling()
    );
  });

  #placementFor(state: Pick<DragState, 'grabOffset' | 'initialPosition' | 'lockAxis'>): Placement {
    return {
      settled: null,
      // Use grab offset if available (preserves grab position), otherwise fall back to cursorOffset input
      offset: state.grabOffset ?? this.cursorOffset(),
      initialPosition: state.initialPosition,
      lockAxis: state.lockAxis,
    };
  }

  #positionAt(placement: Placement, cursor: CursorPosition | null): CursorPosition {
    if (placement.settled) {
      return placement.settled;
    }
    if (!cursor) {
      return { x: 0, y: 0 };
    }

    const { offset, initialPosition, lockAxis } = placement;
    let x = cursor.x - offset.x;
    let y = cursor.y - offset.y;

    // Apply axis locking if configured
    if (lockAxis && initialPosition) {
      if (lockAxis === 'x') {
        // Lock X axis: x stays at initial position
        x = initialPosition.x - offset.x;
      } else if (lockAxis === 'y') {
        // Lock Y axis: y stays at initial position
        y = initialPosition.y - offset.y;
      }
    }

    return { x, y };
  }

  /** Transform-based positioning for better performance (avoid layout from left/top). */
  #place(preview: HTMLElement, placement: Placement, cursor: CursorPosition | null): void {
    const { x, y } = this.#positionAt(placement, cursor);
    preview.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  /** Dimensions of the preview */
  protected readonly dimensions = computed(() => {
    const item = this.displayedItem();

    if (!item) {
      return { width: 100, height: 50 };
    }

    return {
      width: item.width,
      height: item.height,
    };
  });

  /** Template context */
  protected readonly templateContext = computed((): DragPreviewContext<T> => {
    const item = this.displayedItem();

    return {
      $implicit: (item?.data ?? null) as T,
      draggableId: item?.draggableId ?? '',
      droppableId: item?.droppableId ?? '',
    };
  });

  #createDropAnimator(): DropAnimator | null {
    const config = inject(VDND_ANIMATION_CONFIG, { optional: true });
    return config ? new DropAnimator(config) : null;
  }

  /**
   * Keep the ended drag's preview on screen, then (once the consumer's drop handler has
   * re-rendered the lists) animate it onto the item's final position.
   */
  #startSettling(): void {
    const ended = this.dragState.endedDragState();
    if (!this.#dropAnimator?.isEnabled() || !ended?.draggedItem || !ended.cursorPosition) {
      return;
    }

    const settling: SettlingPreview = {
      item: ended.draggedItem,
      position: this.#positionAt(this.#placementFor(ended), ended.cursorPosition),
    };
    this.#settling.set(settling);

    // A normal drop lands in the target list; a cancel, a rejected drop or one the consumer
    // has not committed yet leaves the item in its source list.
    const droppableIds = this.dragState.wasCancelled()
      ? [ended.sourceDroppableId]
      : [ended.activeDroppableId, ended.sourceDroppableId];

    afterNextRender(
      () => {
        if (this.#settling() !== settling) {
          return;
        }
        const ghost = this.previewElement()?.nativeElement;
        if (!ghost || !this.#dropAnimator) {
          this.#settling.set(null);
          return;
        }
        const target = findDropTarget(settling.item.draggableId, droppableIds, (id) =>
          this.#droppableRegistry.getById(id),
        );
        this.#dropAnimator.play(ghost, target, () => {
          if (this.#settling() === settling) {
            this.#settling.set(null);
          }
        });
      },
      { injector: this.#injector },
    );
  }

  #stopSettling(): void {
    this.#dropAnimator?.cancel();
    this.#settling.set(null);
  }
}
