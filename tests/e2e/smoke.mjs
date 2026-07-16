/**
 * E2E smoke: two browser tabs play the REAL join flow end-to-end —
 * host creates a room, generates a WebRTC invite (non-trickle SDP blob),
 * joiner answers, DataChannels open, lobby rosters sync, ready → start round,
 * and both tabs enter the 3D game screen.
 *
 * Run: npm run e2e   (builds are NOT triggered here; run `npm run build` first)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 4199;
const APP_URL = `http://localhost:${PORT}/`;
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

async function waitForServer(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`preview server did not start at ${url}`);
}

console.log('· starting preview server…');
// detached → own process group, so we can kill npx AND its vite child together.
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'pipe',
  detached: true,
});
preview.stderr.on('data', (d) => console.error('[preview]', String(d).trim()));

const consoleErrors = [];
let browser;
try {
  await waitForServer(APP_URL);
  console.log('· preview up');
  mkdirSync(SHOTS, { recursive: true });

  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });
  console.log('· chrome launched');
  const ctx = await browser.newContext({ viewport: { width: 960, height: 720 } });

  const watch = (page, tag) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[${tag}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => consoleErrors.push(`[${tag}] pageerror: ${err.message}`));
  };

  // ── Host tab ──
  const host = await ctx.newPage();
  watch(host, 'host');
  await host.goto(APP_URL);
  await host.fill('input[placeholder="Player"]', 'Anna');
  await host.click('text=Host Game');
  await host.fill('input[maxlength="24"]', 'Smoke Room');
  await host.click('text=Create Room');
  await host.waitForSelector('text=Invite players');
  console.log('✓ host reached lobby');

  await host.click('text=+ Invite a player');
  await host.waitForSelector('textarea.blob-out', { timeout: 15000 });
  const inviteBlob = await host.inputValue('textarea.blob-out');
  if (!inviteBlob.startsWith('H1')) throw new Error('invite blob missing/invalid');
  console.log(`✓ invite created (${inviteBlob.length} chars)`);

  // ── Joiner tab ──
  const join = await ctx.newPage();
  watch(join, 'join');
  await join.goto(APP_URL);
  await join.fill('input[placeholder="Player"]', 'Ben');
  await join.click('text=Join Game');
  await join.fill('textarea[placeholder="Paste code here…"]', inviteBlob);
  await join.click('button:has-text("Connect")');
  await join.waitForSelector('textarea.blob-out', { timeout: 15000 });
  const answerBlob = await join.inputValue('textarea.blob-out');
  if (!answerBlob.startsWith('H1')) throw new Error('answer blob missing/invalid');
  console.log(`✓ answer created (${answerBlob.length} chars)`);

  // ── Host accepts the answer → DataChannels open → join completes ──
  await host.fill('textarea[placeholder="Paste code here…"]', answerBlob);
  await host.click('button:has-text("Connect")');

  await host.waitForSelector('li:has-text("Ben")', { timeout: 20000 });
  await join.waitForSelector('li:has-text("Anna")', { timeout: 20000 });
  console.log('✓ WebRTC connected — rosters synced on both peers');

  // ── Ready → start round → both enter the 3D game ──
  await join.click('text=Ready!');
  await host.waitForSelector('button:has-text("Start Round"):not([disabled])', {
    timeout: 10000,
  });
  await host.click('text=Start Round');

  await host.waitForSelector('.game canvas', { timeout: 20000 });
  await join.waitForSelector('.game canvas', { timeout: 20000 });
  await host.waitForSelector('text=/HUNTER|HIDER/i', { timeout: 10000 });
  console.log('✓ round started — both tabs render the game screen');

  await host.waitForTimeout(2500); // let a few frames render
  await host.screenshot({ path: `${SHOTS}host-1st.png` });
  await join.screenshot({ path: `${SHOTS}join-1st.png` });
  console.log(`✓ first-person screenshots → ${SHOTS}`);

  // ── Camera toggle: flip both tabs to third-person and verify ──
  for (const [page, tag] of [
    [host, 'host'],
    [join, 'join'],
  ]) {
    const btn = page.locator('.view-toggle');
    const before = (await btn.textContent())?.trim();
    await btn.click();
    await page.waitForTimeout(300);
    const after = (await btn.textContent())?.trim();
    if (before === after) throw new Error(`[${tag}] view toggle did not change (${before})`);
    if (!after?.includes('3rd')) throw new Error(`[${tag}] expected 3rd-person, got "${after}"`);
  }
  await host.waitForTimeout(1500);
  await host.screenshot({ path: `${SHOTS}host-3rd.png` });
  await join.screenshot({ path: `${SHOTS}join-3rd.png` });
  console.log('✓ camera toggle → third-person verified & screenshotted on both tabs');

  // WebGL-fallback warnings are expected in headless; real errors are not.
  const relevant = consoleErrors.filter(
    (e) => !/swiftshader|GPU|WebGL.*performance|Automatic fallback/i.test(e),
  );
  if (relevant.length) {
    console.error('Console errors captured:');
    for (const e of relevant) console.error('  ' + e);
    fail('console errors during smoke run');
  } else {
    console.log('✓ no console errors');
    console.log('\nPASS — full host↔join WebRTC round-trip verified in-browser.');
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
  if (consoleErrors.length) {
    console.error('Console errors captured:');
    for (const e of consoleErrors) console.error('  ' + e);
  }
} finally {
  await browser?.close();
  try {
    process.kill(-preview.pid, 'SIGTERM'); // negative pid = whole group (npx + vite)
  } catch {
    preview.kill();
  }
  process.exit(process.exitCode ?? 0);
}
