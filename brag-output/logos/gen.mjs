import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const CAR = '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>';
const SPROUT = '<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>';
const BG = {
  auto: '<rect width="100" height="100" fill="#2f5bea"/>',
  vie: '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset=".55" stop-color="#7c3aed"/><stop offset="1" stop-color="#c026d3"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>',
};
// glyph: centre (cx, cy) in its 24-grid, scale so it spans `w` of the 100 box
const GLY = { auto: { d: CAR, cx: 12, cy: 12.5, sw: 1.9 }, vie: { d: SPROUT, cx: 11.6, cy: 12.5, sw: 2.0 } };
function svg(kind, { radius = 0, glyph = 56 } = {}) {
  const g = GLY[kind], s = glyph / 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><clipPath id="r"><rect width="100" height="100" rx="${radius}"/></clipPath><g clip-path="url(#r)">${BG[kind]}</g>` +
    `<g transform="translate(50 50) scale(${s}) translate(${-g.cx} ${-g.cy})" fill="none" stroke="#fff" stroke-width="${g.sw}" stroke-linecap="round" stroke-linejoin="round">${g.d}</g></svg>`;
}
const jobs = [
  ['auto', 'auto-icon-192.png', 192, { radius: 22, glyph: 58 }],
  ['auto', 'auto-icon-512.png', 512, { radius: 22, glyph: 58 }],
  ['auto', 'auto-icon-maskable-512.png', 512, { radius: 0, glyph: 44 }],
  ['auto', 'auto-apple-touch-icon.png', 180, { radius: 0, glyph: 54 }],
  ['vie', 'vie-icon-192.png', 192, { radius: 0, glyph: 58 }],
  ['vie', 'vie-icon-512.png', 512, { radius: 0, glyph: 58 }],
  ['vie', 'vie-icon-maskable-512.png', 512, { radius: 0, glyph: 44 }],
];
const b = await chromium.launch();
for (const [kind, name, size, opt] of jobs) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg(kind, opt).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: name, omitBackground: true }); await p.close();
}
fs.writeFileSync('auto-favicon.svg', svg('auto', { radius: 28, glyph: 62 }));
fs.writeFileSync('vie-favicon.svg', svg('vie', { radius: 25, glyph: 62 }));
await b.close(); console.log('ok');
