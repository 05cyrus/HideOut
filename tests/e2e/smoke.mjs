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
// ?e2e=1 enables harness-only test seams (e.g. window.__pingNoise); no effect in prod.
const APP_URL = `http://localhost:${PORT}/?e2e=1`;
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
// HIDEOUT_E2E_DEV=1 serves unbundled sources (vite dev) instead of dist — used
// to discriminate prod-build (tree-shaking/minify) issues from code issues.
const serveArgs = process.env.HIDEOUT_E2E_DEV
  ? ['vite', '--port', String(PORT), '--strictPort']
  : ['vite', 'preview', '--port', String(PORT), '--strictPort'];
const preview = spawn('npx', serveArgs, {
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
  ctx.setDefaultTimeout(90000); // SwiftShader on a loaded machine needs headroom

  const watch = (page, tag) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[${tag}] ${msg.text()}`);
      if (process.env.HIDEOUT_E2E_DEBUG && /\[ping/.test(msg.text()))
        console.log(`  [${tag}] ${msg.text()}`);
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
  // Optional map override: HIDEOUT_E2E_MAP="Warehouse Depot" npm run e2e
  if (process.env.HIDEOUT_E2E_MAP) {
    await host.click(`.map-card:has-text("${process.env.HIDEOUT_E2E_MAP}")`);
    console.log(`· map selected: ${process.env.HIDEOUT_E2E_MAP}`);
  }
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

  // Default lands in Preparation (dim overlay). Set HIDEOUT_E2E_SHOT_DELAY_MS
  // past prep+hiding (e.g. 31000) for clean Hunting-phase visuals.
  await host.waitForTimeout(Number(process.env.HIDEOUT_E2E_SHOT_DELAY_MS ?? 2500));
  await host.screenshot({ path: `${SHOTS}host-1st.png` });
  await join.screenshot({ path: `${SHOTS}join-1st.png` });
  console.log(`✓ first-person screenshots → ${SHOTS}`);

  // ── Camera toggle: flip both tabs to third-person and verify ──
  for (const [page, tag] of [
    [host, 'host'],
    [join, 'join'],
  ]) {
    await page.bringToFront(); // a backgrounded tab stalls Playwright's click actionability
    const btn = page.locator('.view-toggle');
    const before = (await btn.textContent())?.trim();
    // force: the button sits over a canvas that grabs pointer capture; the default
    // actionability check can hang waiting for the click to "settle" on it.
    await btn.click({ force: true });
    await page.waitForTimeout(300);
    const after = (await btn.textContent())?.trim();
    if (before === after) throw new Error(`[${tag}] view toggle did not change (${before})`);
    if (!after?.includes('3rd')) throw new Error(`[${tag}] expected 3rd-person, got "${after}"`);
  }
  await host.waitForTimeout(1500);
  await host.screenshot({ path: `${SHOTS}host-3rd.png` });
  await join.screenshot({ path: `${SHOTS}join-3rd.png` });
  console.log('✓ camera toggle → third-person verified & screenshotted on both tabs');

  // ── Noise ping (visual taunt cue): trigger the render seam on a HIDER tab
  //    (the hunter is blindfolded during Hiding) and screenshot the ring+beam. ──
  const hostRole = (await host.locator('.badge.role').textContent()) ?? '';
  const pingPage = hostRole.includes('Hider') ? host : join;
  await pingPage.bringToFront();
  const diag = await pingPage.evaluate(async () => {
    const out = globalThis.__pingNoise?.();
    if (!out) return null;
    // Offset re-fires 2 m to the avatar's side: beam reads against the dark
    // backdrop, ring on open floor (not under the capsule).
    // Screenshot compositing can lag past a single 1.5 s ping under software GL,
    // so keep re-firing: some ring is always mid-animation when the shot lands.
    globalThis.__pingTimer = setInterval(() => globalThis.__pingNoise?.(out.px + 2, out.pz), 400);
    // Pump rAF frames so the ring is composited even if this tab's loop is
    // throttled — otherwise the screenshot captures a pre-ping backbuffer.
    let frames = 0;
    await new Promise((res) => {
      const step = () => (++frames >= 3 ? res() : globalThis.requestAnimationFrame(step));
      globalThis.requestAnimationFrame(step);
    });
    return { ...out, frames };
  });
  if (!diag) throw new Error('window.__pingNoise seam missing (is ?e2e=1 set?)');
  console.log(`· ping diag: ${JSON.stringify(diag)}`);
  await pingPage.screenshot({ path: `${SHOTS}noise-ping.png` });
  await pingPage.evaluate(() => clearInterval(globalThis.__pingTimer));
  console.log(`✓ noise-ping cue rendered → ${SHOTS}noise-ping.png`);

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
