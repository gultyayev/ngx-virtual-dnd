import { InjectionToken } from '@angular/core';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';

/**
 * Interface for a virtual viewport that provides wrapper-based positioning.
 * Components implementing this interface provide a content wrapper with
 * GPU-accelerated transform positioning for efficient virtual scrolling.
 */
export interface VdndVirtualViewport {
  /** Current scroll position */
  scrollTop(): number;

  /** Height of the viewport container */
  containerHeight(): number;

  /** Height of each item in pixels */
  itemHeight(): number;

  /** Offset for content below headers (page-level scroll scenarios) */
  contentOffset(): number;

  /** The native element of the viewport */
  readonly nativeElement: HTMLElement;

  /**
   * Called by VirtualForDirective to inform the viewport of the actual
   * first rendered item index (accounting for overscan). The viewport
   * uses this to position the content wrapper correctly.
   */
  setRenderStartIndex(index: number): void;

  /**
   * Get the pixel offset for a given item index.
   * Uses the strategy pattern to support both fixed and dynamic heights.
   */
  getOffsetForIndex(index: number): number;

  /**
   * The virtual scroll strategy used by this viewport.
   * Available for drag-drop integration and external consumers.
   */
  readonly strategy: VirtualScrollStrategy | null;
}

/**
 * Injection token for virtual viewport.
 * VirtualForDirective optionally injects this to detect if it's inside
 * a viewport component that handles wrapper-based positioning.
 */
export const VDND_VIRTUAL_VIEWPORT = new InjectionToken<VdndVirtualViewport>(
  'VDND_VIRTUAL_VIEWPORT',
);

/**
 * Internal, not exported from the package. Provided by vdnd-virtual-viewport next to
 * VDND_VIRTUAL_VIEWPORT: its rows start contentOffset px down its scroll area while its
 * scrollTop() is the raw position, so VirtualForDirective subtracts the offset when the viewport
 * it injects is this one. A token instead of an instanceof check keeps the viewport component out
 * of apps that don't use it.
 */
export const VDND_OFFSET_ROWS_VIEWPORT = new InjectionToken<VdndVirtualViewport>(
  'VDND_OFFSET_ROWS_VIEWPORT',
);
