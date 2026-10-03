import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const BG = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset=".6" stop-color="#c026d3"/><stop offset="1" stop-color="#db2777"/></linearGradient></defs><rect width="24" height="24" rx="5.4" fill="url(#g)"/>';
const O = [
  ['Actuel', 'Flèche montante', '<path d="m5 15 4-4 3 3 7-7"/><path d="M14 7h5v5"/>'],
  ['A', 'Courbe d\'amortissement', '<path d="M5 5v14h14"/><path d="M8 8c3 .5 6 3.5 8.5 8"/><circle cx="16.6" cy="16" r="1.3" fill="#fff" stroke="none"/>'],
  ['B', 'Pourcentage (le taux)', '<circle cx="12" cy="12" r="7.5"/><path d="m14.8 9.2-5.6 5.6"/><circle cx="9.4" cy="9.4" r="1.1" fill="#fff" stroke="none"/><circle cx="14.6" cy="14.6" r="1.1" fill="#fff" stroke="none"/>'],
  ['C', 'Calculatrice', '<rect x="6.5" y="4" width="11" height="16" rx="2.2"/><path d="M9.3 7.6h5.4"/><path d="M9.5 11.5h.01M12 11.5h.01M14.5 11.5h.01M9.5 14.2h.01M12 14.2h.01M14.5 14.2h.01M9.5 16.9h.01M12 16.9h.01M14.5 16.9h.01" stroke-width="2.1"/>'],
  ['D', 'Maison et pourcentage', '<path d="M4.5 11 12 4.8l7.5 6.2v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/><path d="m14 12.6-4 4"/><circle cx="10.2" cy="12.8" r=".95" fill="#fff" stroke="none"/><circle cx="13.8" cy="16.4" r=".95" fill="#fff" stroke="none"/>'],
  ['E', 'Pièces et échéances', '<ellipse cx="10" cy="7.5" rx="5" ry="2"/><path d="M5 7.5v4c0 1.1 2.2 2 5 2s5-.9 5-2v-4"/><path d="M5 11.5v4c0 1.1 2.2 2 5 2 .7 0 1.4-.1 2-.2"/><circle cx="16.5" cy="16" r="3.5"/><path d="M16.5 14.4v1.8l1.1.8"/>'],
  ['F', 'Calendrier d\'échéances', '<rect x="4.5" y="5.5" width="15" height="14" rx="2.2"/><path d="M8.5 3.8v3.4M15.5 3.8v3.4M4.5 10h15"/><path d="m9.2 14.6 2 2 3.8-3.8"/>'],
];
const tile = (g, s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24">${BG}<g fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${g}</g></svg>`;
const html = `<html><head><style>
body{margin:0;background:#f5f6fa;font-family:Geist,system-ui,sans-serif;color:#111527}
@font-face{font-family:Geist;src:url(file:///home/user/portail-rh/brag-output/engine/geist-latin-wght-normal.woff2)}
.wrap{padding:44px 48px 48px} h1{font-size:34px;margin:0 0 6px;letter-spacing:-.02em} p.s{margin:0 0 30px;color:#646c82;font-size:19px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:22px}
.c{background:#fff;border:1px solid #e7e9f1;border-radius:24px;padding:26px 22px 22px;text-align:center;box-shadow:0 10px 30px rgba(17,21,39,.06)}
.c.cur{opacity:.75;border-style:dashed}
.l{font-size:15px;font-weight:700;color:#7c3aed;letter-spacing:.12em;margin-top:16px} .n{font-size:20px;font-weight:650;margin-top:4px}
.mini{display:flex;gap:14px;justify-content:center;align-items:center;margin-top:16px} .mini svg{filter:drop-shadow(0 3px 6px rgba(17,21,39,.18))}
.bar{display:flex;align-items:center;gap:10px;justify-content:center;margin-top:14px;font-size:15px;font-weight:600}
</style></head><body><div class="wrap"><h1>Simulateur de crédit · propositions de logo</h1><p class="s">Même dégradé violet-rose que l'application. En grand, puis en taille téléphone et en en-tête.</p><div class="grid">
${O.map(([l, n, g], i) => `<div class="c${i ? '' : ' cur'}">${tile(g, 150)}<div class="l">${i ? 'PROPOSITION ' + l : 'LOGO ACTUEL'}</div><div class="n">${n}</div><div class="mini">${tile(g, 60)}${tile(g, 32)}</div><div class="bar">${tile(g, 28)}Simulateur de crédit</div></div>`).join('')}
</div></div></body></html>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 1200 }, deviceScaleFactor: 2 });
await p.setContent(html); await p.waitForTimeout(400);
const h = await p.evaluate(() => document.body.scrollHeight); await p.setViewportSize({ width: 1280, height: h });
await p.screenshot({ path: 'propositions-logo-credit.png', fullPage: true }); await b.close(); console.log('ok');
