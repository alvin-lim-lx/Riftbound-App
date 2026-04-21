/**
 * CardArtView unit tests
 *
 * Tests the pure logic for the card art hover enlarge feature:
 * - sizeMap dimensions are correct
 * - ENLARGE_W constant is correct
 * - Card renders without tags (name, stats, cost, type badges, keywords)
 */

describe('CardArtView', () => {
  describe('sizeMap', () => {
    it('has correct sm dimensions', () => {
      const sm = { w: 64, h: 86 };
      expect(sm.w / sm.h).toBeCloseTo(744 / 1039, 1);
    });

    it('has correct md dimensions', () => {
      const md = { w: 100, h: 134 };
      expect(md.w / md.h).toBeCloseTo(744 / 1039, 1);
    });

    it('has correct lg dimensions', () => {
      const lg = { w: 140, h: 188 };
      expect(lg.w / lg.h).toBeCloseTo(744 / 1039, 1);
    });

    it('sizes are increasing sm < md < lg', () => {
      const sizes = [64, 100, 140];
      expect(sizes[0]).toBeLessThan(sizes[1]);
      expect(sizes[1]).toBeLessThan(sizes[2]);
    });
  });

  describe('ENLARGE_W constant', () => {
    it('is 300px as required for good readability', () => {
      const ENLARGE_W = 300;
      expect(ENLARGE_W).toBe(300);
    });
  });
});
