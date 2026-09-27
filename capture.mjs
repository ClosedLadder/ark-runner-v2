/**
 * Headless turntable stills. Chrome must already be able to run WebGL.
 * Usage: node capture.mjs [shot ...]
 * With no args, writes all 8 review plates.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const shots = process.argv.slice(2);
const all = [
  ['01-front', 'front'],
  ['02-front-three-quarter', 'front34'],
  ['03-side', 'side'],
  ['04-rear-three-quarter', 'rear34'],
  ['05-rear', 'rear'],
  ['06-top', 'top'],
  ['07-low-chase', 'chase'],
  ['08-night', 'night'],
];
const chosen = shots.length ? all.filter((row) => shots.includes(row[1]) || shots.includes(row[0])) : all;
if (!chosen.length) {
  console.error('no matching shots');
  process.exit(2);
}

const outDir = path.resolve('screenshots');
await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/home/hatch/.cache/puppeteer/chrome-headless-shell/linux-131.0.6778.264/chrome-headless-shell-linux64/chrome-headless-shell',
  headless: true,
  args: ['--hide-scrollbars', '--no-sandbox', '--disable-gpu-sandbox', '--force-color-profile=srgb', '--disable-background-timer-throttling'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
page.on('pageerror', (err) => {
  console.error('PAGEERROR', err);
});
page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'error' || t === 'warning') console.log(`CONSOLE ${t}: ${msg.text()}`);
});

let stats = null;
for (const [file, id] of chosen) {
  const url = `http://127.0.0.1:5179/?shot=${id}&clean=1`;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__arkReady === true', { timeout: 30000 });
  stats = await page.evaluate(() => window.__arkStats);
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(0)));
  }));
  const dest = path.join(outDir, `${file}.png`);
  await page.screenshot({ path: dest, type: 'png' });
  console.log(`wrote ${dest}`);
}

console.log(`STATS ${JSON.stringify(stats)}`);
await browser.close();
