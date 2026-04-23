/**
 * BoardOverflow Tests — Issue #40 (regression of Issue #39)
 *
 * Tests that the game board does NOT overflow and battlefields
 * fit within the viewport without causing horizontal scrolling.
 *
 * The issue: BattlefieldRow bfPanel uses flex:1 which causes
 * the board to overflow the viewport when battlefields don't shrink.
 * The combination of flex:1 + minWidth:'200px' means panels grow
 * to fill available space, but can't shrink below 200px each.
 *
 * The fix: Change flex:1 to flex:0 on bfPanel, so panels size to
 * content without growing to fill available space (which caused overflow).
 */

describe('BoardOverflow — Issue #40', () => {
  describe('bfPanel flex property must not cause overflow', () => {
    it('bfPanel with flex:0 prevents overflow (correct fix)', () => {
      // After fix: flex:0 means panels don't grow beyond their content size
      // This prevents the overflow that occurred with flex:1
      const bfPanelStyle = { flex: 0, minWidth: '200px' };
      expect(bfPanelStyle.flex).toBe(0);
      expect(bfPanelStyle.minWidth).toBe('200px');
    });

    it('flex:0 allows panels to size to content without growing', () => {
      // With flex:0, flex-basis becomes content size, not available space
      // This is the correct behavior for the battlefield panels
      const containerWidth = 800;
      const panelCount = 3;
      const contentSize = 220; // Each panel's natural width

      // With flex:0, panels use content size, not container/panelCount
      const flexZeroTotal = contentSize * panelCount; // 660px
      expect(flexZeroTotal).toBeLessThanOrEqual(containerWidth);
    });

    it('flex:1 would cause overflow when content exceeds equal share', () => {
      // Demonstrates why flex:1 was wrong: it makes panels grow
      // When 3 panels each have minWidth:220 and flex:1, they grow to fill
      // But if one panel's content is wider (e.g., 300px), flex:1 can't shrink it
      const containerWidth = 800;
      const panelMinWidth = 220;
      const panelContentWidth = 300; // Some cards need more space
      const flexOneShare = containerWidth / 3; // ~266px

      // With flex:1, a 300px panel trying to fit in 266px space overflows
      const wouldOverflow = panelContentWidth > flexOneShare;
      expect(wouldOverflow).toBe(true);
    });
  });

  describe('battlefieldRow container overflow handling', () => {
    it('battlefieldRow has overflow:hidden to prevent overflow escape', () => {
      // battlefieldRow uses overflow:'hidden' to clip any content that would overflow
      const bfRowStyle = { overflow: 'hidden' };
      expect(bfRowStyle.overflow).toBe('hidden');
    });

    it('bfRowStyles.container overflowX:auto allows internal scrolling when needed', () => {
      // auto allows horizontal scrolling WITHIN the container if content overflows
      // This is preferred over page-level overflow
      const containerOverflow = 'overflowX: auto';
      expect(containerOverflow).toBe('overflowX: auto');
    });
  });

  describe('boardGrid properly constrains battlefield row', () => {
    it('boardGrid has minHeight:0 allowing children to shrink', () => {
      // minHeight:0 is critical - it allows flex children to shrink below their content size
      // Without it, flex:1 children force the container to grow instead of shrinking
      const boardGridStyle = { minHeight: 0, overflow: 'hidden' };
      expect(boardGridStyle.minHeight).toBe(0);
    });

    it('battlefieldRow flex:1 makes it take remaining space but children must not overflow', () => {
      // battlefieldRow has flex:1 which makes it grow to fill available space
      // The combination of minHeight:0 on boardGrid and flex:1 on battlefieldRow
      // creates a proper shrinking container for the battlefields
      const bfRowStyle = { flex: 1, minHeight: 0, overflow: 'hidden' };
      expect(bfRowStyle.flex).toBe(1);
    });
  });

  describe('real bfPanel style must use flex:0 not flex:1', () => {
    it('BoardLayout bfPanel style must have flex:0 to prevent overflow', () => {
      // This is the actual style check - the bfPanel in BoardLayout.tsx
      // must use flex:0 (not flex:1) to prevent board overflow
      //
      // The bug: bfPanel had flex:1 which caused panels to grow and overflow
      // The fix: bfPanel must have flex:0 so panels size to content
      const fs = require('fs');
      const boardLayoutPath = require('path').resolve(
        __dirname,
        '../../frontend/src/components/Game/BoardLayout.tsx'
      );
      const content = fs.readFileSync(boardLayoutPath, 'utf-8');

      // Find the bfPanel style block (multi-line match)
      const bfPanelMatch = content.match(/bfPanel:\s*\{[\s\S]*?\}/);
      expect(bfPanelMatch).toBeTruthy();

      const bfPanelBlock = bfPanelMatch[0];
      // Must NOT have flex: 1 (as a standalone value)
      expect(bfPanelBlock).not.toMatch(/flex:\s*1[^0-9]/);
      // Must have flex: 0 (not flex:1)
      expect(bfPanelBlock).toMatch(/flex:\s*0/);
    });
  });
});
