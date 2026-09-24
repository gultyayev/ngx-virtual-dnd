import { Routes } from '@angular/router';

/**
 * Docs live examples, served under `/examples/<slug>` and embedded by the docs site's
 * `<LiveDemo example="<slug>">`. The docs show each component's source verbatim via
 * `file="<root>/src/app/examples/<slug>/<slug>.ts"`, so keep them minimal and self-contained.
 */
export const EXAMPLE_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'quick-start' },
  {
    path: 'quick-start',
    loadComponent: () =>
      import('./quick-start/quick-start').then((m) => m.QuickStartExampleComponent),
  },
  {
    path: 'multiple-lists',
    loadComponent: () =>
      import('./multiple-lists/multiple-lists').then((m) => m.MultipleListsExampleComponent),
  },
  {
    path: 'drag-handle',
    loadComponent: () =>
      import('./drag-handle/drag-handle').then((m) => m.DragHandleExampleComponent),
  },
  {
    path: 'dynamic-height',
    loadComponent: () =>
      import('./dynamic-height/dynamic-height').then((m) => m.DynamicHeightExampleComponent),
  },
  {
    path: 'shift-animation',
    loadComponent: () =>
      import('./shift-animation/shift-animation').then((m) => m.ShiftAnimationExampleComponent),
  },
];
