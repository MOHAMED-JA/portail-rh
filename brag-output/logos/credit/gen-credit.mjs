import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const BG = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset=".6" stop-color="#c026d3"/><stop offset="1" stop-color="#db2777"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>';
const AM = '<path d="M5 5v14h14"/><path d="M8 8c3 .5 6 3.5 8.5 8"/><circle cx="16.6" cy="16" r=".75"/>';
// glyph centre in its 24-grid is (12, 12); `glyph` = share of the tile covered by the 14-unit drawing
function svg({ radius = 0, glyph = 56, sw = 1.75 } = {}) {
  const s = glyph / 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><clipPath id="r"><rect width="100" height="100" rx="${radius}"/></clipPath><g clip-path="url(#r)">${BG}</g>` +
    `<g transform="translate(50 50) scale(${s}) translate(-12 -12)" fill="none" stroke="#fff" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${AM}</g></svg>`;
}
const jobs = [['icon-192.png', 192, { radius: 22, glyph: 50 }], ['icon-512.png', 512, { radius: 22, glyph: 50 }], ['icon-maskable-512.png', 512, { glyph: 38 }],
  ['apple-touch-icon.png', 180, { glyph: 46 }], ['favicon-32.png', 32, { radius: 22, glyph: 58, sw: 2.1 }]];
fs.mkdirSync('out', { recursive: true });
const b = await chromium.launch();
for (const [name, size, opt] of jobs) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<body style="margin:0;background:transparent">${svg(opt).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await p.screenshot({ path: 'out/' + name, omitBackground: true }); await p.close();
}
await b.close(); console.log('ok');
