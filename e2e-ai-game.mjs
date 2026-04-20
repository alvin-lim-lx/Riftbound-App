/**
 * E2E QA Test: Play a complete game vs AI opponent
 * Uses Playwright to automate the browser and play through an entire game.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3001/api';

let browser, page;
let errors = [];
let passed = [];
let failed = [];

function log(msg) { console.log(`[QA] ${msg}`); }
function pass(msg) { console.log(`  ✓ ${msg}`); passed.push(msg); }
function fail(msg) { console.log(`  ✗ ${msg}`); failed.push(msg); errors.push(msg); }

async function setup() {
  log('Launching browser...');
  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  page = await ctx.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore known non-critical errors
      if (!text.includes('WebSocket') && !text.includes('net::ERR')) {
        console.log(`  [CONSOLE ERROR] ${text}`);
      }
    }
  });
  page.on('pageerror', err => {
    console.log(`  [PAGE ERROR] ${err.message}`);
    errors.push(err.message);
  });
  
  log('Navigating to lobby...');
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Wait for React to hydrate
  await page.waitForTimeout(3000);
}

async function waitForConnect() {
  // Wait for connection indicator or lobby to appear
  try {
    await page.waitForSelector('text=Riftbound', { timeout: 15000 });
    pass('Lobby page loaded');
  } catch {
    // Take a screenshot for debugging
    const screenshot = await page.screenshot({ path: '/home/panda/riftbound/lobby-fail.png' });
    console.log(`  [DEBUG] Screenshot saved to /home/panda/riftbound/lobby-fail.png`);
    const bodyText = await page.textContent('body').catch(() => 'N/A');
    console.log(`  [DEBUG] Body text: ${bodyText.slice(0, 200)}`);
    fail('Lobby page did not load');
    throw new Error('Lobby page did not load');
  }
}

async function startAIGame() {
  log('Starting game vs AI...');
  
  // Click "Play vs AI"
  await page.click('text=Play vs AI');
  pass('Clicked Play vs AI');
  
  // Wait for game to start (either lobby code or game board)
  try {
    // Look for either "Starting game vs AI..." or game board elements
    await page.waitForSelector('text=Starting game', { timeout: 5000 });
    log('Game lobby created, waiting for game to start...');
  } catch {
    // Maybe it went straight to game
  }
  
  // Wait for game board (BoardLayout or zone elements)
  try {
    await page.waitForSelector('text=Turn', { timeout: 15000 });
    pass('Game started - Turn indicator visible');
  } catch {
    // Try alternative selectors
    try {
      await page.waitForSelector('[class*="board"]', { timeout: 10000 });
      pass('Game board rendered');
    } catch {
      fail('Game did not start - no board or turn indicator found');
    }
  }
}

async function playGame() {
  log('Playing through the game...');
  
  let turnCount = 0;
  const maxTurns = 30; // Safety limit
  
  while (turnCount < maxTurns) {
    try {
      // Wait a bit for animations/actions
      await page.waitForTimeout(1000);
      
      // Check if game ended
      const pageText = await page.textContent('body');
      if (pageText.includes('Victory') || pageText.includes('Defeat') || pageText.includes('Game Over')) {
        pass(`Game ended after ${turnCount} turns`);
        return;
      }
      
      // Look for actionable buttons (End Turn, Play Card, etc.)
      const endTurnBtn = await page.$('text=End Turn');
      if (endTurnBtn) {
        const isVisible = await endTurnBtn.isVisible();
        if (isVisible) {
          turnCount++;
          log(`Turn ${turnCount}: Clicking End Turn`);
          await endTurnBtn.click();
          await page.waitForTimeout(2000); // Wait for AI to play
          continue;
        }
      }
      
      // Try clicking any card in hand to play it
      const cards = await page.$$('[class*="card"]');
      if (cards.length > 0) {
        for (const card of cards.slice(0, 3)) { // Try up to 3 cards
          try {
            const isVisible = await card.isVisible();
            if (isVisible) {
              await card.click();
              await page.waitForTimeout(500);
              // Look for a play/drop zone
              const playBtn = await page.$('text=Play');
              if (playBtn && await playBtn.isVisible()) {
                await playBtn.click();
                await page.waitForTimeout(500);
                pass(`Played a card`);
              }
              // Try battlefield drop
              const battlefield = await page.$('[class*="battlefield"]');
              if (battlefield && await battlefield.isVisible()) {
                await battlefield.click();
                await page.waitForTimeout(300);
              }
            }
          } catch {}
        }
      }
      
      // If no end turn button found for 2 cycles, something might be wrong
      if (turnCount === 0) {
        await page.waitForTimeout(3000);
        const endTurnRetry = await page.$('text=End Turn');
        if (!endTurnRetry) {
          fail('Could not find End Turn button - UI may not be rendering correctly');
          break;
        }
      }
      
    } catch (err) {
      log(`Turn error: ${err.message}`);
    }
  }
  
  if (turnCount >= maxTurns) {
    fail(`Reached max turns (${maxTurns}) without game ending`);
  }
}

async function verifyUI() {
  log('Verifying UI elements...');
  
  // Check key zones exist
  const checks = [
    { selector: 'text=Turn', label: 'Turn indicator' },
    { selector: 'text=Deck', label: 'Deck zone' },
    { selector: 'text=Hand', label: 'Hand zone' },
  ];
  
  for (const { selector, label } of checks) {
    try {
      const el = await page.$(selector);
      if (el && await el.isVisible()) {
        pass(`${label} visible`);
      } else {
        fail(`${label} not visible`);
      }
    } catch {
      fail(`${label} check failed`);
    }
  }
}

async function teardown() {
  log('Cleaning up...');
  if (browser) await browser.close();
}

async function main() {
  const start = Date.now();
  console.log('═══════════════════════════════════════');
  console.log('  Riftbound E2E QA Test - VS AI');
  console.log('═══════════════════════════════════════\n');
  
  try {
    await setup();
    await waitForConnect();
    await startAIGame();
    await verifyUI();
    await playGame();
  } catch (err) {
    fail(`Fatal error: ${err.message}`);
  } finally {
    await teardown();
  }
  
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('\n═══════════════════════════════════════');
  console.log(`  Results (${elapsed}s)`);
  console.log('═══════════════════════════════════════');
  console.log(`  Passed: ${passed.length}`);
  console.log(`  Failed: ${failed.length}`);
  if (failed.length > 0) {
    console.log('\n  Failures:');
    failed.forEach(f => console.log(`    - ${f}`));
  }
  if (errors.length > 0) {
    console.log('\n  Console Errors:');
    errors.forEach(e => console.log(`    - ${e}`));
  }
  console.log('═══════════════════════════════════════');
  
  process.exit(failed.length > 0 ? 1 : 0);
}

main();