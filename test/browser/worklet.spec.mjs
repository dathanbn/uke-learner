/**
 * Browser integration check.
 *
 * Everything else in this repo is pure TypeScript and tested headlessly, with one
 * exception: whether the AudioWorklet module actually loads and registers in a browser.
 * That depends on the Vite build emitting the worklet as a reachable chunk and on the
 * `?worker&url` import resolving — neither of which a unit test can see. If it breaks, the
 * app silently cannot grade anything, and the first person to find out is holding a
 * ukulele.
 *
 * Deliberately does not use a microphone: this container, and most CI, has no audio device
 * at all. The self-test drives the same worklet through an OfflineAudioContext instead.
 *
 *   npm run build && npm run test:browser
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 4173;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: false,
});

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  server.kill();
  process.exit(1);
};

try {
  // Wait for the preview server.
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      up = r.ok;
    } catch {
      await sleep(500);
    }
  }
  if (!up) fail('preview server did not start');

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.click('text=Got it');
  await page.getByRole('button', { name: 'Detector' }).click();
  await page.waitForSelector('text=Self-test');
  await page.locator('.row.spread', { hasText: 'Self-test' }).getByRole('button').click();

  await page.waitForSelector('.banner', { timeout: 30000 });
  await sleep(1500);
  const banner = await page.$eval('.banner', (e) => `${e.className}|${e.textContent}`);

  await browser.close();
  server.kill();

  if (!banner.startsWith('banner ok')) fail(`self-test did not pass: ${banner}`);
  if (errors.length) fail(`console errors:\n${errors.join('\n')}`);
  console.log('PASS: audio worklet loads and detects in a real browser');
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
