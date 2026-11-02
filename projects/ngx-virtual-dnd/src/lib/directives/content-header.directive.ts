import { Directive, ElementRef, inject } from '@angular/core';

/**
 * Marks an element as the header content for a `vdnd-virtual-content` component.
 *
 * Place this directive on a projected element inside `<vdnd-virtual-content>`.
 * The component measures where its rows start below the header (the header's margins and
 * anything above it in the scroll container count, such as its padding) and uses that as the
 * content offset for virtual scroll calculations, again whenever the header or the container
 * resizes.
 *
 * This eliminates the need for manual ResizeObserver boilerplate that was
 * previously required with the `[contentOffset]` input.
 *
 * @example
 * ```html
 * <vdnd-virtual-content [itemHeight]="50">
 *   <div class="page-header" vdndContentHeader>
 *     <h1>My List</h1>
 *   </div>
 *   <ng-container *vdndVirtualFor="let item of items(); trackBy: trackById">
 *     <div>{{ item.name }}</div>
 *   </ng-container>
 * </vdnd-virtual-content>
 * ```
 */
@Directive({
  selector: '[vdndContentHeader]',
})
export class ContentHeaderDirective {
  readonly elementRef = inject(ElementRef<HTMLElement>);
}
