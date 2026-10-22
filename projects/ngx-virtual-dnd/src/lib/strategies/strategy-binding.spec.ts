import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DragIndexCalculatorService } from '../services/drag-index-calculator.service';
import { DynamicHeightStrategy } from './dynamic-height.strategy';
import { FixedHeightStrategy } from './fixed-height.strategy';
import { bindListStrategy, createHeightStrategy } from './strategy-binding';
import type { VirtualScrollStrategy } from '../models/virtual-scroll-strategy';

describe('strategy binding', () => {
  describe('createHeightStrategy', () => {
    it('creates a fixed or a measured strategy', () => {
      expect(createHeightStrategy(40, false)).toBeInstanceOf(FixedHeightStrategy);
      expect(createHeightStrategy(40, true)).toBeInstanceOf(DynamicHeightStrategy);
    });
  });

  describe('bindListStrategy', () => {
    const strategy = signal<VirtualScrollStrategy>(new DynamicHeightStrategy(50));
    const items = signal(['a', 'b', 'c']);
    const droppableId = signal<string | null>('list');
    const excludedIndex = signal(-1);
    let keyReads: number;
    let calculator: DragIndexCalculatorService;

    beforeEach(() => {
      strategy.set(new DynamicHeightStrategy(50));
      items.set(['a', 'b', 'c']);
      droppableId.set('list');
      excludedIndex.set(-1);
      keyReads = 0;
      calculator = TestBed.inject(DragIndexCalculatorService);
      runInInjectionContext(TestBed.inject(Injector), () =>
        bindListStrategy({
          strategy,
          itemCount: () => items().length,
          itemKeys: () => {
            keyReads++;
            return items();
          },
          droppableId,
          excludedIndex,
        }),
      );
      TestBed.tick();
    });

    it("gives the strategy the list's items and registers it under the list's ID", () => {
      expect(strategy().getItemCount()).toBe(3);
      expect(calculator.getStrategyForDroppable('list')).toBe(strategy());
    });

    it('moves the registration when the ID changes', () => {
      droppableId.set('renamed');
      TestBed.tick();

      expect(calculator.getStrategyForDroppable('list')).toBeUndefined();
      expect(calculator.getStrategyForDroppable('renamed')).toBe(strategy());
    });

    it('registers and fills a replacement strategy', () => {
      const replacement = new FixedHeightStrategy(30);
      strategy.set(replacement);
      TestBed.tick();

      expect(calculator.getStrategyForDroppable('list')).toBe(replacement);
      expect(replacement.getItemCount()).toBe(3);
    });

    it("excludes the dragged item's slot without reading the keys again", () => {
      const reads = keyReads;

      excludedIndex.set(1);
      TestBed.tick();
      // The slot of b closes up: c starts where b did
      expect(strategy().getOffsetForIndex(2)).toBe(50);

      excludedIndex.set(-1);
      TestBed.tick();
      expect(strategy().getOffsetForIndex(2)).toBe(100);
      expect(keyReads).toBe(reads);
    });
  });
});
