// Generează pictogramele aplicației (PNG) din SVG, cu Playwright/Chromium.
// Rulare: npm run icons
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

// folosește playwright local sau global (npm i -g playwright)
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }
const { chromium } = pw;

const svg = (maskable) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E8CF98"/><stop offset="1" stop-color="#A9843F"/></linearGradient>
  <radialGradient id="bg" cx="0.3" cy="0.2" r="1"><stop offset="0" stop-color="#2A2622"/><stop offset="1" stop-color="#141210"/></radialGradient></defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="${maskable ? 'translate(51 51) scale(0.8)' : ''}">
    <circle cx="256" cy="256" r="200" fill="none" stroke="url(#g)" stroke-width="6"/>
    <circle cx="256" cy="256" r="184" fill="none" stroke="url(#g)" stroke-width="1.5" opacity=".6"/>
    <text x="256" y="300" text-anchor="middle" font-family="Cormorant Garamond, Georgia, 'Times New Roman', serif" font-size="168" font-weight="700" fill="url(#g)" letter-spacing="4">LC</text>
    <g>
      <circle cx="196" cy="368" r="13" fill="#F6DCE3"/><circle cx="236" cy="378" r="13" fill="#F9E3CF"/>
      <circle cx="276" cy="378" r="13" fill="#DDEFE2"/><circle cx="316" cy="368" r="13" fill="#E6E0F4"/>
    </g>
  </g>
</svg>`;

writeFileSync('public/favicon.svg', svg(false));
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, maskable] of [
  ['public/icon-192.png', 192, false],
  ['public/icon-512.png', 512, false],
  ['public/icon-maskable-512.png', 512, true],
  ['public/apple-touch-icon.png', 180, true],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><head><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@700&display=block" rel="stylesheet"></head><body style="margin:0">${svg(maskable).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('Pictograme generate în public/');
