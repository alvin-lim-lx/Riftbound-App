/**
 * BoardOverflow Tests — Issue #11: Game Board is overflowing
 *
 * Tests CSS overflow prevention by inspecting BoardLayout.tsx and main.tsx sources.
 * We verify the correct CSS values are present in both files.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const boardLayoutPath = resolve(__dirname, '../../frontend/src/components/Game/BoardLayout.tsx');
const boardLayoutSource = readFileSync(boardLayoutPath, 'utf-8');

const mainTsxPath = resolve(__dirname, '../../frontend/src/main.tsx');
const mainTsxSource = readFileSync(mainTsxPath, 'utf-8');

describe('BoardOverflow — Issue #11: Game Board is overflowing', () => {
  describe('main.tsx App container width', () => {
    it('App container should use width:100% not width:100vw to avoid horizontal overflow', () => {
      // 100vw includes the scrollbar width, causing horizontal overflow.
      // The fix: change width: '100vw' → width: '100%' in main.tsx App container
      const widthVwCount = (mainTsxSource.match(/width:\s*['"]100vw['"]/g) || []).length;
      const widthPercentCount = (mainTsxSource.match(/width:\s*['"]100%['"]/g) || []).length;

      expect(widthVwCount).toBe(0);
      expect(widthPercentCount).toBeGreaterThan(0);
    });
  });

  describe('board container width', () => {
    it('board style should use width:100% not width:100vw to avoid horizontal overflow', () => {
      // 100vw includes the scrollbar width, causing horizontal overflow.
      // The fix: change width: '100vw' → width: '100%' in styles.board
      const widthVwCount = (boardLayoutSource.match(/width:\s*['"]100vw['"]/g) || []).length;
      const widthPercentCount = (boardLayoutSource.match(/width:\s*['"]100%['"]/g) || []).length;

      expect(widthVwCount).toBe(0);
      expect(widthPercentCount).toBeGreaterThan(0);
    });
  });

  describe('battlefield container overflow', () => {
    it('bfRowStyles.container should NOT have overflowX:auto (no horizontal scrollbar)', () => {
      // overflowX:auto shows a horizontal scrollbar when battlefield panels overflow.
      // The fix: remove overflowX: 'auto' from bfRowStyles.container
      const hasOverflowXAuto = /overflowX:\s*['"]auto['"]/.test(boardLayoutSource);
      
      expect(hasOverflowXAuto).toBe(false);
    });
  });

  describe('infoBar minimum widths', () => {
    it('infoBar minWidth should be at most 160px to fit narrow viewports', () => {
      // With 2 infoBars (left+right) + center turn indicator in a row,
      // each infoBar with minWidth:200px overflows on viewports < 900px.
      // The fix: change minWidth: '200px' → minWidth: '160px' in infoBarStyles.bar
      const minWidth200Count = (boardLayoutSource.match(/minWidth:\s*['"]200px['"]/g) || []).length;
      const minWidth160Count = (boardLayoutSource.match(/minWidth:\s*['"]160px['"]/g) || []).length;
      
      expect(minWidth200Count).toBe(0);
      expect(minWidth160Count).toBeGreaterThan(0);
    });
  });

  describe('boardGrid overflow', () => {
    it('styles.boardGrid should have overflow:hidden to clip overflow from children', () => {
      // The fix: ensure overflow: 'hidden' is set in styles.boardGrid
      // boardGrid spans multiple lines so we use a broader regex
      const hasBoardGridOverflowHidden = /boardGrid:\s*\{[^}]*overflow:\s*['"]hidden['"]/.test(boardLayoutSource);
      
      expect(hasBoardGridOverflowHidden).toBe(true);
    });
  });

  describe('battlefieldRow overflow', () => {
    it('styles.battlefieldRow should have overflow:hidden to contain battlefield panels', () => {
      // The battlefield row takes all remaining space (flex:1).
      // It must clip overflow from battlefield panels.
      // battlefieldRow spans multiple lines so we use a broader regex
      const hasBfRowOverflowHidden = /battlefieldRow:\s*\{[^}]*overflow:\s*['"]hidden['"]/.test(boardLayoutSource);
      
      expect(hasBfRowOverflowHidden).toBe(true);
    });
  });
});
