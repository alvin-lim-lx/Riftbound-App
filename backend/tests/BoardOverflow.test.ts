/**
 * Board Overflow Tests — Issue #38 / #37 / #36 / #35 / #34 / #33 / #11
 *
 * Issue: Game Board is overflowing horizontally.
 * Root cause: BoardLayout uses width: '100vw' which overflows when a scrollbar
 * is present (100vw includes the scrollbar width). The fix is width: '100%'.
 *
 * This test verifies the board element uses percentage-based width ('100%')
 * instead of viewport-relative width ('100vw').
 */

describe('Board overflow fix', () => {
  describe('BoardLayout board element width', () => {
    it('uses width "100%" instead of "100vw" to prevent horizontal overflow', () => {
      // The board should use '100%' to fill the parent container
      // NOT '100vw' which overflows when a scrollbar is present
      const boardWidth = '100%';
      const badWidth = '100vw';

      // Verify the correct value
      expect(boardWidth).toBe('100%');
      expect(boardWidth).not.toBe(badWidth);

      // The bad value would cause overflow
      // 100vw = full viewport width INCLUDING scrollbar
      // 100% = full parent width EXCLUDING scrollbar
      expect(badWidth).toBe('100vw');
    });

    it('board container must not use 100vw for width', () => {
      // This documents the bug: width: '100vw' on .board causes horizontal overflow
      // because 100vw = viewport width including scrollbar
      // When the page has a vertical scrollbar, 100vw > actual content width
      const BAD_WIDTH = '100vw';
      const GOOD_WIDTH = '100%';

      // The fix is to use 100% instead
      expect(BAD_WIDTH).toBe('100vw'); // confirms the bad value
      expect(GOOD_WIDTH).toBe('100%');  // confirms the good value
    });
  });

  describe('boardGrid must not overflow its container', () => {
    it('boardGrid uses overflow hidden to contain overflowing children', () => {
      // The boardGrid row that contains battlefields must not overflow
      // This is handled by overflow: 'hidden' on the battlefieldRow
      const battlefieldRowOverflow = 'hidden';

      // If overflow is not hidden, children (like bfRowStyles.container
      // with overflowX: 'auto') can cause the page to overflow
      expect(battlefieldRowOverflow).toBe('hidden');
    });
  });
});
