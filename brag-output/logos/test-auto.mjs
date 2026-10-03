import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const O = '/home/user/portail-rh/brag-output/logos/test';
const b = await chromium.launch(); const ctx = await b.newContext({ locale: 'fr-FR', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8094/simulateur-assurance-automobile/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
await p.screenshot({ path: `${O}/auto-home.png`, clip: { x: 100, y: 0, width: 700, height: 130 } });
await p.getByRole('button', { name: /Commencer la simulation/ }).first().click(); await p.waitForTimeout(1200);
await p.screenshot({ path: `${O}/auto-topbar.png`, clip: { x: 0, y: 0, width: 640, height: 90 } });
// favicon rendering
const fav = await p.evaluate(() => document.querySelector('link[rel="icon"]').href);
const q = await ctx.newPage(); await q.setViewportSize({ width: 128, height: 128 }); await q.goto(fav); await q.screenshot({ path: `${O}/auto-favicon.png` });
console.log('erreurs:', errs.length ? errs : 'aucune');
await b.close();
