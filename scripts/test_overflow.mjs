/**
 * Test: Game Board Overflow Check
 * Uses Playwright to verify the game board doesn't overflow horizontally.
 * 
 * Issue: The board uses `width: 100vw` which causes horizontal scrollbar
 * overflow on some browsers because vw doesn't account for scrollbar width.
 * 
 * Expected: Board width should be contained within the viewport with no
 * horizontal scrollbar visible.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';

let browser, page;
let passed = [];
let failed = [];

function pass(msg) { console.log(`  ✓ ${msg}`); passed.push(msg); }
function fail(msg) { console.log(`  ✗ ${msg}`); failed.push(msg); }

async function setup() {
  console.log('Launching browser...');
  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1
  });
  page = await ctx.newPage();
  
  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`  [CONSOLE ERROR] ${msg.text()}`);
    }
  });
}

async function teardown() {
  await browser?.close();
}

async function test_board_no_horizontal_overflow() {
  console.log('\n[Test] Board has no horizontal overflow');
  
  // Navigate to the app
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  
  // Get the viewport size
  const viewport = page.viewportSize();
  console.log(`  Viewport: ${viewport.width}x${viewport.height}`);
  
  // Check body scrollWidth vs viewport width
  const bodyOverflow = await page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;
    return {
      bodyScrollWidth: body.scrollWidth,
      bodyOffsetWidth: body.offsetWidth,
      bodyClientWidth: body.clientWidth,
      htmlScrollWidth: html.scrollWidth,
      viewportWidth: window.innerWidth,
      scrollbarWidth: window.innerWidth - document.documentElement.clientWidth
    };
  });
  
  console.log(`  Body scrollWidth: ${bodyOverflow.bodyScrollWidth}`);
  console.log(`  Body offsetWidth: ${bodyOverflow.bodyOffsetWidth}`);
  console.log(`  Body clientWidth: ${bodyOverflow.bodyClientWidth}`);
  console.log(`  Viewport width: ${bodyOverflow.viewportWidth}`);
  console.log(`  Estimated scrollbar width: ${bodyOverflow.scrollbarWidth}px`);
  
  // The key check: body.scrollWidth should not exceed viewport width
  // (allowing 1px tolerance for rounding)
  const hasHorizontalOverflow = bodyOverflow.bodyScrollWidth > bodyOverflow.viewportWidth + 1;
  
  if (hasHorizontalOverflow) {
    const overflowPx = bodyOverflow.bodyScrollWidth - bodyOverflow.viewportWidth;
    fail(`Horizontal overflow detected: content is ${overflowPx}px wider than viewport`);
  } else {
    pass(`No horizontal overflow (scrollWidth ${bodyOverflow.bodyScrollWidth} <= viewport ${bodyOverflow.viewportWidth})`);
  }
  
  // Also check for actual horizontal scrollbar visibility
  const scrollbarVisible = await page.evaluate(() => {
    const body = document.body;
    // Check if there's actually a scrollbar rendered
    return {
      hasHScroll: body.scrollWidth > body.clientWidth,
      windowScrollX: window.scrollX,
      documentScrollWidth: document.documentElement.scrollWidth
    };
  });
  
  if (scrollbarVisible.hasHScroll) {
    fail(`Horizontal scrollbar is present`);
  } else {
    pass(`No horizontal scrollbar visible`);
  }
  
  // Get the board element if it exists
  const boardInfo = await page.evaluate(() => {
    // Try to find board element
    const root = document.getElementById('root');
    const board = root?.querySelector('[style*="100vw"], [style*="100vh"]');
    if (board) {
      const rect = board.getBoundingClientRect();
      return {
        found: true,
        width: rect.width,
        right: rect.right,
        left: rect.left
      };
    }
    return { found: false };
  });
  
  if (boardInfo.found) {
    console.log(`  Board element: width=${boardInfo.width}, left=${boardInfo.left}, right=${boardInfo.right}`);
    if (boardInfo.right > viewport.width) {
      fail(`Board element overflows viewport by ${(boardInfo.right - viewport.width).toFixed(1)}px`);
    } else {
      pass(`Board element fits within viewport`);
    }
  }
}

async function run() {
  try {
    await setup();
    await test_board_no_horizontal_overflow();
    
    console.log(`\n=== Results ===`);
    console.log(`Passed: ${passed.length}`);
    console.log(`Failed: ${failed.length}`);
    
    if (failed.length > 0) {
      console.log('\nFailed tests:');
      failed.forEach(f => console.log(`  - ${f}`));
      process.exit(1);
    } else {
      console.log('\nAll tests passed!');
      process.exit(0);
    }
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  } finally {
    await teardown();
  }
}

run();
