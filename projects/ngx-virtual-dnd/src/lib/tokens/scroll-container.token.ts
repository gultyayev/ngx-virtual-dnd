import { InjectionToken } from '@angular/core';

/**
 * Interface for a scroll container that can be used with VirtualForDirective.
 * Implement this interface to create custom scroll containers.
 *
 * The scrollTop() and containerHeight() methods should return reactive values
 * (internally backed by signals) so that changes trigger re-computation in
 * the virtual scroll directive.
 */
export interface VdndScrollContainer {
  /**
   * The container's host element. It is the element that scrolls, except for vdnd-virtual-content:
   * its host sits inside its parent scroll container and does not scroll itself.
   */
  readonly nativeElement: HTMLElement;

  /**
   * The rendered scroll position from top in pixels (reactive). The built-in containers commit it
   * once per animation frame, after a move of 5px or more, so it can lag the scrolling element:
   * read that element's scrollTop for a position to compute from. vdnd-virtual-content's is
   * relative to where its list starts: its parent scroll container's element scrollTop minus its
   * content offset, clamped at 0.
   */
  scrollTop(): number;

  /** Current container height in pixels (reactive) */
  containerHeight(): number;

  /** Scroll to a specific position */
  scrollTo(options: ScrollToOptions): void;
}

/**
 * Injection token for providing a scroll container to VirtualForDirective.
 *
 * Use the `vdndScrollable` directive to provide this token, or implement
 * `VdndScrollContainer` and provide it manually.
 *
 * @example
 * ```html
 * <div vdndScrollable style="overflow: auto; height: 400px;">
 *   <ng-container *vdndVirtualFor="let item of items(); itemHeight: 50; trackBy: trackById">
 *     <div>{{ item.name }}</div>
 *   </ng-container>
 * </div>
 * ```
 */
export const VDND_SCROLL_CONTAINER = new InjectionToken<VdndScrollContainer>(
  'VDND_SCROLL_CONTAINER',
);
