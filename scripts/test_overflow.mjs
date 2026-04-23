/**
 * Test: Game Board Overflow Check
 * Uses Playwright to verify the game board doesn't overflow horizontally.
 *
 * Issue #33: Game Board is overflowing
 * The board uses `width: 100vw` which causes horizontal scrollbar
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
      viewportWidth: window.innerWidth,
      scrollLeft: html.scrollLeft,
    };
  });

  console.log(`  body.scrollWidth=${bodyOverflow.bodyScrollWidth}, body.offsetWidth=${bodyOverflow.bodyOffsetWidth}`);
  console.log(`  window.innerWidth=${bodyOverflow.viewportWidth}, scrollLeft=${bodyOverflow.scrollLeft}`);

  // Board should not cause horizontal overflow
  // scrollWidth <= innerWidth means no horizontal scrollbar needed
  if (bodyOverflow.bodyScrollWidth <= bodyOverflow.viewportWidth) {
    pass(`board fits within viewport (scrollWidth=${bodyOverflow.bodyScrollWidth} <= innerWidth=${bodyOverflow.viewportWidth})`);
  } else {
    fail(`board overflows viewport (scrollWidth=${bodyOverflow.bodyScrollWidth} > innerWidth=${bodyOverflow.viewportWidth})`);
  }

  // scrollLeft should be 0 (no scrolling required)
  if (bodyOverflow.scrollLeft === 0) {
    pass('no horizontal scroll position');
  } else {
    fail(`unexpected scroll position: ${bodyOverflow.scrollLeft}`);
  }
}

async function run() {
  try {
    await setup();
    await test_board_no_horizontal_overflow();
  } catch (e) {
    console.error('Test error:', e);
    fail(`exception: ${e.message}`);
  } finally {
    await teardown();
  }

  console.log(`\nResults: ${passed.length} passed, ${failed.length} failed`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

run();
