import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  Directive,
  inject,
  input,
  Injector,
  OnDestroy,
  signal,
  ViewContainerRef,
  viewChild,
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  DraggableDirective,
  DragPreviewComponent,
  DroppableDirective,
  DroppableGroupDirective,
  VirtualForDirective,
  VirtualSortableListComponent,
  VirtualViewportComponent,
} from 'ngx-virtual-dnd';
import type { ContractConsumer, WorkCounters } from './protocol';

const work: WorkCounters = {
  hostChecks: 0,
  rowChecks: 0,
  keyReads: 0,
  created: 0,
  destroyed: 0,
  live: 0,
  peakLive: 0,
};
const settle = async () => {
  for (let i = 0; i < 3; i++)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};
interface Row {
  readonly id: string;
  index: number;
}
let settings = { rows: [] as Row[], dynamic: false, overscan: 3 };

@Directive({ selector: '[appWorkProbe]' })
class WorkProbe implements OnDestroy {
  readonly appWorkProbe = input.required<number>();
  constructor() {
    work.created++;
    work.live++;
    work.peakLive = Math.max(work.peakLive, work.live);
  }
  ngOnDestroy(): void {
    work.destroyed++;
    work.live--;
  }
}

@Directive()
class Consumer {
  readonly pulse = signal(0);
  readonly rows = settings.rows;
  readonly dynamic = settings.dynamic;
  readonly overscan = settings.overscan;
  readonly itemId = (row: Row) => row.id;
  readonly trackBy = (_index: number, row: Row) => row.id;
  readonly height = (row: Row) => (this.dynamic ? 40 + (row.index % 3) * 10 : 50);
  readonly rowCheck = (row: Row) => {
    work.rowChecks++;
    return row.index;
  };
  readonly hostCheck = () => {
    this.pulse();
    work.hostChecks++;
    return '';
  };
}
const styles = `:host { display:block; width:480px; margin:20px; }
  .row { box-sizing:border-box; display:flex; align-items:center; padding:0 12px;
    border-bottom:1px solid #ccc; background:white; color:black; touch-action:none; }`;

@Component({
  selector: 'app-component-consumer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    WorkProbe,
    DraggableDirective,
    DragPreviewComponent,
    DroppableGroupDirective,
    VirtualSortableListComponent,
  ],
  template: `
    <div vdndGroup="perf-contract" [attr.data-host-check]="hostCheck()">
      <vdnd-sortable-list
        droppableId="contract"
        [items]="rows"
        [itemHeight]="50"
        [dynamicItemHeight]="dynamic"
        [containerHeight]="400"
        [overscan]="overscan"
        [recycleRows]="true"
        [itemIdFn]="itemId"
        [trackByFn]="trackBy"
        [itemTemplate]="rowTemplate"
      />
      <ng-template #rowTemplate let-row>
        <div
          [appWorkProbe]="rowCheck(row)"
          class="row"
          [vdndDraggable]="row.id"
          [vdndDraggableData]="row"
          [style.height.px]="height(row)"
        >
          {{ row.index }}
        </div>
      </ng-template>
      <vdnd-drag-preview />
    </div>
  `,
  styles,
})
class ComponentConsumer extends Consumer {}

@Component({
  selector: 'app-directive-consumer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    WorkProbe,
    DraggableDirective,
    DragPreviewComponent,
    DroppableDirective,
    DroppableGroupDirective,
    VirtualForDirective,
    VirtualViewportComponent,
  ],
  template: `
    <div vdndGroup="perf-contract" [attr.data-host-check]="hostCheck()">
      <vdnd-virtual-viewport
        vdndDroppable="contract"
        [itemHeight]="50"
        [dynamicItemHeight]="dynamic"
        style="height:400px"
      >
        <div
          *vdndVirtualFor="let row of rows; trackBy: trackBy; overscan: overscan"
          [appWorkProbe]="rowCheck(row)"
          class="row"
          [vdndDraggable]="row.id"
          [vdndDraggableData]="row"
          [style.height.px]="height(row)"
        >
          {{ row.index }}
        </div>
      </vdnd-virtual-viewport>
      <vdnd-drag-preview />
    </div>
  `,
  styles,
})
class DirectiveConsumer extends Consumer {}

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-container #outlet />',
})
class ContractApp {
  readonly injector = inject(Injector);
  readonly outlet = viewChild.required('outlet', { read: ViewContainerRef });
  cleanup: (() => void) | undefined;

  constructor() {
    const api: ContractConsumer = {
      reset: () => {
        work.hostChecks = work.rowChecks = work.keyReads = 0;
        work.peakLive = work.live;
      },
      snapshot: () => ({ ...work }),
      unmount: async () => {
        this.cleanup?.();
        this.outlet().clear();
        await settle();
      },
      mount: async ({ count, renderer, dynamic, control = 'none' }) => {
        await api.unmount();
        settings = {
          dynamic,
          overscan: control === 'rows' ? count : 3,
          // Caller data allocation is outside initial-render timing.
          rows: Array.from({ length: count }, (_, index) => ({
            index,
            get id() {
              work.keyReads++;
              return `row-${index}`;
            },
          })),
        };
        api.reset();
        const start = performance.now();
        const rendered = new Promise<number>((resolve) =>
          afterNextRender(() => resolve(performance.now() - start), { injector: this.injector }),
        );
        const consumer = this.outlet().createComponent(
          renderer === 'component' ? ComponentConsumer : DirectiveConsumer,
        );
        if (control === 'stall') {
          const until = performance.now() + 500;
          while (performance.now() < until) {
            /* positive control */
          }
        }
        const mountMs = await rendered;
        await settle();
        const viewport = document.querySelector('[data-item-height], [data-virtual-viewport]')!;
        let scrollEvents = 0;
        const onScroll = () => {
          if (control === 'scan') for (const row of settings.rows) consumer.instance.itemId(row);
          if (control === 'checks') consumer.instance.pulse.update((value) => value + 1);
          if (control === 'scroll-stall' && ++scrollEvents === 2) {
            const until = performance.now() + 500;
            while (performance.now() < until) {
              /* observed severe-stall control */
            }
          }
        };
        viewport.addEventListener('scroll', onScroll);
        this.cleanup = () => viewport.removeEventListener('scroll', onScroll);
        return { mountMs, counters: api.snapshot() };
      },
    };
    window.__vdndContract = api;
  }
}
bootstrapApplication(ContractApp).catch((error) => console.error(error));
