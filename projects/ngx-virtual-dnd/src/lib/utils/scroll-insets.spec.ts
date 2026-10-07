import { readScrollInset, uncoveredRect } from './scroll-insets';

describe('scroll insets', () => {
  let element: HTMLElement;

  beforeEach(() => {
    element = document.createElement('div');
  });

  describe('readScrollInset', () => {
    it('should read the space covered at each edge', () => {
      element.setAttribute('data-scroll-inset-top', '64');
      element.setAttribute('data-scroll-inset-bottom', '48.5');

      expect(readScrollInset(element, 'top')).toBe(64);
      expect(readScrollInset(element, 'bottom')).toBe(48.5);
    });

    it.each(['', 'abc', '-20', 'Infinity'])('should read %p as nothing covered', (value) => {
      element.setAttribute('data-scroll-inset-top', value);

      expect(readScrollInset(element, 'top')).toBe(0);
    });

    it('should read an unmarked element as nothing covered', () => {
      expect(readScrollInset(element, 'top')).toBe(0);
      expect(readScrollInset(element, 'bottom')).toBe(0);
    });
  });

  describe('uncoveredRect', () => {
    const rect = new DOMRect(10, 100, 200, 400);

    it('should return the rect itself while nothing is covered', () => {
      expect(uncoveredRect(element, rect)).toBe(rect);
    });

    it('should shrink the rect by the space covered at its edges', () => {
      element.setAttribute('data-scroll-inset-top', '60');
      element.setAttribute('data-scroll-inset-bottom', '40');

      const uncovered = uncoveredRect(element, rect);

      expect([uncovered.left, uncovered.top, uncovered.right, uncovered.bottom]).toEqual([
        10, 160, 210, 460,
      ]);
    });

    it('should read the element rect when none is given', () => {
      element.getBoundingClientRect = () => rect;
      element.setAttribute('data-scroll-inset-top', '60');

      expect(uncoveredRect(element).top).toBe(160);
    });
  });
});
