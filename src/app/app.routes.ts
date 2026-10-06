import { Routes } from '@angular/router';
import { DemoComponent } from './demo/demo';

export const routes: Routes = [
  {
    path: '',
    component: DemoComponent,
  },
  {
    path: 'page-scroll',
    loadComponent: () =>
      import('./page-scroll-demo/page-scroll-demo').then((m) => m.PageScrollDemoComponent),
  },
  {
    path: 'dynamic-height',
    loadComponent: () =>
      import('./dynamic-height-demo/dynamic-height-demo').then((m) => m.DynamicHeightDemoComponent),
  },
  {
    path: 'mid-drag-mount',
    loadComponent: () =>
      import('./mid-drag-mount-demo/mid-drag-mount-demo').then((m) => m.MidDragMountDemoComponent),
  },
  {
    path: 'interactive-children',
    loadComponent: () =>
      import('./interactive-children-demo/interactive-children-demo').then(
        (m) => m.InteractiveChildrenDemoComponent,
      ),
  },
  {
    path: 'row-leave-animation',
    loadComponent: () =>
      import('./row-leave-animation-demo/row-leave-animation-demo').then(
        (m) => m.RowLeaveAnimationDemoComponent,
      ),
  },
  {
    path: 'virtual-viewport',
    loadComponent: () =>
      import('./virtual-viewport-demo/virtual-viewport-demo').then(
        (m) => m.VirtualViewportDemoComponent,
      ),
  },
  {
    path: 'virtual-for-scrollable',
    loadComponent: () =>
      import('./scrollable-virtual-for-demo/scrollable-virtual-for-demo').then(
        (m) => m.ScrollableVirtualForDemoComponent,
      ),
  },
  {
    path: 'examples',
    loadComponent: () => import('./examples/examples-shell').then((m) => m.ExamplesShellComponent),
    loadChildren: () => import('./examples/examples.routes').then((m) => m.EXAMPLE_ROUTES),
  },
];
