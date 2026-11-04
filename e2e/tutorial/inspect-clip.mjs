// Prints a clip's size and length and saves frames as PNGs, to check a recording without a video
// player: node tutorial/inspect-clip.mjs <clip.webm> [seconds ...]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const [file, ...times] = process.argv.slice(2);
if (!file) throw new Error('usage: node tutorial/inspect-clip.mjs <clip.webm> [seconds ...]');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const src = `data:video/webm;base64,${readFileSync(file).toString('base64')}`;
await page.setContent(`<style>body{margin:0;background:#000}</style><video id="v" muted src="${src}"></video>`);
const info = await page.evaluate(() => new Promise((ok) => {
  const v = document.getElementById('v');
  const done = () => ok({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
  v.readyState >= 1 ? done() : v.addEventListener('loadedmetadata', done);
}));
console.log(`${path.basename(file)}: ${info.width}×${info.height}`);
for (const t of times) {
  await page.evaluate((s) => new Promise((ok) => { const v = document.getElementById('v'); v.addEventListener('seeked', ok, { once: true }); v.currentTime = s; }), Number(t));
  const out = file.replace(/\.webm$/, `.${t}s.png`);
  await page.locator('#v').screenshot({ path: out });
  console.log(`frame at ${t}s → ${out}`);
}
await browser.close();
