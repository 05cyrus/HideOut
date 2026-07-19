/** Driver for ping-repro.html: serve via vite dev, screenshot, dump state. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = 4321;
const PAGE_URL = `http://localhost:${PORT}/tests/e2e/ping-repro.html`;
const SHOT = fileURLToPath(new URL('./shots/ping-repro.png', import.meta.url));

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'pipe',
  detached: true,
});
server.stderr.on('data', (d) => console.error('[vite]', String(d).trim()));

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(PAGE_URL);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('vite dev server did not start');
}

let browser;
try {
  await waitUp();
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('console', (m) => console.log(`[page:${m.type()}]`, m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(PAGE_URL);
  await page.waitForFunction(() => globalThis.__state?.frames > 90, { timeout: 30000 });
  console.log('state:', JSON.stringify(await page.evaluate(() => globalThis.__state)));
  await page.screenshot({ path: SHOT });
  console.log('shot:', SHOT);
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill();
  }
  process.exit(0);
}
