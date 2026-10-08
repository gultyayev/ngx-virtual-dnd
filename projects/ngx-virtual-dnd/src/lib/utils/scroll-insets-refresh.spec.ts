import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AutoScrollService } from '../services/auto-scroll.service';
import { PositionCalculatorService } from '../services/position-calculator.service';
import { refreshDragOnScrollInsetChange } from './scroll-insets-refresh';

@Component({ template: '' })
class InsetHostComponent {
  readonly top = signal(0);
  readonly bottom = signal(0);

  constructor() {
    refreshDragOnScrollInsetChange(this.top, this.bottom);
  }
}

describe('refreshDragOnScrollInsetChange', () => {
  let invalidate: jest.SpyInstance;
  let refreshAutoScroll: jest.SpyInstance;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    invalidate = jest.spyOn(TestBed.inject(PositionCalculatorService), 'invalidateDroppableRects');
    refreshAutoScroll = jest.spyOn(TestBed.inject(AutoScrollService), 'refresh');
  });

  /** Create the host with the given insets */
  const create = (top = 0, bottom = 0) => {
    const fixture = TestBed.createComponent(InsetHostComponent);
    fixture.componentInstance.top.set(top);
    fixture.componentInstance.bottom.set(bottom);
    fixture.detectChanges();
    return fixture;
  };

  it('should measure nothing again for an element created with nothing covered', () => {
    // A list rendered mid-drag (scrolled into view in an outer list) covers no space
    create();

    expect(invalidate).not.toHaveBeenCalled();
    expect(refreshAutoScroll).not.toHaveBeenCalled();
  });

  it('should measure again for an element created with covered space', () => {
    create(40);

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(refreshAutoScroll).toHaveBeenCalledTimes(1);
  });

  it('should measure again when the covered space changes', () => {
    const fixture = create();

    fixture.componentInstance.bottom.set(30);
    fixture.detectChanges();

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(refreshAutoScroll).toHaveBeenCalledTimes(1);
  });

  it('should not measure again for a change the drag reads as nothing covered', () => {
    const fixture = create();

    fixture.componentInstance.top.set(-30);
    fixture.detectChanges();
    fixture.componentInstance.top.set(Number.NaN);
    fixture.detectChanges();

    expect(invalidate).not.toHaveBeenCalled();
  });
});
